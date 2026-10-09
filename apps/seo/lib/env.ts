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
