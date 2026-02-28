// MTG Deck Advisor — main application layout.
//
// Two-panel layout:
//   Left  — DeckLoader (load from Moxfield URL or paste)
//   Right — ChatWindow (RAG-powered assistant with deck context)

import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import DeckLoader from "./components/DeckLoader.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import CardTooltip from "./components/CardTooltip.jsx";
import type { LoadDeckResponse, DeckCard, SessionInfo, ResponseMode } from "./api/mtg.js";
import { checkSession } from "./api/mtg.js";
import { useAuth } from "./context/AuthContext";
import "./styles.css";

// Generate a session ID once per page load so the deck and chat share the same
// server-side session (and thus the same loadedDeck).
const SESSION_ID = crypto.randomUUID();

// ── Mode toggle config ─────────────────────────────────────────────────────────

const MODES: { value: ResponseMode; label: string; title: string }[] = [
  { value: "verbose",  label: "Full",   title: "Full explanations with detailed reasoning" },
  { value: "succinct", label: "Snap",   title: "Shortest accurate answer, no padding" },
  { value: "gooper",   label: "Goop",   title: "Goop Mode — card art only, no text" },
];

export default function App() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [deckInfo, setDeckInfo] = createSignal<LoadDeckResponse | null>(null);
  const [sessionOk, setSessionOk] = createSignal<boolean | null>(null);
  const [mode, setMode] = createSignal<ResponseMode>("succinct");

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  async function handleDeckLoaded(response: LoadDeckResponse, _cards: DeckCard[]) {
    setDeckInfo(response);
    setSessionOk(null);

    const info: SessionInfo | null = await checkSession(SESSION_ID);
    if (info?.hasDeck) {
      setSessionOk(true);
    } else {
      setSessionOk(false);
      console.warn("[session] Session check failed — hasDeck is false. Server may have restarted.", info);
    }
  }

  return (
    <div class="advisor-layout">
      <CardTooltip />
      {/* Header */}
      <header class="advisor-header">
        <div class="advisor-logo">
          <span class="advisor-logo-icon">📚</span>
          <span class="advisor-logo-text">Rhystic Study</span>
        </div>
        <div class="advisor-header-sub">
          Did you pay the 1?
        </div>

        {/* Mode toggle */}
        <div class="mode-toggle" role="group" aria-label="Response mode">
          {MODES.map((m) => (
            <button
              class={`mode-btn${mode() === m.value ? " mode-btn-active" : ""}${m.value === "gooper" ? " mode-btn-gooper" : ""}`}
              title={m.title}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* User info and logout */}
        <Show when={user()}>
          <div class="user-info" style={{ display: "flex", "align-items": "center", gap: "12px", "margin-left": "16px" }}>
            <Show when={user()?.avatar}>
              <img
                src={user()!.avatar}
                alt={user()!.name}
                style={{
                  width: "32px",
                  height: "32px",
                  "border-radius": "50%",
                  border: "2px solid var(--accent)",
                }}
              />
            </Show>
            <span style={{ "font-size": "13px", color: "var(--text2)" }}>
              {user()!.name}
            </span>
            <button
              class="btn-ghost btn-sm"
              onClick={handleLogout}
              title="Logout"
              style={{ "margin-left": "8px" }}
            >
              Logout
            </button>
          </div>
        </Show>

        {/* Session health indicator — only shown after a deck is loaded */}
        <Show when={deckInfo() !== null}>
          <div class="session-indicator">
            <Show when={sessionOk() === null}>
              <span class="session-badge session-checking">
                <span class="spinner spinner-sm" /> verifying session…
              </span>
            </Show>
            <Show when={sessionOk() === true}>
              <span class="session-badge session-ok">
                ● deck context active
              </span>
            </Show>
            <Show when={sessionOk() === false}>
              <span class="session-badge session-broken" title="The server may have restarted. Reload the page and re-load your deck.">
                ⚠ session lost — reload page &amp; re-load deck
              </span>
            </Show>
          </div>
        </Show>
      </header>

      {/* Two-panel body */}
      <div class="advisor-body">
        {/* Left panel — Deck Loader */}
        <aside class="advisor-deck-panel">
          <div class="panel-title">Your Deck</div>
          <DeckLoader
            sessionId={SESSION_ID}
            onDeckLoaded={handleDeckLoaded}
          />
        </aside>

        {/* Right panel — Chat */}
        <main class="advisor-chat-panel">
          <ChatWindow
            sessionId={SESSION_ID}
            deckLoaded={deckInfo() !== null && sessionOk() !== false}
            deckName={deckInfo()?.name}
            sessionBroken={sessionOk() === false}
            mode={mode()}
          />
        </main>
      </div>
    </div>
  );
}
