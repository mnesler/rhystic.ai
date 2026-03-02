/**
 * Shared Playwright fixtures and mock data.
 *
 * Exports a `test` object extended with an `api` fixture that intercepts all
 * backend API calls before each test, so no test ever reaches the real server.
 *
 * Mock coverage:
 *   GET  /auth/me          → returns MOCK_USER
 *   POST /auth/logout      → 200 OK
 *   POST /api/deck/load    → returns MOCK_DECK_RESPONSE  (can be overridden per-test)
 *   GET  /api/chat/:id     → returns MOCK_SESSION_INFO   (can be overridden per-test)
 *   POST /api/chat         → returns MOCK_SSE_BODY       (can be overridden per-test)
 *
 * Usage in spec files:
 *   import { test, expect, MOCK_DECK_RESPONSE, mockSseBody } from "../fixtures.js";
 */

import { test as base, expect, type Page } from "@playwright/test";

// ── Canonical mock data ───────────────────────────────────────────────────────

export { expect };

export const MOCK_USER = {
  id: 3143862,
  login: "mnesler",
  name: "Maxwell Nesler",
  avatar: "https://avatars.githubusercontent.com/u/3143862?v=4",
  email: null,
};

export const MOCK_DECK_RESPONSE = {
  sessionId: "e2e-session",
  commanders: ["Atraxa, Praetors' Voice"],
  cardCount: 99,
  name: "Atraxa Superfriends",
  source: "moxfield" as const,
  cards: [
    { name: "Atraxa, Praetors' Voice", quantity: 1, section: "commander" },
    { name: "Sol Ring", quantity: 1, section: "mainboard" },
    { name: "Arcane Signet", quantity: 1, section: "mainboard" },
    { name: "Command Tower", quantity: 1, section: "mainboard" },
  ],
};

export const MOCK_SESSION_INFO = {
  id: MOCK_DECK_RESPONSE.sessionId,
  messageCount: 0,
  hasDeck: true,
  deckCommanders: MOCK_DECK_RESPONSE.commanders,
  deckCardCount: MOCK_DECK_RESPONSE.cardCount,
};

/** Build a mock SSE response body for POST /api/chat. */
export function mockSseBody(opts: {
  intent?: object;
  sessionId?: string;
  text?: string;
  cardNames?: string[];
} = {}): string {
  const {
    intent = { type: "general", cardNames: [], commander: null, colors: [], tags: [], themes: [] },
    sessionId = MOCK_DECK_RESPONSE.sessionId,
    text = "Sol Ring taps for two colorless mana.",
    cardNames = ["Sol Ring"],
  } = opts;

  const events = [
    { type: "intent",    data: intent },
    { type: "retrieved", data: { cardCount: 1, comboCount: 0, hasEmbeddings: true } },
    { type: "token",     data: text },
    { type: "done",      data: { sessionId, fullText: text, retrievedCardNames: cardNames } },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

// ── Route helper ──────────────────────────────────────────────────────────────

/** Install default mocks on a page. Called in the `api` fixture beforeEach. */
export async function installDefaultMocks(page: Page): Promise<void> {
  // Auth — every page load calls GET /auth/me to hydrate AuthContext
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_USER),
    });
  });

  // Logout — best-effort POST; just return 200
  await page.route("**/auth/logout", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Deck load — default happy path
  await page.route("**/api/deck/load", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_DECK_RESPONSE),
    });
  });

  // Session health-check — GET /api/chat/:sessionId
  await page.route("**/api/chat/*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_SESSION_INFO),
      });
    } else {
      await route.continue();
    }
  });

  // Chat SSE — default general-question response
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
      body: mockSseBody(),
    });
  });
}

// ── Extended test fixture ─────────────────────────────────────────────────────

type ApiFixture = { api: void };

/**
 * Drop-in replacement for `test` from `@playwright/test`.
 * The `api` fixture installs all default mocks before each test.
 *
 * Tests that need custom mock behaviour can call `page.route(...)` after
 * `use(api)` resolves — Playwright applies routes in LIFO order so the
 * per-test route wins over the default.
 */
export const test = base.extend<ApiFixture>({
  api: async ({ page }, use) => {
    await installDefaultMocks(page);
    await use();
  },
});
