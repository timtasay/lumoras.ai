/**
 * Workspaces, memberships, the audit trail, notifications and the platform
 * (agency) path.
 *
 * Membership lives in Better Auth's tables (not tenant tables, no RLS), so
 * "which workspaces can this user open, with which role" is a plain query on
 * the app pool. Everything inside a workspace goes through withWorkspace().
 */
import type pg from "pg";
import type { Tx } from "../db/tenant.ts";
import { isWorkspaceRole, type WorkspaceRole } from "../auth/permissions.ts";

export type Membership = { id: string; name: string; slug: string; role: WorkspaceRole; logo: string | null };

export async function listMemberships(db: pg.Pool, userId: string): Promise<Membership[]> {
  const r = await db.query<Membership>(
    `SELECT o.id, o.name, o.slug, o.logo, m.role FROM auth_member m JOIN auth_organization o ON o.id = m.organization_id
     WHERE m.user_id = $1 ORDER BY o.name`,
    [userId],
  );
  return r.rows.filter((m) => isWorkspaceRole(m.role));
}

export async function membershipBySlug(db: pg.Pool, userId: string, slug: string): Promise<Membership | null> {
  const r = await db.query<Membership>(
    `SELECT o.id, o.name, o.slug, o.logo, m.role FROM auth_member m JOIN auth_organization o ON o.id = m.organization_id
     WHERE m.user_id = $1 AND o.slug = $2`,
    [userId, slug],
  );
  const m = r.rows[0];
  return m && isWorkspaceRole(m.role) ? m : null;
}

export async function slugTaken(db: pg.Pool, slug: string): Promise<boolean> {
  return (await db.query("SELECT 1 FROM auth_organization WHERE slug = $1", [slug])).rowCount! > 0;
}

export const ONBOARDING_STEPS = ["site", "scan", "brand", "authors", "search", "publishing", "schedule", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type WorkspaceRow = {
  id: string;
  status: "onboarding" | "active" | "paused";
  onboarding_step: OnboardingStep;
  onboarding_site_id: string | null;
  onboarded_at: Date | null;
  created_at: Date;
};

export function getWorkspaceRow(tx: Tx): Promise<WorkspaceRow> {
  return tx.one<WorkspaceRow>("SELECT id, status, onboarding_step, onboarding_site_id, onboarded_at, created_at FROM workspaces", [], "workspace");
}

/** Moves onboarding forward (never backward) and optionally pins the site being onboarded. */
export async function advanceOnboarding(tx: Tx, step: OnboardingStep, siteId?: string): Promise<void> {
  const idx = ONBOARDING_STEPS.indexOf(step);
  await tx.exec(
    `UPDATE workspaces SET
       onboarding_step = CASE WHEN array_position($1::text[], onboarding_step) < $2 THEN $3 ELSE onboarding_step END,
       onboarding_site_id = coalesce($4, onboarding_site_id),
       status = CASE WHEN $3 = 'done' THEN 'active' ELSE status END,
       onboarded_at = CASE WHEN $3 = 'done' AND onboarded_at IS NULL THEN now() ELSE onboarded_at END`,
    [ONBOARDING_STEPS as unknown as string[], idx + 1, step, siteId ?? null],
  );
}

export type MemberRow = { member_id: string; user_id: string; name: string; email: string; image: string | null; role: WorkspaceRole; joined_at: Date };
export type InvitationRow = { id: string; email: string; role: WorkspaceRole; status: string; expires_at: Date; created_at: Date; inviter_email: string };

export async function listMembers(db: pg.Pool, workspaceId: string): Promise<MemberRow[]> {
  return (
    await db.query<MemberRow>(
      `SELECT m.id AS member_id, u.id AS user_id, u.name, u.email, u.image, m.role, m.created_at AS joined_at
       FROM auth_member m JOIN auth_user u ON u.id = m.user_id WHERE m.organization_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.email`,
      [workspaceId],
    )
  ).rows;
}

export async function listPendingInvitations(db: pg.Pool, workspaceId: string): Promise<InvitationRow[]> {
  return (
    await db.query<InvitationRow>(
      `SELECT i.id, i.email, coalesce(i.role, 'viewer') AS role, i.status, i.expires_at, i.created_at, u.email AS inviter_email
       FROM auth_invitation i JOIN auth_user u ON u.id = i.inviter_id
       WHERE i.organization_id = $1 AND i.status = 'pending' AND i.expires_at > now() ORDER BY i.created_at DESC`,
      [workspaceId],
    )
  ).rows;
}

export type InvitationDetails = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  expires_at: Date;
  workspace_name: string;
  workspace_slug: string;
  inviter_name: string;
  inviter_email: string;
};

