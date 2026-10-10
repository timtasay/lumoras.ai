import path from "node:path";

const port = Number(process.env.E2E_PORT ?? 3107);
const root = path.resolve(import.meta.dirname, "..");

/** Shared by playwright.config.ts, the web server script and the specs. */
export const E2E = {
  port,
  baseUrl: `http://127.0.0.1:${port}`,
  outbox: path.join(root, "test-results", "outbox"),
  stateFile: path.join(root, "test-results", "e2e-state.json"),
  fakeDomain: "northwind-dental.test",
  shots: process.env.SCREENSHOT_DIR || null,
  /** E2E_OPENSEO=hosted: the server answers research from a local fake hosted OpenSEO (provider-card screenshots only). */
  openseoHosted: process.env.E2E_OPENSEO === "hosted",
};
