import type { Metadata } from "next";
import Link from "next/link";
import { MembersPanel } from "@/components/forms/MembersPanel";
import { RenameWorkspace } from "@/components/forms/RenameWorkspace";
import { Icon } from "@/components/Icons";
import { Badge } from "@/components/ui/Status";
import { requireWorkspace } from "@/lib/auth/app";
import { can, ROLE_LABEL, ROLE_SUMMARY, WORKSPACE_ROLES } from "@/lib/auth/permissions";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { listMembers, listPendingInvitations } from "@/lib/data/workspaces";
import { dateLabel } from "@/lib/ui/time";
import { cancelInvitationAction, changeRoleAction, inviteAction, removeMemberAction, renameWorkspaceAction } from "../actions";

export const metadata: Metadata = { title: "Members and roles" };

export default async function WorkspaceSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await requireWorkspace(slug);
  const [members, invitations] = await Promise.all([listMembers(pool(), a.workspace.id), can(a.role, "member:read") ? listPendingInvitations(pool(), a.workspace.id) : []]);
  const manage = can(a.role, "member:manage");
  const base = webEnv().baseUrl;
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>{a.workspace.name}</b> · settings
          </p>
          <h1>Members and roles</h1>
          <p className="lede">Who can see and change this workspace. Every change here is recorded in the audit log.</p>
        </div>
      </header>

      <ul className="role-cards">
        {WORKSPACE_ROLES.map((r) => (
          <li key={r} className="panel role-card" data-yours={a.role === r ? "" : undefined}>
            <p className="role-name">
              {ROLE_LABEL[r]} {a.role === r ? <Badge tone="ion">You</Badge> : null}
            </p>
            <p className="muted small">{ROLE_SUMMARY[r]}</p>
          </li>
        ))}
      </ul>

      <MembersPanel
        canManage={manage}
        members={members.map((m) => ({ memberId: m.member_id, userId: m.user_id, name: m.name, email: m.email, role: m.role, joined: dateLabel(m.joined_at), you: m.user_id === a.viewer.user.id }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expires: dateLabel(i.expires_at), inviter: i.inviter_email, link: `${base}/accept-invitation/${i.id}` }))}
        invite={inviteAction.bind(null, slug)}
        cancel={cancelInvitationAction.bind(null, slug)}
        changeRole={changeRoleAction.bind(null, slug)}
        removeMember={removeMemberAction.bind(null, slug)}
      />

      <section className="sec" aria-labelledby="ws-h">
        <div className="sec-head">
          <h2 id="ws-h">Workspace</h2>
        </div>
        <div className="settings-grid">
          <div className="panel pad">
            <RenameWorkspace name={a.workspace.name} canEdit={can(a.role, "workspace:update")} action={renameWorkspaceAction.bind(null, slug)} />
          </div>
          <Link href={`/w/${slug}/settings/budget`} className="panel pad later-box site-link">
            <p className="later-title">
              <Icon name="db" /> Budget and usage <Icon name="arrow" />
            </p>
            <p className="muted small">A monthly ceiling for paid SEO data and a reserve that is never spent. Every paid call is priced first and refused below the reserve. The ledger and its CSV export live there too.</p>
          </Link>
          <div className="panel pad later-box">
            <p className="later-title">
              <Icon name="lock" /> Billing and plan <Badge tone="info">Phase 6</Badge>
            </p>
            <p className="muted small">Owners only. Plans and pricing are an open owner decision.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
