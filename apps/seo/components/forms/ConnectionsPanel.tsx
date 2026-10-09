"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Segmented, TextField } from "@/components/ui/Fields";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "./FormBits";

export type ConnectionRow = {
  id: string;
  kind: string;
  label: string;
  config: Record<string, string>;
  has_secret: boolean;
  key_version: number | null;
  status: "untested" | "ok" | "warn" | "error";
  status_detail: string | null;
  created: string;
};

const KIND: Record<string, { label: string; icon: IconName; phase: number }> = {
  git: { label: "Git (file per post)", icon: "flow", phase: 3 },
  wordpress: { label: "WordPress", icon: "doc", phase: 5 },
  webhook: { label: "Webhook", icon: "send", phase: 3 },
  search_console: { label: "Google Search Console", icon: "search", phase: 2 },
  ga4: { label: "Google Analytics 4", icon: "trend", phase: 2 },
  social: { label: "Social accounts", icon: "share", phase: 5 },
};

const LIGHT: Record<ConnectionRow["status"], [LightState, string]> = {
  untested: ["idle", "Not tested yet"],
  ok: ["ok", "Working"],
  warn: ["warn", "Needs attention"],
  error: ["error", "Failing"],
};

const PLANNED = ["search_console", "ga4", "social"] as const;

function summary(c: ConnectionRow) {
  if (c.kind === "git") return `${c.config.repository} · ${c.config.branch}`;
  if (c.kind === "wordpress") return `${c.config.siteUrl} · ${c.config.username}`;
  if (c.kind === "webhook") return c.config.endpoint;
  return "";
}

/**
 * Per-site connections with status lights. Credentials are encrypted on the
 * server and never come back to the browser: a row only says one is stored
 * and under which key version. Live tests arrive with each connector's phase.
 */
export function ConnectionsPanel({
  connections,
  canEdit,
  create,
  remove,
}: {
  connections: ConnectionRow[];
  canEdit: boolean;
  create: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  remove: (id: string) => Promise<ActionState>;
}) {
  const [kind, setKind] = useState<"git" | "wordpress" | "webhook">("git");
  const [state, action, pending] = useActionState(create, idle);
  const [busy, start] = useTransition();
  const toast = useToast();
  const fe = state.fieldErrors ?? {};
  return (
    <div className="conns">
      {canEdit ? null : <ReadOnlyNote>Your role can see connections. Editors and owners manage them.</ReadOnlyNote>}
      <ul className="conn-list">
        {connections.map((c) => {
          const k = KIND[c.kind] ?? { label: c.kind, icon: "plug" as IconName, phase: 3 };
          const [light, text] = LIGHT[c.status];
          return (
            <li key={c.id} className="panel conn">
              <span className="feat-ico" aria-hidden="true">
                <Icon name={k.icon} />
              </span>
              <div className="conn-text">
                <p className="conn-name">
                  {c.label} <span className="muted small">{k.label}</span>
                </p>
                <p className="conn-sum mono">{summary(c)}</p>
                <p className="conn-meta">
                  <StatusLight state={light}>{text}</StatusLight>
                  {c.has_secret ? (
                    <Badge icon="lock">Credentials encrypted · key v{c.key_version}</Badge>
                  ) : null}
                </p>
              </div>
              <div className="conn-acts">
                <Button size="sm" variant="secondary" disabled title={`Live tests arrive in Phase ${k.phase}`} aria-describedby={`t-${c.id}`}>
                  Test
                </Button>
                <span id={`t-${c.id}`} className="sr-only">
                  Live tests arrive in Phase {k.phase}
                </span>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    loading={busy}
                    onClick={() =>
                      start(async () => {
                        const r = await remove(c.id);
                        toast.push(r.ok ? { tone: "ok", title: r.message ?? "Removed." } : { tone: "danger", title: r.error ?? "Could not remove." });
                      })
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
        {PLANNED.map((p) => (
          <li key={p} className="panel conn" data-planned="">
            <span className="feat-ico" aria-hidden="true">
              <Icon name={KIND[p].icon} />
            </span>
            <div className="conn-text">
              <p className="conn-name">{KIND[p].label}</p>
              <p className="conn-meta">
                <StatusLight state="idle">Not connected</StatusLight>
                <Badge tone="info">Phase {KIND[p].phase}</Badge>
              </p>
            </div>
            <div className="conn-acts">
              <Button size="sm" variant="secondary" disabled>
                Connect
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <section className="panel conn-add" aria-labelledby="conn-add-h">
          <div className="conn-add-head">
            <h3 id="conn-add-h">Add a publishing connection</h3>
            <Segmented
              size="sm"
              label="Connection type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "git", label: "Git" },
                { value: "wordpress", label: "WordPress" },
                { value: "webhook", label: "Webhook" },
              ]}
            />
          </div>
          <form action={action} onSubmit={submitKeepingValues(action)} className="form-grid" noValidate key={state.ok ? state.at : kind}>
            <ActionFeedback state={state} />
            <input type="hidden" name="kind" value={kind} />
            <TextField label="Label" name="label" required defaultValue={kind === "git" ? "Content repository" : kind === "wordpress" ? "WordPress site" : "Publishing webhook"} error={fe.label} />
            {kind === "git" ? (
              <>
                <TextField label="Repository" name="repository" placeholder="https://github.com/owner/site" error={fe.repository} />
                <TextField label="Branch" name="branch" defaultValue="main" error={fe.branch} />
                <TextField label="Access token" name="secret" type="password" autoComplete="off" hint="Fine-grained token with contents and pull-request access to this repository only." error={fe.secret} />
              </>
            ) : kind === "wordpress" ? (
              <>
                <TextField label="Site address" name="siteUrl" placeholder="https://blog.example.com" error={fe.siteUrl} />
                <TextField label="Username" name="username" autoComplete="off" error={fe.username} />
                <TextField label="Application password" name="secret" type="password" autoComplete="off" error={fe.secret} />
              </>
            ) : (
              <>
                <TextField label="Endpoint" name="endpoint" placeholder="https://example.com/hooks/lumoras" error={fe.endpoint} />
                <TextField label="Signing secret" name="secret" type="password" autoComplete="off" hint="Payloads are signed with HMAC-SHA256 and a timestamp (Phase 3)." error={fe.secret} />
              </>
            )}
            <p className="muted small span-2">
              <Icon name="lock" className="inline-ico" /> Encrypted with AES-256-GCM before it is stored. Nobody can read it back here, including you.
            </p>
            <div className="form-acts span-2">
              <Button type="submit" variant="secondary" icon="plug" loading={pending}>
                Save connection
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
