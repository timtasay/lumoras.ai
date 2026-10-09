/**
 * Makes an existing user a platform admin (Lumoras staff), or takes it away:
 *   pnpm --filter seo admin:grant someone@lumoras.ai
 *   pnpm --filter seo admin:grant someone@lumoras.ai --revoke
 * The user must have signed in once. Recorded in the audit log as
 * system:cli / platform.admin.grant (or .revoke). Env: DATABASE_URL.
 */
import pg from "pg";
import { createLogger } from "../lib/log.ts";

const log = createLogger("grant-admin");

async function main(): Promise<number> {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email || !process.env.DATABASE_URL) {
    log.error("usage: DATABASE_URL=… admin:grant <email> [--revoke]");
    return 1;
  }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id', 'system:cli', true), set_config('app.action', $1, true)", [revoke ? "platform.admin.revoke" : "platform.admin.grant"]);
    const r = await c.query("UPDATE auth_user SET role = $2 WHERE email = $1", [email, revoke ? "user" : "admin"]);
    if (!r.rowCount) {
      await c.query("ROLLBACK");
      log.error("no such user (they must sign in once first)", { email });
      return 1;
    }
    // end their sessions so the change applies at once
    await c.query("DELETE FROM auth_session WHERE user_id = (SELECT id FROM auth_user WHERE email = $1)", [email]);
    await c.query("COMMIT");
    log.info(revoke ? "platform admin revoked" : "platform admin granted", { email });
    return 0;
  } finally {
    await c.end();
  }
}

main().then((code) => {
  process.exitCode = code;
});
