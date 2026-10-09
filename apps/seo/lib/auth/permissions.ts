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
 *   owner           everything in the workspace, including members and billing
 *   editor          runs research and crawls, edits and approves content,
 *                   manages sites, brand profiles, authors and connections
 *   viewer          the client reviewer: sees everything, comments; no writes
 *
 * Section 5 of the build prompt also lets a client reviewer approve or reject
 * content when a site requires approval. Phase 1 has no content yet; whether
 * that becomes a viewer permission or a separate "reviewer" role is an open
 * question for the owner (docs/phase-1-summary.md). Until then viewers cannot
 * approve.
 */

export const WORKSPACE_ROLES = ["owner", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer · client reviewer",
};

export const ROLE_SUMMARY: Record<WorkspaceRole, string> = {
  owner: "Everything, including members, roles and billing.",
  editor: "Sites, brand profiles, authors, connections, crawls; edits and approves content.",
  viewer: "Sees dashboards and settings, comments. Cannot change anything.",
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
  "comment:create",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = ["workspace:read", "member:read", "site:read", "connection:read", "content:read", "audit:read"];

const EDITOR: Permission[] = [
  ...READ,
  "site:create",
  "site:update",
  "site:delete",
  "brand:update",
  "author:manage",
  "connection:manage",
  "crawl:run",
  "content:edit",
  "content:approve",
  "comment:create",
];

export const PERMISSION_MAP: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([...EDITOR, "workspace:update", "workspace:delete", "member:manage", "invitation:manage", "billing:manage"]),
  editor: new Set<Permission>(EDITOR),
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
