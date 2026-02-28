// MTG Commander Assistant — HTTP server.
//
// Port: 3002 (configurable via PORT env var or MTG_PORT)
//
// Endpoints:
//   POST /api/chat              — start or continue a conversation (SSE stream)
//   GET  /api/chat/:sessionId   — get session info + history
//   DELETE /api/chat/:sessionId — clear a session
//   GET  /api/health            — health check
//
// SSE event format (POST /api/chat):
//   data: {"type":"intent",   "data": { intent object }}
//   data: {"type":"retrieved","data": { cardCount, comboCount }}
//   data: {"type":"token",    "data": "partial text"}
//   data: {"type":"done",     "data": { sessionId, fullText }}
//   data: {"type":"error",    "data": "error message"}

import "dotenv/config";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { warmCache } from "./vector.js";
import { getDb } from "../db/client.js";
import { classifyIntent } from "./intent.js";
import { retrieve } from "./retrieve.js";
import { buildContext, buildSystemPrompt, buildDeckSystemBlock } from "./context.js";
import type { ResponseMode } from "./context.js";
import { streamAnswer } from "./answer.js";
import {
  getOrCreateSession,
  getSession,
  deleteSession,
  addUserMessage,
  addAssistantMessage,
  setSessionDeck,
  sessionSnapshot,
} from "./conversation.js";
import { fetchMoxfieldDeck, parseMoxfieldUrl, MoxfieldError } from "../deck/moxfield.js";
import { parseDecklist } from "../deck/parser.js";

const PORT = parseInt(process.env.MTG_PORT ?? process.env.PORT ?? "3002");

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

