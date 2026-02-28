// Typed API client for the MTG Assistant server (port 3002).
//
// The Vite dev server proxies /api → http://localhost:3002, so all
// fetch calls use relative paths.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeckCard {
  name: string;
  quantity: number;
  section: "commander" | "companion" | "mainboard" | "sideboard" | "maybeboard";
  /** MTG color identity symbols e.g. ["W","U","B"] — populated from DB at load time. */
  colorIdentity?: string[];
}

export interface LoadDeckResponse {
  sessionId: string;
  commanders: string[];
  cardCount: number;
  name?: string;
  source: "moxfield" | "paste";
  warnings?: string[];
  /** Full card list — returned by the server so the deck panel can display and
   *  linkify card names regardless of whether the deck came from Moxfield or paste. */
  cards?: DeckCard[];
}

export interface ChatSSEEvent {
  type: "intent" | "retrieved" | "token" | "done" | "error";
  data: unknown;
}

export interface IntentData {
  type: string;
  cardNames: string[];
  commander: string | null;
  colors: string[];
  tags: string[];
  themes: string[];
}

export interface RetrievedData {
  cardCount: number;
  comboCount: number;
  hasEmbeddings: boolean;
}

export type ResponseMode = "succinct" | "verbose" | "gooper";

export interface DoneData {
  sessionId: string;
  fullText: string;
  retrievedCardNames: string[];
  mode?: ResponseMode;
}

// ── Deck loading ──────────────────────────────────────────────────────────────

export async function loadDeckFromMoxfield(
  moxfieldUrl: string,
  sessionId?: string
): Promise<LoadDeckResponse> {
  const res = await fetch("/api/deck/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moxfieldUrl, sessionId }),
  });

  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  }

  return body as unknown as LoadDeckResponse;
}

export async function loadDeckFromPaste(
  decklist: string,
  sessionId?: string
): Promise<LoadDeckResponse> {
  const res = await fetch("/api/deck/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decklist, sessionId }),
  });

  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  }

  return body as unknown as LoadDeckResponse;
}

// ── Session health check ──────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  messageCount: number;
  hasDeck: boolean;
  deckCommanders: string[];
  deckCardCount: number;
}

export async function checkSession(sessionId: string): Promise<SessionInfo | null> {
  try {
    const res = await fetch(`/api/chat/${sessionId}`);
    if (!res.ok) return null;
    return (await res.json()) as SessionInfo;
  } catch {
    return null;
  }
}

// ── Chat (SSE streaming) ──────────────────────────────────────────────────────

export interface ChatCallbacks {
  onIntent?: (intent: IntentData) => void;
  onRetrieved?: (data: RetrievedData) => void;
  onToken?: (token: string) => void;
  onDone?: (data: DoneData) => void;
  onError?: (message: string) => void;
}

/**
 * Send a chat message and stream the response via SSE.
 * Returns a cleanup function to abort the stream.
 */
export function streamChat(
  message: string,
  sessionId: string,
  callbacks: ChatCallbacks,
  mode: ResponseMode = "succinct",
): () => void {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId, mode }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      callbacks.onError?.(err instanceof Error ? err.message : String(err));
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      callbacks.onError?.(`Server error ${res.status}: ${text}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as ChatSSEEvent;
            switch (event.type) {
              case "intent":
                callbacks.onIntent?.(event.data as IntentData);
                break;
              case "retrieved":
                callbacks.onRetrieved?.(event.data as RetrievedData);
                break;
              case "token":
                callbacks.onToken?.(event.data as string);
                break;
              case "done":
                callbacks.onDone?.(event.data as DoneData);
                break;
              case "error":
                callbacks.onError?.(event.data as string);
                break;
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError?.(err instanceof Error ? err.message : String(err));
      }
    }
  })();

  return () => controller.abort();
}
