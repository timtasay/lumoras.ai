"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Button, IconButton } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "./FormBits";

type Role = "owner" | "editor" | "viewer";
export type MemberView = { memberId: string; userId: string; name: string; email: string; role: Role; joined: string; you: boolean };
export type InvitationView = { id: string; email: string; role: Role; expires: string; inviter: string; link: string };

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer · client reviewer" },
  { value: "editor", label: "Editor" },
  { value: "owner", label: "Owner" },
];
const ROLE_TONE = { owner: "ion", editor: "info", viewer: "neutral" } as const;
const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;

export function MembersPanel({
  members,
  invitations,
  canManage,
  invite,
  cancel,
  changeRole,
  removeMember,
}: {
  members: MemberView[];
  invitations: InvitationView[];
  canManage: boolean;
  invite: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  cancel: (id: string) => Promise<ActionState>;
  changeRole: (memberId: string, role: string) => Promise<ActionState>;
  removeMember: (memberId: string) => Promise<ActionState>;
}) {
  const [state, inviteAction, inviting] = useActionState(invite, idle);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<MemberView | null>(null);
  const toast = useToast();
  const report = (r: ActionState): void => void toast.push(r.ok ? { tone: "ok", title: r.message ?? "Done." } : { tone: "danger", title: r.error ?? "That did not work." });
  const owners = members.filter((m) => m.role === "owner").length;
  const fe = state.fieldErrors ?? {};

  return (
    <div className="members">
      {canManage ? null : <ReadOnlyNote>Only owners manage members, roles and invitations.</ReadOnlyNote>}
      <div className="tbl-frame" role="region" aria-label="Members" tabIndex={0}>
        <table className="tbl members-tbl">
          <caption className="sr-only">Workspace members and their roles</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col" className="hide-phone">
                Joined
              </th>
              {canManage ? (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const lastOwner = m.role === "owner" && owners === 1;
              return (
                <tr key={m.memberId}>
                  <th scope="row">
                    <span className="person">
                      <span className="person-dot" aria-hidden="true">
                        {(m.name || m.email)[0]?.toUpperCase()}
                      </span>
                      <span className="person-text">
                        {m.name || m.email}
                        {m.you ? <span className="muted"> (you)</span> : null}
                        <small>{m.email}</small>
                      </span>
                    </span>
                  </th>
                  <td>
                    {canManage && !lastOwner ? (
                      <label className="role-sel">
                        <span className="sr-only">Role for {m.email}</span>
                        <select
                          className="inp sel inp-sm"
                          defaultValue={m.role}
                          disabled={pending}
                          onChange={(e) => {
                            const role = e.target.value;
                            start(async () => report(await changeRole(m.memberId, role)));
                          }}
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    )}
                  </td>
                  <td className="hide-phone mono muted">{m.joined}</td>
                  {canManage ? (
                    <td className="n">{lastOwner ? <span className="muted small">Last owner</span> : <IconButton icon="trash" label={`Remove ${m.email}`} onClick={() => setConfirm(m)} />}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <section className="panel invite" aria-labelledby="invite-h">
          <div>
            <h3 id="invite-h">Invite someone</h3>
            <p className="muted small">They get an email with a link that works for 7 days, for that address only.</p>
          </div>
          <form action={inviteAction} onSubmit={submitKeepingValues(inviteAction)} className="invite-form" noValidate key={state.ok ? state.at : "invite"}>
            <ActionFeedback state={state} />
            <TextField label="Email" name="email" type="email" autoComplete="off" placeholder="name@client.com" error={fe.email} />
            <SelectField label="Role" name="role" defaultValue="viewer" options={ROLE_OPTIONS} error={fe.role} />
            <Button type="submit" variant="primary" icon="send" loading={inviting}>
              Send invitation
            </Button>
          </form>
        </section>
      ) : null}

      {invitations.length ? (
        <section aria-labelledby="pending-h" className="pending">
          <h3 id="pending-h" className="sub-h">
            Pending invitations <span className="tab-n">{invitations.length}</span>
          </h3>
          <ul className="pending-list">
            {invitations.map((i) => (
              <li key={i.id} className="panel pending-row">
                <span className="feat-ico" aria-hidden="true">
                  <Icon name="mail" />
                </span>
                <div className="pending-text">
                  <p>
                    {i.email} <Badge tone={ROLE_TONE[i.role]}>{ROLE_LABEL[i.role]}</Badge>
                  </p>
                  <p className="muted small">
                    Invited by {i.inviter} · open until {i.expires}
                  </p>
                </div>
                {canManage ? (
                  <div className="pending-acts">
                    <IconButton
                      icon="copy"
                      label={`Copy the invitation link for ${i.email}`}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(i.link);
                          toast.push({ tone: "ok", title: "Invitation link copied" });
                        } catch {
                          toast.push({ tone: "info", title: "Copy this link", body: i.link, duration: 0 });
                        }
                      }}
                    />
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => report(await cancel(i.id)))}>
                      Withdraw
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={`Remove ${confirm?.email ?? ""}?`}
        description="They lose access to this workspace at once. Their past changes stay in the audit log."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  report(await removeMember(confirm!.memberId));
                  setConfirm(null);
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}
