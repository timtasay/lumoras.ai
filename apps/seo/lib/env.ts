/**
 * Environment parsing for the processes in this image (web, worker, migrate).
 * Every variable is documented in .env.example. Validation collects every
 * problem before failing, so a misconfigured container says everything at once.
 */
import { isLogLevel, type LogLevel } from "./log.ts";

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvError";
  }
}

type Env = Record<string, string | undefined>;

function postgresUrl(env: Env, name: string, problems: string[], required: boolean): string | undefined {
  const v = env[name]?.trim();
  if (!v) {
    if (required) problems.push(`${name} is required (postgres://user:password@host:5432/seo)`);
    return undefined;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
      problems.push(`${name} must be a postgres:// URL`);
      return undefined;
    }
    if (!u.username) problems.push(`${name} must name a role (user)`);
    if (u.pathname.length < 2) problems.push(`${name} must name a database`);
  } catch {
    problems.push(`${name} is not a valid URL`);
    return undefined;
  }
  return v;
}

const roleOf = (url: string) => decodeURIComponent(new URL(url).username);

function logLevel(env: Env, problems: string[]): LogLevel {
  const v = env.LOG_LEVEL?.trim();
  if (!v) return "info";
  if (isLogLevel(v)) return v;
  problems.push(`LOG_LEVEL must be one of debug, info, warn, error (got "${v}")`);
  return "info";
}

export type MigrateEnv = { ownerUrl: string; logLevel: LogLevel };

/**
 * Migrations run as the owner role (DATABASE_URL_OWNER), never as the app role.
 * If DATABASE_URL is also set and names the same role, refuse: the app role
 * must not own the schema, or row-level security stops binding it.
 */
export function readMigrateEnv(env: Env = process.env): MigrateEnv {
  const problems: string[] = [];
  const ownerUrl = postgresUrl(env, "DATABASE_URL_OWNER", problems, true);
  const appUrl = postgresUrl(env, "DATABASE_URL", problems, false);
  if (ownerUrl && appUrl && !problems.length && roleOf(ownerUrl) === roleOf(appUrl)) {
    problems.push(
      `DATABASE_URL_OWNER and DATABASE_URL use the same role ("${roleOf(ownerUrl)}"); migrations need the separate owner role`,
    );
  }
  const level = logLevel(env, problems);
  if (problems.length || !ownerUrl) throw new EnvError(problems);
  return { ownerUrl, logLevel: level };
}

export type WorkerEnv = { databaseUrl: string; logLevel: LogLevel; heartbeatMs: number };

export function readWorkerEnv(env: Env = process.env): WorkerEnv {
  const problems: string[] = [];
  const databaseUrl = postgresUrl(env, "DATABASE_URL", problems, true);
  const level = logLevel(env, problems);
  let heartbeatMs = 300_000;
  const hb = env.WORKER_HEARTBEAT_MS?.trim();
  if (hb) {
    const n = Number(hb);
    if (!Number.isInteger(n) || n < 1000) problems.push("WORKER_HEARTBEAT_MS must be an integer ≥ 1000");
    else heartbeatMs = n;
  }
  if (problems.length || !databaseUrl) throw new EnvError(problems);
  return { databaseUrl, logLevel: level, heartbeatMs };
}

/**
 * The /design route is a development tool: on in development, and in a
 * production build only when ENABLE_DESIGN_ROUTE=1 (for review deploys).
 */
export function isDesignRouteEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" || env.ENABLE_DESIGN_ROUTE === "1";
}

const isLoopbackHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

/** CRAWLER_TEST_ORIGINS (tests only, see .env.example): domain → where the fake site really is. */
export type TestOrigins = Map<string, { address: string; origin: string }>;

export type WebEnv = {
  databaseUrl: string;
  logLevel: LogLevel;
  /** Public origin, e.g. https://growth.lumoras.ai (no trailing slash). */
  baseUrl: string;
  /** True when baseUrl is https: secure cookies, HSTS-style CSP upgrade. */
  secure: boolean;
  authSecret: string;
  google: { clientId: string; clientSecret: string } | null;
  email: { resendKey: string; from: string; fromName: string } | null;
  /** Tests only: write outgoing email as JSON files here instead of sending. */
  emailOutboxDir: string | null;
  /** Scales the auth and action rate limits (tests run many sign-ins from one IP). Default 1. */
  rateLimitScale: number;
  /** Tests only: crawl these domains at a local fake site (loopback, any port). */
  crawlerTestOrigins: TestOrigins;
  /** Which SEO data provider answers research calls (lib/providers/registry.ts). */
  seoProvider: SeoProviderEnv;
  /** OAuth client for Search Console and GA4 connections; null turns the connect buttons into a "not configured" state. */
  googleOAuth: { clientId: string; clientSecret: string } | null;
  /** Tests only: every Google endpoint (OAuth and APIs) lives at this loopback origin. */
  googleApiTestOrigin: string | null;
};

