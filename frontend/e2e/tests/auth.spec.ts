/**
 * Auth smoke tests.
 *
 * Verifies:
 *   - Unauthenticated users see the landing page
 *   - Authenticated users can reach /app
 *   - User identity is displayed in the header
 *   - Logout clears auth and returns to landing page
 */

import { test, expect } from "@playwright/test";

test.describe("authentication", () => {
  test("landing page is shown to unauthenticated users", async ({ browser }) => {
    // Create a context with no storage state at all (explicit empty override)
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/");
    await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=DID YOU PAY THE 1?")).toBeVisible();
    await expect(page.locator("button", { hasText: /github/i })).toBeVisible();

    await ctx.close();
  });

  test("unauthenticated /app stays on /app (no server-side redirect)", async ({ browser }) => {
    // The SolidJS ProtectedRoute does a client-side redirect — it reads auth state
    // from AuthContext which takes up to 5s to resolve. Once resolved with no token,
    // it navigates to /. We verify the landing page eventually appears.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/app");
    // Wait for the auth loading phase to resolve and redirect to landing
    await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });

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
    await expect(page.locator(".user-info")).toBeVisible();
  });

  test("logout clears auth and returns to landing", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible();

    await page.locator("button", { hasText: "Logout" }).click();

    await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });

    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    expect(token).toBeNull();
  });
});
