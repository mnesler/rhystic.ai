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

// A small, stable public Moxfield deck used for smoke testing
const TEST_MOXFIELD_URL = "https://www.moxfield.com/decks/H0AvOkXrekafJwUQpOxFUQ";

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
    // Fill in the Moxfield URL
    await page.locator('input[placeholder*="moxfield.com"]').fill(TEST_MOXFIELD_URL);
    await page.locator("button", { hasText: "Load Deck" }).click();

    // Spinner appears while loading
    await expect(page.locator(".spinner").first()).toBeVisible();

    // Wait for the deck display to render (Moxfield API can be slow)
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 20_000 });

    // Commander badge and card count should be present
    await expect(page.locator(".commander-badge").first()).toBeVisible();
    await expect(page.locator(".card-count")).toBeVisible();

    // Session badge should eventually show "deck context active"
    await expect(page.locator(".session-badge.session-ok")).toBeVisible({ timeout: 10_000 });
  });

  test("load deck from pasted decklist", async ({ page }) => {
    // Switch to paste tab
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();
    await expect(page.locator("textarea")).toBeVisible();

    // Paste the decklist
    await page.locator("textarea").fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();

    // Deck display should appear
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    // Commander and card count visible
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
    // Load a deck first
    await page.locator(".tab", { hasText: "Paste Decklist" }).click();
    await page.locator("textarea").fill(TEST_DECKLIST);
    await page.locator("button", { hasText: "Load Deck" }).click();
    await expect(page.locator(".deck-display")).toBeVisible({ timeout: 10_000 });

    // Reset
    await page.locator("button", { hasText: "Change Deck" }).click();
    await expect(page.locator(".deck-input-panel")).toBeVisible();
    await expect(page.locator(".deck-display")).not.toBeVisible();
  });
});
