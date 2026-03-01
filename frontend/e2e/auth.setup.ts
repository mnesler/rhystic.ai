/**
 * Auth setup — runs once before all smoke tests.
 *
 * Opens a real browser to http://localhost:5174, clicks the GitHub login
 * button, and waits for you to complete OAuth. Once you land on /app the
 * auth_token cookie is saved to e2e/.auth/user.json so all subsequent test
 * runs skip the login step.
 *
 * Re-authenticate by deleting e2e/.auth/user.json (or when the 7-day JWT expires).
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

setup("authenticate via GitHub OAuth", async ({ page }) => {
  // If storage state already exists and is fresh, Playwright won't re-run this
  // because it's treated as a dependency — but we still guard here.
  await page.goto("/");

  // Should land on landing page with the GitHub auth button
  await expect(page.locator(".glitch-title")).toBeVisible({ timeout: 10_000 });

  // Check if already logged in (token in localStorage from a previous run)
  const alreadyLoggedIn = await page.evaluate(() => !!localStorage.getItem("auth_token"));
  if (alreadyLoggedIn) {
    await page.goto("/app");
    await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 10_000 });
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  // Click the GitHub login button — this navigates to GitHub OAuth
  const loginBtn = page.locator("button", { hasText: /github/i });
  await expect(loginBtn).toBeVisible();
  await loginBtn.click();

  // GitHub OAuth page — wait for redirect back to /app after you log in.
  // Timeout is generous (2 min) so you have time to enter credentials.
  console.log("\n\n  ╔══════════════════════════════════════════════════╗");
  console.log("  ║  Complete GitHub login in the browser window.   ║");
  console.log("  ║  Waiting up to 2 minutes...                     ║");
  console.log("  ╚══════════════════════════════════════════════════╝\n");

  await page.waitForURL("**/app", { timeout: 120_000 });
  await expect(page.locator(".advisor-layout")).toBeVisible({ timeout: 15_000 });

  // Save the full browser storage state (cookies + localStorage)
  await page.context().storageState({ path: AUTH_FILE });
  console.log("  ✓ Auth state saved to e2e/.auth/user.json\n");
});