// ── POST /api/chat ─────────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const { message, sessionId, mode } = req.body as {
    message?: string;
    sessionId?: string;
    mode?: ResponseMode;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function send(type: string, data: unknown): void {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }

  const session = getOrCreateSession(sessionId);
  addUserMessage(session, message.trim());

  try {
    // Step 1: classify intent.
    // If a deck is loaded, prefix the message with a brief deck summary so the
    // intent classifier knows the commander and can resolve pronouns like "it",
    // "my deck", "make it more competitive", etc.
    const deck = session.loadedDeck;
    const messageForClassifier = deck
      ? `[Context: the user has loaded a Commander deck. Commander(s): ${deck.commanders.join(" / ")}. Total cards: ${deck.cardCount}.]\n\nUser message: ${message.trim()}`
      : message.trim();

    const intent = await classifyIntent(messageForClassifier, session.history.slice(0, -1));

    // Fix 2: if the classifier didn't extract a commander but the session has
    // a loaded deck, pull the commander directly from the deck. This ensures
    // retrieveDeckBuild fires correctly for queries like "make it more competitive".
    if (!intent.commander && deck?.commanders.length) {
      intent.commander = deck.commanders[0] ?? null;
    }
    // Also seed colors from the deck if none were inferred
    // (helps tag-search and deck-build retrieval target the right color identity)
    if (intent.colors.length === 0 && deck) {
      // Derive color identity from the deck's cards (union of all color identities)
      const colorSet = new Set<string>();
      for (const card of deck.cards) {
        // We don't have color_identity here (that's a DB field), so we leave
        // this for the retrieval layer to handle via the commander lookup.
      }
      void colorSet; // placeholder — retrieval uses commander to get color identity
    }

    send("intent", intent);

    // Step 2: retrieve relevant data.
    // For power-assess and general intents on a deck-loaded session, promote to
    // deck-build retrieval so we get commander combos + thematic cards rather
    // than a generic card lookup that ignores the loaded deck.
    const effectiveIntent = { ...intent };
    if (deck && (intent.type === "power-assess" || intent.type === "general")) {
      effectiveIntent.type = "deck-build";
      // Carry themes from the user's question into the search query
      if (!effectiveIntent.themes.includes("competitive")) {
        const lc = message.toLowerCase();
        if (lc.includes("competi")) effectiveIntent.themes = [...effectiveIntent.themes, "competitive", "optimized"];
        if (lc.includes("budget")) effectiveIntent.themes = [...effectiveIntent.themes, "budget"];
        if (lc.includes("combo")) effectiveIntent.themes = [...effectiveIntent.themes, "combo", "infinite"];
        if (lc.includes("casual")) effectiveIntent.themes = [...effectiveIntent.themes, "casual"];
      }
      effectiveIntent.searchQuery = `${message.trim()} commander ${effectiveIntent.commander ?? ""}`.trim();
    }
    const result = await retrieve(effectiveIntent);
    send("retrieved", {
      cardCount: result.cards.length,
      comboCount: result.combos.length,
      hasEmbeddings: result.hasEmbeddings,
    });

    // Step 3: build context block
    const context = buildContext(result, effectiveIntent);
    const responseMode: ResponseMode = mode === "verbose" || mode === "gooper" ? mode : "succinct";
    const baseSystemPrompt = buildSystemPrompt(effectiveIntent, responseMode);
    // Prepend deck context if a deck is loaded in this session
    const deckBlock = session.loadedDeck
      ? buildDeckSystemBlock(session.loadedDeck)
      : null;
    const systemPrompt = deckBlock
      ? `${deckBlock}\n\n---\n\n${baseSystemPrompt}`
      : baseSystemPrompt;

    // Step 4: stream the answer
    let fullText = "";
    await streamAnswer(
      systemPrompt,
      context,
      session.history.slice(0, -1), // history without the current user message
      message.trim(),
      {
        onToken: (token) => {
          fullText += token;
          send("token", token);
        },
        onDone: (text) => {
          fullText = text;
        },
        onError: (err) => {
          send("error", err.message);
        },
      }
    );

    // Store the assistant response in history
    addAssistantMessage(session, fullText);

    // In gooper mode the LLM response IS the card list (plain CSV) — validate
    // those names against the DB and use only them. Do NOT merge with RAG
    // results; the whole point of gooper is a curated LLM-chosen set.
    // In other modes, start with RAG results and augment with any **bold**
    // card names the LLM added from its own knowledge.
    const retrievedCardNames = responseMode === "gooper"
      ? extractConfirmedCardNames(
          "",  // no bold-scan needed — fullText has no markdown
          fullText.split(",").map((s) => s.trim()).filter(Boolean),
        )
      : extractConfirmedCardNames(
          fullText,
          result.cards.map((c) => c.name),
        );

    send("done", {
      sessionId: session.id,
      fullText,
      retrievedCardNames,
      mode: responseMode,
    });
  } catch (err) {
    send("error", err instanceof Error ? err.message : String(err));
  } finally {
    res.end();
  }
});

// ── GET /api/chat/:sessionId ──────────────────────────────────────────────────

app.get("/api/chat/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({
    ...sessionSnapshot(session),
    history: session.history,
  });
});

// ── DELETE /api/chat/:sessionId ───────────────────────────────────────────────

app.delete("/api/chat/:sessionId", (req, res) => {
  const deleted = deleteSession(req.params.sessionId);
  res.json({ deleted });
});

// ── Color identity enrichment ─────────────────────────────────────────────────
// Batch-queries the DB for each card's color_identity and returns a new array
// with colorIdentity attached. Cards not in the DB get colorIdentity: [].

