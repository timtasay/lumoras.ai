/**
 * Who is acting, for writes that Better Auth makes on our behalf (creating a
 * workspace, inviting, changing a role, impersonating). Our own tenant writes
 * pass the actor to withWorkspace() explicitly; Better Auth's adapter cannot,
 * so the request handler and our server actions run Better Auth calls inside
 * runWithAudit(), and lib/auth/audited-pool.ts copies this context into the
 * database session for as long as Better Auth holds the connection. The audit
 * triggers then record the same actor, impersonator and action.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type AuditContext = {
  actorId: string | null;
  impersonatorId?: string | null;
  requestId?: string;
  action?: string;
  /** Workspace to file events on non-tenant tables under (impersonation). */
  workspaceId?: string | null;
};

const store = new AsyncLocalStorage<AuditContext>();

export const currentAudit = () => store.getStore();

export function runWithAudit<T>(ctx: AuditContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}
