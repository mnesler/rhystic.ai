/**
 * Auth smoke tests.
 *
 * Verifies:
 *   - Unauthenticated users see the landing page
 *   - Authenticated users can reach /app
 *   - User identity is displayed in the header
 *   - Logout clears auth and returns to landing page
 *
 * All API calls are intercepted — no real backend required.
 */

import { test, expect } from "../fixtures.js";

test.describe("authentication", () => {
  test("landing page is shown to unauthenticated users", async ({ browser }) => {
    // Create a fresh context with no storage state and no token
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    // /auth/me is called by AuthContext; with no token it never fires — no mock needed
    await page.goto("/");
    await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=DID YOU PAY THE 1?")).toBeVisible();
    await expect(page.locator("button", { hasText: /github/i })).toBeVisible();

    await ctx.close();
  });

  test("unauthenticated /app redirects to landing", async ({ browser }) => {
    // ProtectedRoute does a client-side redirect once AuthContext resolves to no user
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/app");
    await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });

  // The remaining tests use the `api` fixture which mocks /auth/me automatically
  test("authenticated user lands on /app with layout visible", async ({ page, api }) => {
    void api;
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 10_000 });
  });

  test("user name shown in header after login", async ({ page, api }) => {
    void api;
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible();
    await expect(page.locator(".user-info")).toBeVisible();
  });

  test("logout clears auth and returns to landing", async ({ page, api }) => {
    void api;
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible();

    await page.locator("button", { hasText: "Logout" }).click();

    await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });

    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    expect(token).toBeNull();
  });
});
