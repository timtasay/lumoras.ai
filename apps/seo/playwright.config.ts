import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the production build (`pnpm build` first), served
 * with the /design route switched on. Browsers: CI runs `playwright install
 * chromium`; locally, set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an existing
 * Chromium instead of downloading one.
 */
const PORT = Number(process.env.E2E_PORT ?? 3107);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ENABLE_DESIGN_ROUTE: "1" },
  },
});