export type SeoProviderEnv =
  | { kind: "none" }
  | { kind: "fake" }
  | { kind: "openseo"; url: string; token: string | null; cfAccess: { clientId: string; clientSecret: string } | null }
  | { kind: "dataforseo"; login: string; password: string; baseUrl: string };

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

/**
 * SEO_PROVIDER and its credentials. Default: "fake" in development and tests,
 * "none" in production (no paid data until a real provider is configured,
 * and never demo data by accident). "fake" in production is a test knob,
 * refused next to an https base URL like the others.
 */
export function readSeoProviderEnv(env: Env, problems: string[], opts: { production: boolean; secure: boolean }): SeoProviderEnv {
  const raw = env.SEO_PROVIDER?.trim() || (opts.production ? "none" : "fake");
  switch (raw) {
    case "none":
      return { kind: "none" };
    case "fake":
      if (opts.secure) problems.push("SEO_PROVIDER=fake serves demo data and cannot be used with an https BETTER_AUTH_URL");
      return { kind: "fake" };
    case "openseo": {
      const url = env.OPENSEO_MCP_URL?.trim() || "";
      if (!url) problems.push("OPENSEO_MCP_URL is required when SEO_PROVIDER=openseo (e.g. http://open-seo:3001/mcp on the private network)");
      else {
        try {
          const u = new URL(url);
          if (u.protocol !== "https:" && u.protocol !== "http:") problems.push("OPENSEO_MCP_URL must be an http(s) URL");
          if (u.username || u.password) problems.push("OPENSEO_MCP_URL must not contain credentials (use OPENSEO_MCP_TOKEN)");
        } catch {
          problems.push("OPENSEO_MCP_URL is not a valid URL");
        }
      }
      const id = env.OPENSEO_CF_ACCESS_CLIENT_ID?.trim(), secret = env.OPENSEO_CF_ACCESS_CLIENT_SECRET?.trim();
      if (!!id !== !!secret) problems.push("OPENSEO_CF_ACCESS_CLIENT_ID and OPENSEO_CF_ACCESS_CLIENT_SECRET must be set together");
      return { kind: "openseo", url, token: env.OPENSEO_MCP_TOKEN?.trim() || null, cfAccess: id && secret ? { clientId: id, clientSecret: secret } : null };
    }
    case "dataforseo": {
      const login = env.DATAFORSEO_LOGIN?.trim() || "", password = env.DATAFORSEO_PASSWORD?.trim() || "";
      if (!login || !password) problems.push("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required when SEO_PROVIDER=dataforseo");
      const baseUrl = (env.DATAFORSEO_BASE_URL?.trim() || "https://api.dataforseo.com").replace(/\/+$/, "");
      const allowed = baseUrl === "https://api.dataforseo.com" || baseUrl === "https://sandbox.dataforseo.com" || (!opts.secure && LOOPBACK_ORIGIN.test(baseUrl));
      if (!allowed) problems.push("DATAFORSEO_BASE_URL must be https://api.dataforseo.com or https://sandbox.dataforseo.com (a loopback origin only in tests)");
      return { kind: "dataforseo", login, password, baseUrl };
    }
    default:
      problems.push(`SEO_PROVIDER must be one of none, fake, openseo, dataforseo (got "${raw}")`);
      return { kind: "none" };
  }
}

/**
 * Settings for the web server (Next.js) and anything it imports. Read once,
 * lazily, on first use (lib/config.ts), so `next build` does not need them.
 * Test-only knobs refuse to load next to a real (https) base URL.
 */
