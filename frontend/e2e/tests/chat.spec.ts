/**
 * Chat smoke tests.
 *
 * Verifies:
 *   - Empty state prompt is shown before a deck is loaded
 *   - Sending a general question (no deck) returns an assistant response
 *   - Sending a message with a deck loaded triggers deck-context response
 *   - SSE streaming: tokens arrive and the send button becomes active again
 *   - Clear button removes all messages
 *   - Response mode toggle (Snap / Full / Goop) changes active state
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
    const input = page.locator("textarea.chat-input");
    await input.fill("What is Sol Ring good for?");
    await expect(page.locator("button.send-btn")).toBeEnabled();
    await page.locator("button.send-btn").click();

    // User bubble appears immediately
    await expect(page.locator(".chat-bubble-user", { hasText: "Sol Ring" })).toBeVisible();

    // Streaming: assistant bubble appears and spinner shows on send button
    await expect(page.locator(".chat-msg-assistant").last()).toBeVisible({ timeout: 10_000 });

    // Wait for stream to complete — send button re-enables
    await expect(page.locator("button.send-btn")).toBeEnabled({ timeout: 30_000 });

    // Assistant response has content
    const bubble = page.locator(".chat-bubble-assistant").last();
    await expect(bubble).not.toBeEmpty();
  });

  test("deck context message appears after loading a deck", async ({ page }) => {
    // Load a deck via paste
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();
    await page.locator("textarea").first().fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    // System message in chat should confirm deck loaded
    await expect(page.locator(".chat-msg-system")).toBeVisible();
    await expect(page.locator(".chat-msg-system")).toContainText("loaded");
  });

  test("send message with deck loaded shows intent badge", async ({ page }) => {
    // Load deck
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();
    await page.locator("textarea").first().fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    // Send a deck question
    const input = page.locator("textarea.chat-input");
    await input.fill("What ramp should I add?");
    await page.locator("button.send-btn").click();

    // Wait for streaming to finish
    await expect(page.locator("button.send-btn")).toBeEnabled({ timeout: 30_000 });

    // Intent badge rendered (deck-build or general)
    await expect(page.locator(".intent-badge").last()).toBeVisible();

    // Retrieval stats rendered
    await expect(page.locator(".retrieval-stats").last()).toBeVisible();
  });

  test("clear button removes all messages", async ({ page }) => {
    const input = page.locator("textarea.chat-input");
    await input.fill("Hello");
    await page.locator("button.send-btn").click();

    // Wait for at least one message
    await expect(page.locator(".chat-msg-user")).toBeVisible({ timeout: 5_000 });

    // Clear
    await page.locator("button.clear-btn").click();
    await expect(page.locator(".chat-empty")).toBeVisible();
    await expect(page.locator(".chat-msg-user")).not.toBeVisible();
  });

  test("Enter key sends message, Shift+Enter inserts newline", async ({ page }) => {
    const input = page.locator("textarea.chat-input");
    await input.fill("Quick question");

    // Shift+Enter should NOT send
    await input.press("Shift+Enter");
    await expect(page.locator(".chat-msg-user")).not.toBeVisible();

    // Plain Enter should send
    await input.press("Enter");
    await expect(page.locator(".chat-msg-user", { hasText: "Quick question" })).toBeVisible({ timeout: 5_000 });
  });

  test("response mode buttons toggle active state", async ({ page }) => {
    // Default is Snap (succinct)
    await expect(page.locator("button.mode-btn-active", { hasText: "Snap" })).toBeVisible();

    // Switch to Full
    await page.locator("button.mode-btn", { hasText: "Full" }).click();
    await expect(page.locator("button.mode-btn-active", { hasText: "Full" })).toBeVisible();

    // Switch to Goop
    await page.locator("button.mode-btn", { hasText: "Goop" }).click();
    await expect(page.locator("button.mode-btn-active", { hasText: "Goop" })).toBeVisible();

    // Back to Snap
    await page.locator("button.mode-btn", { hasText: "Snap" }).click();
    await expect(page.locator("button.mode-btn-active", { hasText: "Snap" })).toBeVisible();
  });
});
