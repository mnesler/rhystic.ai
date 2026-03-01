import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke test config.
 *
 * Assumes both dev servers are already running:
 *   Backend:  npm run dev  (in /backend)  → http://localhost:3002
 *   Frontend: npm run dev  (in /frontend) → http://localhost:5174
 *
 * Auth setup: the first run will open a real browser so you can log in via
 * GitHub. The session is saved to e2e/.auth/user.json and reused for 7 days
 * (matching the JWT expiry). Delete that file to re-authenticate.
 *
 * Run commands (from frontend/):
 *   npm run test:e2e          — headless, all tests
 *   npm run test:e2e:headed   — visible browser
 *   npm run test:e2e:ui       — interactive Playwright UI
 */
export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 30_000,
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
    // Step 1: authenticate once, save storage state
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        // Headed so you can manually complete the GitHub OAuth flow
        headless: false,
      },
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
