/**
 * The typed query layer. Every tenant query runs inside withWorkspace(), which
 * opens a transaction on the app role's pool and sets, transaction-locally
 * (set_config(..., true), so nothing leaks to the next user of the
 * connection):
 *
 *   app.workspace_id     the row-level security key (0004_tenancy.sql)
 *   app.actor_id         who is acting (user uuid or "system:<name>")
 *   app.impersonator_id  the platform admin, while impersonating
 *   app.request_id       correlates audit rows
 *   app.action           what the user meant ("site.create"), via tx.action()
 *
 * Writes are audited by triggers in the same transaction (0003_audit.sql), so
 * a failed write leaves neither data nor audit behind. Without a workspace
 * set, row-level security returns nothing: there is no "forgot the filter"
 * failure mode, only "saw nothing".
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

export type Actor = {
  /** auth_user.id, or "system:<name>" for scripts and jobs. */
  actorId: string;
  impersonatorId?: string | null;
  requestId?: string;
};
export type TenantContext = Actor & { workspaceId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
const ACTOR = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|system:[a-z0-9-]{1,40})$/i;

export class NotFoundError extends Error {
  constructor(what = "record") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export type Params = readonly unknown[];

/** A transaction handle with typed helpers. Only valid inside its callback. */
export class Tx {
  constructor(private readonly client: pg.PoolClient) {}

  async many<T extends pg.QueryResultRow>(sql: string, params: Params = []): Promise<T[]> {
    return (await this.client.query<T>(sql, params as unknown[])).rows;
  }

  async maybe<T extends pg.QueryResultRow>(sql: string, params: Params = []): Promise<T | null> {
    const rows = await this.many<T>(sql, params);
    return rows[0] ?? null;
  }

  async one<T extends pg.QueryResultRow>(sql: string, params: Params = [], what?: string): Promise<T> {
    const row = await this.maybe<T>(sql, params);
    if (!row) throw new NotFoundError(what);
    return row;
  }

  /** Runs a statement, returns the number of rows it touched. */
  async exec(sql: string, params: Params = []): Promise<number> {
    return (await this.client.query(sql, params as unknown[])).rowCount ?? 0;
  }

  /** Names the intent for the audit rows written from here on ("site.update"). */
  async action(name: string): Promise<void> {
    if (!/^[a-z_]+(\.[a-z_]+)+$/.test(name)) throw new Error(`bad audit action name: ${name}`);
    await this.client.query("SELECT set_config('app.action', $1, true)", [name]);
  }

  /** Records a non-row event in the audit log (crawl requested, etc.). */
  async event(action: string, entityType: string, entityId: string | null, details?: Record<string, unknown>): Promise<void> {
    await this.client.query("SELECT app_audit_event($1, $2, $3, $4::jsonb)", [action, entityType, entityId, details ? JSON.stringify(details) : null]);
  }
}

function checkActor(a: Actor) {
  if (!ACTOR.test(a.actorId)) throw new Error(`invalid actor id: ${a.actorId}`);
  if (a.impersonatorId != null && !isUuid(a.impersonatorId)) throw new Error("invalid impersonator id");
}

async function run<T>(
  db: pg.Pool,
  settings: Record<string, string>,
  readOnly: boolean,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    const names = Object.keys(settings);
    if (names.length) {
      // one round trip: SELECT set_config($1,$2,true), set_config($3,$4,true), …
      const sql = "SELECT " + names.map((_, i) => `set_config($${i * 2 + 1}, $${i * 2 + 2}, true)`).join(", ");
      await client.query(sql, names.flatMap((n) => [n, settings[n]]));
    }
    const out = await fn(new Tx(client));
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const actorSettings = (a: Actor) => ({
  "app.actor_id": a.actorId,
  "app.impersonator_id": a.impersonatorId ?? "",
  "app.request_id": a.requestId ?? randomUUID(),
});

/** Runs fn in a transaction scoped to one workspace. */
export function withWorkspace<T>(db: pg.Pool, ctx: TenantContext, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
  if (!isUuid(ctx.workspaceId)) return Promise.reject(new Error("withWorkspace needs a workspace uuid"));
  checkActor(ctx);
  return run(db, { "app.workspace_id": ctx.workspaceId, ...actorSettings(ctx) }, !!opts.readOnly, fn);
}

/**
 * Runs fn with an actor but NO workspace: tenant tables are invisible. Used for
 * the audited platform_* functions and for Better Auth's own tables.
 */
export function withActor<T>(db: pg.Pool, actor: Actor, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean; auditWorkspaceId?: string } = {}): Promise<T> {
  checkActor(actor);
  const s: Record<string, string> = actorSettings(actor);
  if (opts.auditWorkspaceId) {
    if (!isUuid(opts.auditWorkspaceId)) return Promise.reject(new Error("bad audit workspace id"));
    s["app.audit_workspace_id"] = opts.auditWorkspaceId;
  }
  return run(db, s, !!opts.readOnly, fn);
}