export function readWebEnv(env: Env = process.env): WebEnv {
  const problems: string[] = [];
  const databaseUrl = postgresUrl(env, "DATABASE_URL", problems, true);
  const level = logLevel(env, problems);
  const production = env.NODE_ENV === "production";

  let baseUrl = env.BETTER_AUTH_URL?.trim() || "";
  if (!baseUrl) {
    if (production) problems.push("BETTER_AUTH_URL is required (the public origin, e.g. https://growth.lumoras.ai)");
    else baseUrl = `http://localhost:${env.PORT?.trim() || "3007"}`;
  }
  let secure = false;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (u.pathname !== "/" || u.search || u.hash) problems.push("BETTER_AUTH_URL must be an origin only (no path)");
      secure = u.protocol === "https:";
      if (!secure && (u.protocol !== "http:" || (production && !isLoopbackHost(u.hostname)))) {
        problems.push("BETTER_AUTH_URL must use https (plain http is allowed only for localhost)");
      }
      baseUrl = u.origin;
    } catch {
      problems.push("BETTER_AUTH_URL is not a valid URL");
    }
  }

  let authSecret = env.BETTER_AUTH_SECRET?.trim() || "";
  if (!authSecret) {
    if (production) problems.push("BETTER_AUTH_SECRET is required (32+ random bytes, e.g. `openssl rand -base64 32`)");
    else authSecret = "development-only-secret-do-not-use-in-production-0000";
  } else if (authSecret.length < 32) problems.push("BETTER_AUTH_SECRET must be at least 32 characters");

  const gid = env.GOOGLE_CLIENT_ID?.trim(), gsecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!!gid !== !!gsecret) problems.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together (or both left empty to turn Google sign-in off)");
  const google = gid && gsecret ? { clientId: gid, clientSecret: gsecret } : null;

  const resendKey = env.RESEND_API_KEY?.trim(), from = env.EMAIL_FROM?.trim();
  if (resendKey && !from) problems.push("EMAIL_FROM is required when RESEND_API_KEY is set");
  const email = resendKey && from ? { resendKey, from, fromName: env.EMAIL_FROM_NAME?.trim() || "Lumoras Growth" } : null;

  const emailOutboxDir = env.EMAIL_OUTBOX_DIR?.trim() || null;
  if (emailOutboxDir && secure) problems.push("EMAIL_OUTBOX_DIR is for tests only and cannot be used with an https BETTER_AUTH_URL");
  if (production && !email && !emailOutboxDir) {
    problems.push("RESEND_API_KEY and EMAIL_FROM are required in production (sign-in links are sent by email)");
  }

  let rateLimitScale = 1;
  const rls = env.RATE_LIMIT_SCALE?.trim();
  if (rls) {
    const n = Number(rls);
    if (!Number.isFinite(n) || n < 1 || n > 1000) problems.push("RATE_LIMIT_SCALE must be a number from 1 to 1000");
    else if (secure && n !== 1) problems.push("RATE_LIMIT_SCALE is for tests only and cannot be used with an https BETTER_AUTH_URL");
    else rateLimitScale = n;
  }

  const crawlerTestOrigins: TestOrigins = new Map();
  const cto = env.CRAWLER_TEST_ORIGINS?.trim();
  if (cto) {
    if (secure) problems.push("CRAWLER_TEST_ORIGINS is for tests only and cannot be used with an https BETTER_AUTH_URL");
    for (const pair of cto.split(",")) {
      const m = /^([a-z0-9.-]+\.test)=http:\/\/127\.0\.0\.1:(\d{2,5})$/.exec(pair.trim());
      if (!m) problems.push(`CRAWLER_TEST_ORIGINS entry "${pair}" must look like fake-site.test=http://127.0.0.1:4555`);
      else crawlerTestOrigins.set(m[1], { address: "127.0.0.1", origin: `http://${m[1]}:${m[2]}` });
    }
  }

  const seoProvider = readSeoProviderEnv(env, problems, { production, secure });

  const goid = env.GOOGLE_OAUTH_CLIENT_ID?.trim(), gosecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!!goid !== !!gosecret) problems.push("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together (or both left empty: Search Console and GA4 show as not configured)");
  const googleOAuth = goid && gosecret ? { clientId: goid, clientSecret: gosecret } : null;
  const gto = env.GOOGLE_API_TEST_ORIGIN?.trim() || null;
  if (gto && secure) problems.push("GOOGLE_API_TEST_ORIGIN is for tests only and cannot be used with an https BETTER_AUTH_URL");
  else if (gto && !LOOPBACK_ORIGIN.test(gto)) problems.push("GOOGLE_API_TEST_ORIGIN must look like http://127.0.0.1:4566");

  if (problems.length || !databaseUrl) throw new EnvError(problems);
  return { databaseUrl, logLevel: level, baseUrl, secure, authSecret, google, email, emailOutboxDir, rateLimitScale, crawlerTestOrigins, seoProvider, googleOAuth, googleApiTestOrigin: gto };
}
