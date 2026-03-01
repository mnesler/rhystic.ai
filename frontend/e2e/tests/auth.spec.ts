/**
 * Auth smoke tests.
 *
 * Verifies:
 *   - Unauthenticated users are redirected to the landing page
 *   - Authenticated users can reach /app
 *   - User identity is displayed in the header
 *   - Logout clears auth and returns to landing page
 */

import { test, expect } from "@playwright/test";

test.describe("authentication", () => {
  test("landing page is shown to unauthenticated users", async ({ browser }) => {
    // Use a fresh context with no storage state (no cookies/localStorage)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/");
    await expect(page.locator(".glitch-title")).toBeVisible();
    await expect(page.locator("text=DID YOU PAY THE 1?")).toBeVisible();
    await expect(page.locator("button", { hasText: /github/i })).toBeVisible();

    await ctx.close();
  });

  test("unauthenticated visit to /app redirects to landing", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/app");
    // ProtectedRoute should bounce unauthenticated users back to /
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".glitch-title")).toBeVisible();

    await ctx.close();
  });

  test("authenticated user lands on /app with layout visible", async ({ page }) => {
    // Storage state (from auth.setup.ts) is already injected by the 'smoke' project
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 10_000 });
  });

  test("user name shown in header after login", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible();
    // The user info section renders the GitHub display name
    await expect(page.locator(".user-info")).toBeVisible();
  });

  test("logout clears auth and returns to landing", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible();

    // Click the logout button
    await page.locator("button", { hasText: "Logout" }).click();

    // Should redirect back to landing
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".glitch-title")).toBeVisible();

    // localStorage token should be gone
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    expect(token).toBeNull();
  });
});
