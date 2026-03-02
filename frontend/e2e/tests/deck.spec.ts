/**
 * Deck loading smoke tests.
 *
 * Verifies:
 *   - Moxfield URL tab is visible and loads a deck
 *   - Paste decklist tab loads a manually entered deck
 *   - Commander badge and card count are shown after a successful load
 *   - "Change Deck" resets back to the input panel
 *   - Invalid Moxfield URL shows an error
 *
 * All API calls are intercepted — no real backend required.
 * Default mocks from fixtures.ts cover: /auth/me, /api/deck/load, /api/chat/*.
 * Per-test overrides (using page.route before the default fires) handle error cases.
 */

import { test, expect, MOCK_DECK_RESPONSE } from "../fixtures.js";

// Any Moxfield-shaped URL — network call is always intercepted
const TEST_MOXFIELD_URL = "https://www.moxfield.com/decks/smoke-test-deck";

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
const deckTextarea = () => 'textarea[placeholder*="Commander"]';

test.describe("deck loading", () => {
  test.beforeEach(async ({ page, api }) => {
    void api; // ensure default mocks are installed
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 10_000 });
  });

  test("deck input panel is shown on load", async ({ page }) => {
    await expect(page.locator(".deck-loader")).toBeVisible();
    await expect(page.locator(".tab", { hasText: "Moxfield URL" })).toBeVisible();
    await expect(page.locator(".tab", { hasText: "Paste Decklist" })).toBeVisible();
  });

  test("load deck from Moxfield URL", async ({ page }) => {
    await page.locator('input[placeholder*="moxfield.com"]').fill(TEST_MOXFIELD_URL);
    await page.locator("button", { hasText: "Load Deck" }).click();

    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".commander-badge").first()).toBeVisible();
    await expect(page.locator(".card-count")).toBeVisible();

    // Session badge should show "deck context active"
    await expect(page.locator(".session-badge.session-ok")).toBeVisible({ timeout: 10_000 });
  });

  test("load deck from pasted decklist", async ({ page }) => {
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();

    await expect(page.locator(deckTextarea())).toBeVisible();
    await page.locator(deckTextarea()).fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();

    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".commander-badge", { hasText: "Atraxa" })).toBeVisible();
    await expect(page.locator(".card-count")).toContainText("cards");
  });

  test("invalid Moxfield URL shows error", async ({ page }) => {
    // Override the default deck/load mock with an error response
    await page.route("**/api/deck/load", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid Moxfield URL" }),
      });
    });

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
