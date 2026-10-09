import { LiveShell } from "@/components/shell/LiveShell";
import type { ShellData, ShellNotification } from "@/components/shell/AppShell";
import type { ShellWorkspace } from "@/components/shell/nav";
import { requireViewer } from "@/lib/auth/app";
import { pool } from "@/lib/db/pool";
import { withWorkspace } from "@/lib/db/tenant";
import { listMemberships, listNotifications } from "@/lib/data/workspaces";
import { isDesignRouteEnabled } from "@/lib/env";
import { relativeTime } from "@/lib/ui/time";

/**
 * Every signed-in page: the viewer's workspaces with their sites (for the
 * switcher, the sidebar and ⌘K) and their latest notifications, each read in
 * that workspace's own row-level-security scope.
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const memberships = (await listMemberships(pool(), viewer.user.id)).slice(0, 30);
  const workspaces: ShellWorkspace[] = [];
  const notes: (ShellNotification & { t: number })[] = [];
  for (const m of memberships) {
    await withWorkspace(
      pool(),
      { workspaceId: m.id, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId },
      async (tx) => {
        const sites = await tx.many<{ id: string; name: string; domain: string }>("SELECT id, name, domain FROM sites ORDER BY created_at, domain");
        workspaces.push({ id: m.id, name: m.name, slug: m.slug, role: m.role, sites });
        for (const n of await listNotifications(tx, viewer.user.id, 8)) {
          notes.push({ id: n.id, title: n.title, body: n.body, href: n.href, read: !!n.read_at, at: relativeTime(n.created_at), workspace: m.name, t: n.created_at.getTime() });
        }
      },
      { readOnly: true },
    );
  }
  const data: ShellData = {
    user: { name: viewer.user.name, email: viewer.user.email },
    platformAdmin: viewer.isPlatformAdmin,
    impersonation: viewer.impersonator ? { adminEmail: viewer.impersonator.email } : null,
    workspaces,
    notifications: notes.sort((a, b) => b.t - a.t).slice(0, 10).map(({ t: _t, ...n }) => n),
    designEnabled: isDesignRouteEnabled(),
  };
  return <LiveShell data={data}>{children}</LiveShell>;
}
