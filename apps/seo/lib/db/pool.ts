/**
 * The one connection pool for the app role (DATABASE_URL: not a superuser,
 * no BYPASSRLS, owns nothing). Tenant queries go through lib/db/tenant.ts;
 * Better Auth gets the same pool wrapped by lib/auth/audited-pool.ts.
 */
import pg from "pg";
import { log, webEnv } from "../config.ts";

const g = globalThis as { __seoPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__seoPool) {
    g.__seoPool = new pg.Pool({
      connectionString: webEnv().databaseUrl,
      application_name: "lumoras-seo-web",
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    });
    // an idle client can lose its connection (Postgres restarted, network blip); pg then emits
    // "error" on the pool, which would crash the process if nobody listened. The pool replaces it.
    g.__seoPool.on("error", (err) => log().warn("idle database connection lost", { err: err.message }));
  }
  return g.__seoPool;
}
