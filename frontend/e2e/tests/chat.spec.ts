/**
 * Chat smoke tests.
 *
 * Verifies:
 *   - Empty state prompt is shown before a deck is loaded
 *   - Sending a general question returns an assistant response
 *   - Sending a message with a deck loaded triggers deck-context response
 *   - SSE streaming: tokens arrive and the send button becomes active again
 *   - Clear button removes all messages
 *   - Response mode toggle (Snap / Full / Goop) changes active state
 *
 * Tests that require an LLM response mock the /api/chat SSE stream to avoid
 * flakiness from network latency and to keep the test suite fast.
 */

import { test, expect } from "@playwright/test";

const TEST_DECKLIST = `
// Commander
1 Atraxa, Praetors' Voice

// Mainboard
1 Sol Ring
1 Arcane Signet
1 Command Tower
`.trim();

/** Mock deck load response used when tests need a loaded deck. */
const MOCK_DECK_RESPONSE = {
  sessionId: "e2e-chat-session",
  commanders: ["Atraxa, Praetors' Voice"],
  cardCount: 4,
  name: "Atraxa Test",
  source: "paste",
  cards: [
    { name: "Atraxa, Praetors' Voice", quantity: 1, section: "commander" },
    { name: "Sol Ring", quantity: 1, section: "mainboard" },
  ],
};

/**
 * Build a mock SSE response body for /api/chat.
 * Produces: intent → retrieved → token(s) → done events.
 */
