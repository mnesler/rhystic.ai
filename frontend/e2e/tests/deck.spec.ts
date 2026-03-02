/**
 * Deck loading smoke tests.
 *
 * Verifies:
 *   - Moxfield URL tab is visible and loads a public deck
 *   - Paste decklist tab loads a manually entered deck
 *   - Commander badge and card count are shown after a successful load
 *   - "Change Deck" resets back to the input panel
 *   - Invalid Moxfield URL shows an error
 */

import { test, expect } from "@playwright/test";

// A stable Moxfield URL — the actual network call is intercepted below so
// the test never hits Moxfield's servers (avoids flakiness from rate limits,
// private decks, or network timeouts in CI).
const TEST_MOXFIELD_URL = "https://www.moxfield.com/decks/smoke-test-deck";

/** Mock response the backend would return for a successfully loaded deck. */
const MOCK_DECK_RESPONSE = {
  sessionId: "e2e-session-1",
  commanders: ["Atraxa, Praetors' Voice"],
  cardCount: 99,
  name: "Atraxa Superfriends",
  source: "moxfield",
  cards: [
    { name: "Atraxa, Praetors' Voice", quantity: 1, section: "commander" },
    { name: "Sol Ring", quantity: 1, section: "mainboard" },
    { name: "Arcane Signet", quantity: 1, section: "mainboard" },
    { name: "Command Tower", quantity: 1, section: "mainboard" },
  ],
};

// Minimal valid Commander decklist for paste testing
const TEST_DECKLIST = `
// Commander
1 Atraxa, Praetors' Voice

// Mainboard
1 Sol Ring
1 Arcane Signet
1 Command Tower
1 Cultivate
1 Kodama's Reach
`.trim();

// The deck paste textarea — disambiguate from the chat textarea
const deckTextarea = () =>
  'textarea[placeholder*="Commander"]';

test.describe("deck loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 10_000 });
  });

  test("deck input panel is shown on load", async ({ page }) => {
    await expect(page.locator(".deck-loader")).toBeVisible();
    await expect(page.locator(".tab", { hasText: "Moxfield URL" })).toBeVisible();
    await expect(page.locator(".tab", { hasText: "Paste Decklist" })).toBeVisible();
  });

  test("load deck from Moxfield URL", async ({ page }) => {
    // Intercept the backend deck-load call so this test never hits Moxfield's
    // servers — avoids flakiness from rate limits, private decks, or CI timeouts.
    await page.route("**/api/deck/load", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DECK_RESPONSE),
      });
    });

    // After deck load, App.tsx calls GET /api/chat/:sessionId to verify session.
    // Mock that too so sessionOk() resolves to true.
    await page.route("**/api/chat/*", async (route) => {
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
    });

    await page.locator('input[placeholder*="moxfield.com"]').fill(TEST_MOXFIELD_URL);
    await page.locator("button", { hasText: "Load Deck" }).click();

    // Wait for deck display
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    await expect(page.locator(".commander-badge").first()).toBeVisible();
    await expect(page.locator(".card-count")).toBeVisible();

    // Session badge should show "deck context active"
    await expect(page.locator(".session-badge.session-ok")).toBeVisible({ timeout: 10_000 });
  });

  test("load deck from pasted decklist", async ({ page }) => {
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();

    // Use specific selector to avoid matching the chat textarea
    await expect(page.locator(deckTextarea())).toBeVisible();
    await page.locator(deckTextarea()).fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();

    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".commander-badge", { hasText: "Atraxa" })).toBeVisible();
    await expect(page.locator(".card-count")).toContainText("cards");
  });

  test("invalid Moxfield URL shows error", async ({ page }) => {
    await page.locator('input[placeholder*="moxfield.com"]').fill("not-a-valid-url");
    await page.locator("button", { hasText: "Load Deck" }).click();

    await expect(page.locator(".alert-error")).toBeVisible({ timeout: 5_000 });
  });

  test("empty URL shows error without calling server", async ({ page }) => {
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".alert-error")).toBeVisible({ timeout: 3_000 });
  });

  test("Change Deck resets to input panel", async ({ page }) => {
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();
    await page.locator(deckTextarea()).fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    await page.locator("button", { hasText: "Change Deck" }).click();
    await expect(page.locator(".deck-input-panel")).toBeVisible();
    await expect(page.locator(".deck-display")).not.toBeVisible();
  });
});
