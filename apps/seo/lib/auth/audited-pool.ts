/**
 * The pool Better Auth uses: the app role's pool, plus audit context.
 *
 * Better Auth (through Kysely) checks a client out with connect(), runs one
 * query or one transaction, and releases it. When a runWithAudit() context is
 * active, we set app.actor_id / app.impersonator_id / app.action /
 * app.request_id / app.audit_workspace_id on the session as the client is
 * checked out, and clear them again before it goes back to the pool (a client
 * whose reset fails is destroyed rather than reused). The audit triggers on
 * auth_organization, auth_member, auth_invitation, auth_user and auth_session
 * read them in the same transaction as Better Auth's write.
 *
 * These settings never include app.workspace_id: Better Auth's tables are not
 * tenant tables and its connections must not see tenant rows.
 */
import type pg from "pg";
import { currentAudit } from "./audit-context.ts";

const KEYS = ["app.actor_id", "app.impersonator_id", "app.action", "app.request_id", "app.audit_workspace_id"] as const;
const SET_SQL = "SELECT " + KEYS.map((_, i) => `set_config('${KEYS[i]}', $${i + 1}, false)`).join(", ");
const RESET_SQL = "SELECT " + KEYS.map((k) => `set_config('${k}', '', false)`).join(", ");

export type PoolLike = { connect(): Promise<pg.PoolClient>; end(): Promise<void> };

export function auditedPool(base: pg.Pool): PoolLike {
  return {
    async connect() {
      const client = await base.connect();
      const ctx = currentAudit();
      if (!ctx) return client;
      try {
        await client.query(SET_SQL, [
          ctx.actorId ?? "",
          ctx.impersonatorId ?? "",
          ctx.action ?? "",
          ctx.requestId ?? "",
          ctx.workspaceId ?? "",
        ]);
      } catch (e) {
        client.release(e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
      const original = client.release;
      const release = original.bind(client);
      client.release = ((err?: Error | boolean) => {
        // the pool reuses this client object: put the real release back first
        client.release = original;
        if (err) return release(err);
        client.query(RESET_SQL).then(
          () => release(),
          (e: unknown) => release(e instanceof Error ? e : new Error(String(e))),
        );
      }) as typeof client.release;
      return client;
    },
    end: () => base.end(),
  };
}