function mockSseBody(sessionId = "e2e-chat-session"): string {
  const events = [
    { type: "intent", data: { type: "general", cardNames: [], commander: null, colors: [], tags: [], themes: [] } },
    { type: "retrieved", data: { cardCount: 1, comboCount: 0, hasEmbeddings: true } },
    { type: "token", data: "Sol Ring taps for two colorless mana." },
    { type: "done", data: { sessionId, fullText: "Sol Ring taps for two colorless mana.", retrievedCardNames: ["Sol Ring"] } },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

// Chat-specific textarea (not the deck paste textarea)
const chatInput = () => "textarea.chat-input";
// Deck paste textarea
const deckTextarea = () => 'textarea[placeholder*="Commander"]';

test.describe("chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 10_000 });
  });

  test("empty state is shown before interacting", async ({ page }) => {
    await expect(page.locator(".chat-empty")).toBeVisible();
    await expect(page.locator("text=Load a deck to get started")).toBeVisible();
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await expect(page.locator("button.send-btn")).toBeDisabled();
  });

  test("can send a general question without a deck", async ({ page }) => {
    // Intercept the SSE stream so the test doesn't depend on a live LLM.
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: mockSseBody(),
      });
    });

    await page.locator(chatInput()).fill("What is Sol Ring good for?");
    await expect(page.locator("button.send-btn")).toBeEnabled();
    await page.locator("button.send-btn").click();

    // User bubble appears immediately
    await expect(page.locator(".chat-bubble-user", { hasText: "Sol Ring" })).toBeVisible();

    // Assistant bubble appears (streaming placeholder)
    await expect(page.locator(".chat-msg-assistant").last()).toBeVisible({ timeout: 5_000 });

    // Wait for the stream to complete — assistant bubble loses its streaming state
    // (streaming=false removes the spinner class / the bubble becomes non-streaming).
    // Re-enter text to verify the send button is actually re-enabled.
    await page.locator(chatInput()).fill("follow up");
    await expect(page.locator("button.send-btn")).toBeEnabled({ timeout: 10_000 });

    // Assistant response has content
    const bubble = page.locator(".chat-bubble-assistant").last();
    const text = await bubble.textContent();
    expect(text?.length).toBeGreaterThan(10);
  });

  test("deck context message appears after loading a deck", async ({ page }) => {
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();
    await page.locator(deckTextarea()).fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    // System message in chat should confirm deck loaded
    await expect(page.locator(".chat-msg-system")).toBeVisible();
    await expect(page.locator(".chat-msg-system")).toContainText("loaded");
  });

  test("send message with deck loaded shows intent badge", async ({ page }) => {
    // Mock the deck load
    await page.route("**/api/deck/load", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DECK_RESPONSE),
      });
    });

    // Mock the session health-check (GET /api/chat/:sessionId) so sessionOk() = true
    await page.route("**/api/chat/*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: MOCK_DECK_RESPONSE.sessionId,
            messageCount: 0,
            hasDeck: true,
            deckCommanders: MOCK_DECK_RESPONSE.commanders,
            deckCardCount: MOCK_DECK_RESPONSE.cardCount,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock the SSE chat with an intent that includes deck context
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      const deckIntent = {
        type: "intent",
        data: { type: "deck-build", cardNames: ["Sol Ring"], commander: "Atraxa, Praetors' Voice", colors: ["W","U","B","G"], tags: ["ramp"], themes: [] },
      };
      const retrieved = { type: "retrieved", data: { cardCount: 5, comboCount: 0, hasEmbeddings: true } };
      const token = { type: "token", data: "Consider adding Cultivate for ramp." };
      const done = { type: "done", data: { sessionId: "e2e-chat-session", fullText: "Consider adding Cultivate for ramp.", retrievedCardNames: ["Sol Ring"] } };
      const body = [deckIntent, retrieved, token, done].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });

    // Load deck via Moxfield URL tab (uses the mock)
    await page.locator('input[placeholder*="moxfield.com"]').fill("https://www.moxfield.com/decks/smoke");
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    // Session badge should be ok before we send a message
    await expect(page.locator(".session-badge.session-ok")).toBeVisible({ timeout: 5_000 });

    // Send a deck question
    await page.locator(chatInput()).fill("What ramp should I add?");
    await page.locator("button.send-btn").click();

    // Wait for user bubble
    await expect(page.locator(".chat-bubble-user", { hasText: "ramp" })).toBeVisible();

    // Wait for stream to complete (re-type to enable button)
    await page.locator(chatInput()).fill("follow up");
    await expect(page.locator("button.send-btn")).toBeEnabled({ timeout: 10_000 });

    // Intent badge and retrieval stats rendered
    await expect(page.locator(".intent-badge").last()).toBeVisible();
    await expect(page.locator(".retrieval-stats").last()).toBeVisible();
  });

  test("clear button removes all messages", async ({ page }) => {
    // Mock SSE so the stream doesn't hang after clear
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: mockSseBody(),
      });
    });

    await page.locator(chatInput()).fill("Hello");
    await page.locator("button.send-btn").click();

    // Wait for at least the user message to appear
    await expect(page.locator(".chat-msg-user")).toBeVisible({ timeout: 5_000 });

    // Clear — no need to wait for the stream to finish
    await page.locator("button.clear-btn").click();
    await expect(page.locator(".chat-empty")).toBeVisible();
    await expect(page.locator(".chat-msg-user")).not.toBeVisible();
  });

  test("Enter key sends message, Shift+Enter inserts newline", async ({ page }) => {
    // Mock SSE to prevent test from hanging
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: mockSseBody(),
      });
    });

    const input = page.locator(chatInput());
    await input.fill("Quick question");

    // Shift+Enter should NOT send
    await input.press("Shift+Enter");
    await expect(page.locator(".chat-msg-user")).not.toBeVisible();

    // Plain Enter should send
    await input.press("Enter");
    await expect(page.locator(".chat-msg-user", { hasText: "Quick question" })).toBeVisible({ timeout: 5_000 });
  });

  test("response mode buttons toggle active state", async ({ page }) => {
    await expect(page.locator("button.mode-btn-active", { hasText: "Snap" })).toBeVisible();

    await page.locator("button.mode-btn", { hasText: "Full" }).click();
    await expect(page.locator("button.mode-btn-active", { hasText: "Full" })).toBeVisible();

    await page.locator("button.mode-btn", { hasText: "Goop" }).click();
    await expect(page.locator("button.mode-btn-active", { hasText: "Goop" })).toBeVisible();

    await page.locator("button.mode-btn", { hasText: "Snap" }).click();
    await expect(page.locator("button.mode-btn-active", { hasText: "Snap" })).toBeVisible();
  });
});