function enrichCardsWithColors(cards: import("../deck/types.js").DeckCard[]): import("../deck/types.js").DeckCard[] {
  if (cards.length === 0) return cards;
  const db = getDb();
  const names = [...new Set(cards.map((c) => c.name))];
  const placeholders = names.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT name, color_identity FROM cards WHERE name IN (${placeholders})`)
    .all(...names) as { name: string; color_identity: string }[];

  const colorMap = new Map<string, string[]>();
  for (const row of rows) {
    try { colorMap.set(row.name, JSON.parse(row.color_identity) as string[]); }
    catch { colorMap.set(row.name, []); }
  }

  return cards.map((c) => ({ ...c, colorIdentity: colorMap.get(c.name) ?? [] }));
}

// ── Card name extraction helper ───────────────────────────────────────────────
//
// After the LLM finishes streaming, scan its response for **bold** tokens and
// validate each against the cards table.  Returns the union of RAG-retrieved
// names and any confirmed bold names, deduplicated.

function extractConfirmedCardNames(text: string, retrieved: string[]): string[] {
  const db = getDb();

  // Pull every **…** run from the response (card names are always bolded).
  const boldRe = /\*\*([^*\n]{1,60})\*\*/g;
  const candidates = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    candidates.add(m[1]!.trim());
  }

  if (candidates.size === 0) {
    // Nothing bold — just return the retrieved list
    return [...new Set(retrieved)];
  }

  // Batch-confirm candidates against the DB (single indexed query).
  const placeholders = [...candidates].map(() => "?").join(",");
  const confirmed = db
    .prepare(`SELECT name FROM cards WHERE name IN (${placeholders})`)
    .all(...[...candidates]) as { name: string }[];

  const confirmedNames = confirmed.map((r) => r.name);

  // Merge and deduplicate, preserving retrieved names first
  return [...new Set([...retrieved, ...confirmedNames])];
}

// ── POST /api/deck/load ───────────────────────────────────────────────────────
//
// Load a deck into a session from either a Moxfield URL or a raw decklist.
//
// Request body:
//   { sessionId?: string, moxfieldUrl?: string, decklist?: string }
//
// Response:
//   { sessionId, commanders, cardCount, name?, warnings? }

app.post("/api/deck/load", async (req, res) => {
  const { sessionId, moxfieldUrl, decklist } = req.body as {
    sessionId?: string;
    moxfieldUrl?: string;
    decklist?: string;
  };

  if (!moxfieldUrl?.trim() && !decklist?.trim()) {
    res.status(400).json({ error: "Either moxfieldUrl or decklist is required." });
    return;
  }

  const session = getOrCreateSession(sessionId);

  try {
    if (moxfieldUrl?.trim()) {
      // Validate it looks like a Moxfield URL before fetching
      if (!parseMoxfieldUrl(moxfieldUrl.trim())) {
        res.status(400).json({
          error: "Invalid Moxfield URL. Expected: https://moxfield.com/decks/{deckId}",
        });
        return;
      }

      const deck = await fetchMoxfieldDeck(moxfieldUrl.trim());
      setSessionDeck(session, deck);

      res.json({
        sessionId: session.id,
        commanders: deck.commanders,
        cardCount: deck.cardCount,
        name: deck.name,
        source: "moxfield",
        cards: enrichCardsWithColors(deck.cards),
      });
    } else if (decklist?.trim()) {
      const { deck, warnings } = parseDecklist(decklist.trim());
      setSessionDeck(session, deck);

      res.json({
        sessionId: session.id,
        commanders: deck.commanders,
        cardCount: deck.cardCount,
        source: "paste",
        warnings: warnings.length > 0 ? warnings : undefined,
        cards: enrichCardsWithColors(deck.cards),
      });
    }
  } catch (err) {
    if (err instanceof MoxfieldError) {
      const status = err.statusCode === 404 ? 404 : err.statusCode === 403 ? 403 : 502;
      res.status(status).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), service: "mtg-assistant" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const httpServer = createServer(app);

httpServer.listen(PORT, () => {
  console.log(`MTG Assistant running on http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/api/chat  { message, sessionId? }`);
  console.log();

  // Warm the vector cache in the background after startup
  setTimeout(() => {
    try {
      warmCache();
    } catch (err) {
      // No embeddings yet — user needs to run embed:cards first
      console.warn("[vector] No embeddings loaded — run `npm run embed:cards` to enable semantic search.");
    }
  }, 500);
});
