/**
 * Process-wide configuration for the web server: the validated environment,
 * the logger and the encryption keyring, each read once on first use (never
 * at import time, so `next build` runs without secrets).
 */
import { readWebEnv, type WebEnv } from "./env.ts";
import { createLogger, type Logger } from "./log.ts";
import { readKeyring, type Keyring } from "./crypto/secrets.ts";

type Globals = { __seoEnv?: WebEnv; __seoLog?: Logger; __seoKeyring?: Keyring };
const g = globalThis as Globals;

export function webEnv(): WebEnv {
  if (!g.__seoEnv) {
    g.__seoEnv = readWebEnv();
    const e = g.__seoEnv;
    const warn = createLogger("web", { level: e.logLevel });
    if (e.emailOutboxDir) warn.warn("EMAIL_OUTBOX_DIR is set: outgoing email is written to disk, not sent (tests only)");
    if (e.crawlerTestOrigins.size) warn.warn("CRAWLER_TEST_ORIGINS is set: the crawler may reach local fake sites (tests only)", { domains: [...e.crawlerTestOrigins.keys()] });
    if (e.rateLimitScale !== 1) warn.warn("RATE_LIMIT_SCALE is set: rate limits are relaxed (tests only)", { scale: e.rateLimitScale });
    if (e.googleApiTestOrigin) warn.warn("GOOGLE_API_TEST_ORIGIN is set: Google OAuth and APIs point at a local fake (tests only)", { origin: e.googleApiTestOrigin });
    if (e.seoProvider.kind === "fake" && process.env.NODE_ENV === "production") warn.warn("SEO_PROVIDER=fake in a production build: research returns demo data (tests only)");
  }
  return g.__seoEnv;
}

export function log(): Logger {
  return (g.__seoLog ??= createLogger("web", { level: webEnv().logLevel }));
}

export function keyring(): Keyring {
  return (g.__seoKeyring ??= readKeyring());
}
