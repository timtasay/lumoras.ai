import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./e2e/config";

/**
 * End-to-end tests against the production build (`pnpm build` first). The web
 * server (e2e/serve.ts) creates a fresh database on TEST_DATABASE_URL, seeds
 * it, starts a fake client site and runs `next start` with test-only settings.
 * Browsers: CI runs `playwright install chromium`; locally, set
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an existing Chromium.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E.baseUrl,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import tsx e2e/serve.ts",
    url: `${E2E.baseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // SIGTERM lets e2e/serve.ts stop next, close the fake site and drop its database
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
