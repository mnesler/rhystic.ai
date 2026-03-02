import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke test config.
 *
 * Assumes both dev servers are already running:
 *   Backend:  (from repo root) node --experimental-sqlite --env-file=./backend/.env --import tsx/esm backend/src/assistant/server.ts
 *   Frontend: npm run dev  (in /frontend) → http://localhost:5174
 *
 * Auth setup: mints a local JWT from the backend/.env JWT_SECRET and seeds it
 * into the browser context. Saved to e2e/.auth/user.json — reused until deleted.
 *
 * Run commands (from frontend/):
 *   npm run test:e2e          — headless, all tests
 *   npm run test:e2e:headed   — visible browser
 *   npm run test:e2e:ui       — interactive Playwright UI
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1, // serial — tests share auth state and a single backend session

  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],

  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Step 1: seed auth state (headless — mints JWT from local secret)
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // Step 2: run all smoke tests using the saved auth state
    {
      name: "smoke",
      testMatch: /tests\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
  ],
});
