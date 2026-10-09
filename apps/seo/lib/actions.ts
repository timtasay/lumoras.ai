/**
 * The one way server actions touch a workspace:
 *   1. requireWorkspace(slug): signed in and a member (else 404);
 *   2. assertCan(role, permission): the permission map (else a clear refusal);
 *   3. withWorkspace(): a transaction scoped to the workspace, with the actor,
 *      impersonator and the action name set for the audit triggers.
 * Errors become an ActionState the form can show; redirects pass through.
 *
 * CSRF: Next.js refuses server-action POSTs whose Origin does not match the
 * Host (or x-forwarded-host); session cookies are SameSite=Lax.
 */
import { unstable_rethrow } from "next/navigation";
import * as z from "zod";
import { requireWorkspace, type WorkspaceAccess } from "./auth/app.ts";
import { assertCan, ForbiddenError, type Permission } from "./auth/permissions.ts";
import { pool } from "./db/pool.ts";
import { NotFoundError, withWorkspace, type Tx } from "./db/tenant.ts";
import { RateLimitedError } from "./rate-limit.ts";
import { fieldErrors } from "./validation.ts";
import { log } from "./config.ts";

import type { ActionState } from "./actions-state.ts";
export type { ActionState } from "./actions-state.ts";

export function toActionError(e: unknown): ActionState {
  unstable_rethrow(e);
  const at = Date.now();
  if (e instanceof z.ZodError) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(e), at };
  if (e instanceof ForbiddenError) return { ok: false, error: `${e.message}. Ask a workspace owner if you need this.`, at };
  if (e instanceof RateLimitedError) return { ok: false, error: e.message, at };
  if (e instanceof NotFoundError) return { ok: false, error: "That no longer exists. Reload the page.", at };
  const code = (e as { code?: string }).code;
  if (code === "23505") return { ok: false, error: "That already exists here.", at };
  if (code === "23514") return { ok: false, error: "One of the values is out of range.", at };
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && e.name === "CrawlBusyError") return { ok: false, error: message, at };
  // Better Auth APIError carries a status and a safe message
  const status = (e as { statusCode?: number }).statusCode;
  if (status && status < 500) return { ok: false, error: (e as { body?: { message?: string } }).body?.message ?? message, at };
  log().error("action failed", { err: e instanceof Error ? e : new Error(message) });
  return { ok: false, error: "Something went wrong on our side. Try again in a moment.", at };
}

/** Runs fn as a permitted member of the workspace, inside one audited transaction. */
export async function inWorkspace<T>(
  slug: string,
  permission: Permission,
  action: string,
  fn: (tx: Tx, access: WorkspaceAccess) => Promise<T>,
): Promise<T> {
  const access = await requireWorkspace(slug);
  assertCan(access.role, permission);
  return withWorkspace(pool(), access.ctx, async (tx) => {
    await tx.action(action);
    return fn(tx, access);
  });
}

/** Read-only variant for pages: no permission beyond membership unless asked. */
export async function readWorkspace<T>(slug: string, fn: (tx: Tx, access: WorkspaceAccess) => Promise<T>, permission: Permission = "workspace:read"): Promise<T> {
  const access = await requireWorkspace(slug);
  assertCan(access.role, permission);
  return withWorkspace(pool(), access.ctx, (tx) => fn(tx, access), { readOnly: true });
}

/** FormData → plain object (repeated keys become arrays). */
export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? v : "";
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], val);
    else out[k] = val;
  }
  return out;
}