/** Invitation details for the accept page (the id is an unguessable uuid). */
export async function getInvitation(db: pg.Pool, id: string): Promise<InvitationDetails | null> {
  const r = await db.query<InvitationDetails>(
    `SELECT i.id, i.email, coalesce(i.role, 'viewer') AS role, i.status, i.expires_at, o.name AS workspace_name, o.slug AS workspace_slug,
            u.name AS inviter_name, u.email AS inviter_email
     FROM auth_invitation i JOIN auth_organization o ON o.id = i.organization_id JOIN auth_user u ON u.id = i.inviter_id
     WHERE i.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

// --------------------------------------------------------------------------
// Audit trail (tenant view: row-level security limits it to this workspace)
// --------------------------------------------------------------------------
export type AuditRow = {
  id: string;
  at: Date;
  actor_id: string | null;
  actor_email: string | null;
  impersonator_id: string | null;
  impersonator_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  workspace_name?: string | null;
};

export function listAudit(tx: Tx, opts: { before?: string | null; limit?: number; entity?: string | null } = {}): Promise<AuditRow[]> {
  return tx.many<AuditRow>(
    `SELECT a.id::text, a.at, a.actor_id, au.email AS actor_email, a.impersonator_id, iu.email AS impersonator_email,
            a.action, a.entity_type, a.entity_id, a.before, a.after, a.details
     FROM audit_log a
     LEFT JOIN auth_user au ON au.id::text = a.actor_id
     LEFT JOIN auth_user iu ON iu.id = a.impersonator_id
     WHERE ($1::bigint IS NULL OR a.id < $1::bigint) AND ($3::text IS NULL OR a.entity_type = $3)
     ORDER BY a.id DESC LIMIT $2`,
    [opts.before ?? null, Math.min(opts.limit ?? 50, 200), opts.entity ?? null],
  );
}

// --------------------------------------------------------------------------
// Notifications (minimal)
// --------------------------------------------------------------------------
export type NotificationRow = { id: string; kind: string; title: string; body: string; href: string | null; read_at: Date | null; created_at: Date };

export function notify(tx: Tx, workspaceId: string, userIds: string[], n: { kind: string; title: string; body?: string; href?: string }): Promise<number> {
  if (!userIds.length) return Promise.resolve(0);
  return tx.exec(
    `INSERT INTO notifications (workspace_id, user_id, kind, title, body, href) SELECT $1, unnest($2::uuid[]), $3, $4, $5, $6`,
    [workspaceId, userIds, n.kind, n.title.slice(0, 200), (n.body ?? "").slice(0, 1000), n.href ?? null],
  );
}

export function listNotifications(tx: Tx, userId: string, limit = 20): Promise<NotificationRow[]> {
  return tx.many<NotificationRow>(
    "SELECT id, kind, title, body, href, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit],
  );
}

export function markNotificationsRead(tx: Tx, userId: string): Promise<number> {
  return tx.exec("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
}

// --------------------------------------------------------------------------
// Platform admin path (0005_platform.sql): audited SECURITY DEFINER functions.
// Call inside withActor() with the platform admin as actor.
// --------------------------------------------------------------------------
export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  status: string | null;
  onboarding_step: string | null;
  sites: number;
  members: number;
  owners: string[];
  routes: number;
  failing_connections: number;
  last_crawl_at: Date | null;
  last_activity_at: Date | null;
};

export const platformWorkspaces = (tx: Tx) => tx.many<WorkspaceSummary>("SELECT * FROM platform_workspace_summaries()");

export const platformMembers = (tx: Tx, workspaceId: string) =>
  tx.many<{ user_id: string; name: string; email: string; role: WorkspaceRole; is_platform_admin: boolean }>(
    "SELECT * FROM platform_workspace_members($1)",
    [workspaceId],
  );

export const platformAudit = (tx: Tx, opts: { workspaceId?: string | null; before?: string | null; limit?: number } = {}) =>
  tx.many<AuditRow>(
    `SELECT id::text, at, actor_id, actor_email, impersonator_id, impersonator_email, action, entity_type, entity_id, before, after, details, workspace_name
     FROM platform_audit_log($1, $2, $3)`,
    [opts.workspaceId ?? null, opts.before ?? null, opts.limit ?? 50],
  );
