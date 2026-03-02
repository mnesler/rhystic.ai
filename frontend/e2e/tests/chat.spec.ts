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
 * All API calls are intercepted — no real backend required.
 * Default mocks from fixtures.ts cover: /auth/me, /api/deck/load,
 * /api/chat/* (session check), and /api/chat (SSE stream).
 */

import { test, expect, MOCK_DECK_RESPONSE, mockSseBody } from "../fixtures.js";

const TEST_DECKLIST = `
// Commander
1 Atraxa, Praetors' Voice

// Mainboard
1 Sol Ring
1 Arcane Signet
1 Command Tower
`.trim();

// Chat-specific textarea (not the deck paste textarea)
const chatInput = () => "textarea.chat-input";
// Deck paste textarea
const deckTextarea = () => 'textarea[placeholder*="Commander"]';

test.describe("chat", () => {
  test.beforeEach(async ({ page, api }) => {
    void api; // ensure default mocks are installed
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
    await page.locator(chatInput()).fill("What is Sol Ring good for?");
    await expect(page.locator("button.send-btn")).toBeEnabled();
    await page.locator("button.send-btn").click();

    // User bubble appears immediately
    await expect(page.locator(".chat-bubble-user", { hasText: "Sol Ring" })).toBeVisible();

    // Assistant bubble appears (streaming placeholder)
    await expect(page.locator(".chat-msg-assistant").last()).toBeVisible({ timeout: 5_000 });

    // Wait for stream to finish — re-type so send button can re-enable
    await page.locator(chatInput()).fill("follow up");
    await expect(page.locator("button.send-btn")).toBeEnabled({ timeout: 10_000 });

    // Assistant response has content
    const text = await page.locator(".chat-bubble-assistant").last().textContent();
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
    // Override default /api/chat SSE mock with a deck-context intent
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
        body: mockSseBody({
          intent: {
            type: "deck-build",
            cardNames: ["Sol Ring"],
            commander: "Atraxa, Praetors' Voice",
            colors: ["W", "U", "B", "G"],
            tags: ["ramp"],
            themes: [],
          },
          text: "Consider adding Cultivate for ramp.",
          cardNames: ["Sol Ring", "Cultivate"],
        }),
      });
    });

    // Load deck via Moxfield tab (uses the default deck/load mock)
    await page.locator('input[placeholder*="moxfield.com"]').fill("https://www.moxfield.com/decks/smoke");
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".session-badge.session-ok")).toBeVisible({ timeout: 5_000 });

    // Send a deck question
    await page.locator(chatInput()).fill("What ramp should I add?");
    await page.locator("button.send-btn").click();

    await expect(page.locator(".chat-bubble-user", { hasText: "ramp" })).toBeVisible();

    // Wait for stream to finish
    await page.locator(chatInput()).fill("follow up");
    await expect(page.locator("button.send-btn")).toBeEnabled({ timeout: 10_000 });

    // Intent badge and retrieval stats rendered
    await expect(page.locator(".intent-badge").last()).toBeVisible();
    await expect(page.locator(".retrieval-stats").last()).toBeVisible();
  });

  test("clear button removes all messages", async ({ page }) => {
    await page.locator(chatInput()).fill("Hello");
    await page.locator("button.send-btn").click();

    await expect(page.locator(".chat-msg-user")).toBeVisible({ timeout: 5_000 });

    await page.locator("button.clear-btn").click();
    await expect(page.locator(".chat-empty")).toBeVisible();
    await expect(page.locator(".chat-msg-user")).not.toBeVisible();
  });

  test("Enter key sends message, Shift+Enter inserts newline", async ({ page }) => {
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
