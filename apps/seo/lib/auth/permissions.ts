/**
 * The permission map: the single answer to "may this role do that?".
 * Server actions and route handlers call can()/assertCan() before touching
 * data; Better Auth's organization plugin gets the same map (toBetterAuthRoles)
 * for its own member and invitation endpoints, so the two never disagree.
 *
 * Roles
 *   platform admin  Lumoras staff (auth_user.role = 'admin'). Not a workspace
 *                   role: reads every workspace through the audited platform
 *                   path and acts inside one only by impersonating a member.
 *   owner           everything in the workspace, including members, billing
 *                   and the budget and reserve
 *   editor          runs research (paid, within the budget) and crawls, edits
 *                   and approves content, manages sites, brand profiles,
 *                   authors, keywords, the seed backlog and connections
 *                   (including Search Console and GA4); runs measurement
 *                   now (paid rank checks, audits and backlinks, within the
 *                   budget) and assigns and works audit tasks
 *   reviewer        the client reviewer (owner decision, October 2026): sees
 *                   everything, comments, and approves, rejects or requests
 *                   changes on content awaiting review. Cannot edit content,
 *                   run research or anything else that spends, manage
 *                   connections, members, the budget or settings.
 *   viewer          read-only: sees everything and comments; no writes, no
 *                   approvals
 */

/** Most powerful first. */
export const WORKSPACE_ROLES = ["owner", "editor", "reviewer", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  editor: "Editor",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

export const ROLE_SUMMARY: Record<WorkspaceRole, string> = {
  owner: "Everything, including members, roles, billing and the budget.",
  editor: "Sites, brand profiles, authors, connections, crawls, research within the budget; edits and approves content.",
  reviewer: "Sees everything, comments, and approves, rejects or requests changes on articles awaiting review. Cannot edit or spend.",
  viewer: "Sees dashboards and settings, comments. Cannot change or approve anything.",
};

/** Every action the app checks, as resource:verb. */
export const PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "workspace:delete",
  "member:read",
  "member:manage",
  "invitation:manage",
  "billing:manage",
  "site:read",
  "site:create",
  "site:update",
  "site:delete",
  "brand:update",
  "author:manage",
  "connection:read",
  "connection:manage",
  "crawl:run",
  "content:read",
  "content:edit",
  "content:approve",
  "content:schedule",
  "pipeline:run",
  "comment:create",
  "audit:read",
  "research:run",
  "keyword:manage",
  "budget:read",
  "budget:manage",
  // Phase 4: run paid measurement now (rank check, audit, backlinks) or a Search Console / GA4 sync; act on audit tasks
  "measure:run",
  "task:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = ["workspace:read", "member:read", "site:read", "connection:read", "content:read", "audit:read", "budget:read"];

const EDITOR: Permission[] = [
  ...READ,
  "site:create",
  "site:update",
  "site:delete",
  "brand:update",
  "author:manage",
  "connection:manage",
  "crawl:run",
  "research:run",
  "keyword:manage",
  "content:edit",
  "content:approve",
  "content:schedule",
  "pipeline:run",
  "comment:create",
  "measure:run",
  "task:manage",
];

export const PERMISSION_MAP: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([...EDITOR, "workspace:update", "workspace:delete", "member:manage", "invitation:manage", "billing:manage", "budget:manage"]),
  editor: new Set<Permission>(EDITOR),
  reviewer: new Set<Permission>([...READ, "comment:create", "content:approve"]),
  viewer: new Set<Permission>([...READ, "comment:create"]),
};

export const isWorkspaceRole = (r: unknown): r is WorkspaceRole => typeof r === "string" && (WORKSPACE_ROLES as readonly string[]).includes(r);

export function can(role: WorkspaceRole | null | undefined, p: Permission): boolean {
  return !!role && PERMISSION_MAP[role].has(p);
}

export class ForbiddenError extends Error {
  constructor(
    public readonly permission: Permission,
    public readonly role: WorkspaceRole | null,
  ) {
    super(`${role ? `The ${ROLE_LABEL[role].toLowerCase()} role` : "You"} cannot ${permission.replace(":", " → ")}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: WorkspaceRole | null | undefined, p: Permission): void {
  if (!can(role, p)) throw new ForbiddenError(p, role ?? null);
}

/**
 * Better Auth organization-plugin statements per role, derived from the map
 * above: organization update/delete, member create/update/delete, invitation
 * create/cancel.
 */
export function betterAuthStatements(role: WorkspaceRole) {
  return {
    organization: [...(can(role, "workspace:update") ? ["update"] : []), ...(can(role, "workspace:delete") ? ["delete"] : [])],
    member: can(role, "member:manage") ? ["create", "update", "delete"] : [],
    invitation: can(role, "invitation:manage") ? ["create", "cancel"] : [],
  } as { organization: ("update" | "delete")[]; member: ("create" | "update" | "delete")[]; invitation: ("create" | "cancel")[] };
}
