/**
 * Auth setup — runs once before all smoke tests.
 *
 * Mints a valid 7-day JWT using the local JWT_SECRET (read from backend/.env)
 * via the same jsonwebtoken library the server uses, seeds it into the browser
 * context, and saves storage state to e2e/.auth/user.json.
 *
 * Subsequent runs reuse the saved state (delete user.json to force re-mint).
 *
 * NOTE: This step does NOT call the real backend. The token is minted locally
 * and seeded directly into localStorage. All API calls in the test suite are
 * intercepted by the mock fixtures in e2e/fixtures.ts.
 */

import { test as setup } from "@playwright/test";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

// Repo root — two levels up from frontend/e2e/ (frontend/e2e → frontend → repo root)
const REPO_ROOT = path.resolve(__dirname, "../..");

setup("seed auth state", async ({ page }) => {
  if (existsSync(AUTH_FILE)) {
    console.log("  ✓ Auth state already exists — skipping setup");
    return;
  }

  // Read JWT_SECRET from backend/.env (falls back to the well-known dev default)
  const envPath = path.join(REPO_ROOT, "backend/.env");
  const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const jwtSecret =
    envText.match(/JWT_SECRET=([^\r\n]+)/)?.[1]?.trim() ??
    "dev-secret-change-in-prod";

  // Write a temp mint script inside the repo root so node finds node_modules/jsonwebtoken
  // (ESM package resolution walks up from the *file*, not from cwd)
  const mintScript = path.join(REPO_ROOT, "__e2e_mint_token.mjs");
  writeFileSync(
    mintScript,
    `
import jwt from 'jsonwebtoken';
const token = jwt.sign(
  { id: 3143862, login: 'mnesler', name: 'Maxwell Nesler',
    avatar: 'https://avatars.githubusercontent.com/u/3143862?v=4', email: null },
  ${JSON.stringify(jwtSecret)},
  { expiresIn: '7d' }
);
process.stdout.write(token);
`.trim()
  );

  let token: string;
  try {
    token = execSync(`node ${mintScript}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } finally {
    unlinkSync(mintScript);
  }

  // Seed into browser localStorage and save storage state.
  // We mock /auth/me in every test via fixtures.ts, so no live backend call needed.
  await page.goto("http://localhost:5174");
  await page.evaluate((t) => localStorage.setItem("auth_token", t), token);
  await page.context().storageState({ path: AUTH_FILE });

  console.log("  ✓ Auth state seeded and saved to e2e/.auth/user.json");
});
