"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Segmented, SelectField, TextareaField, TextField } from "@/components/ui/Fields";
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

export type TestCheck = { label: string; ok: boolean; detail: string };

const LIGHT: Record<ConnectionRow["status"], [LightState, string]> = {
  untested: ["idle", "Not tested yet"],
  ok: ["ok", "Working"],
  warn: ["warn", "Needs attention"],
  error: ["error", "Failing"],
};

// Search Console and GA4 have their own section (components/google/GoogleConnections.tsx)
const PLANNED = ["social"] as const;

function summary(c: ConnectionRow) {
  if (c.kind === "git") return `${c.config.repository} · ${c.config.branch ?? "main"} · ${c.config.contentDir ?? "content/posts"}/${c.config.filenamePattern ?? "{{slug}}.md"} · ${c.config.mode === "commit" ? "commits directly" : "opens a pull request"}`;
  if (c.kind === "wordpress") return `${c.config.siteUrl} · ${c.config.username}`;
  if (c.kind === "webhook") return `${c.config.endpoint} · signed HMAC-SHA256`;
  return "";
}

const LIVE_TEST = new Set(["git", "webhook"]);

/** The frontmatter presets: the lumoras.ai content spec, and a neutral one for most static-site generators. */
export type TemplatePreset = { key: string; label: string; contentDir: string; filenamePattern: string; livePath: string; template: string };

/**
 * Per-site connections with status lights. Credentials are encrypted on the
 * server and never come back to the browser: a row only says one is stored
 * and under which key version. Git and webhook connections have a live Test
 * (it reads the repository or sends a signed ping; it changes nothing) and
 * can be chosen as the site's publishing connection.
 */
export function ConnectionsPanel({
  connections,
  canEdit,
  create,
  remove,
  publishId = null,
  test,
  choosePublish,
  presets = [],
}: {
  connections: ConnectionRow[];
  canEdit: boolean;
  create: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  remove: (id: string) => Promise<ActionState>;
  publishId?: string | null;
  test?: (id: string) => Promise<ActionState>;
  choosePublish?: (id: string | null) => Promise<ActionState>;
  presets?: TemplatePreset[];
}) {
  const [kind, setKind] = useState<"git" | "wordpress" | "webhook">("git");
  const [state, action, pending] = useActionState(create, idle);
  const [busy, start] = useTransition();
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string; checks: TestCheck[] }>>({});
  const [preset, setPreset] = useState(presets[0]?.key ?? "");
  const toast = useToast();
  const fe = state.fieldErrors ?? {};
  const pre = presets.find((p) => p.key === preset) ?? null;
  const runTest = (id: string) => {
    if (!test) return;
    setTesting(id);
    start(async () => {
      const r = await test(id);
      const checks = ((r.data as { checks?: TestCheck[] } | undefined)?.checks ?? []) as TestCheck[];
      setResults((m) => ({ ...m, [id]: { ok: r.ok, text: r.ok ? (r.message ?? "Working.") : (r.error ?? "The test failed."), checks } }));
      toast.push(r.ok ? { tone: "ok", title: r.message ?? "Connection works." } : { tone: "danger", title: r.error ?? "The test failed." });
      setTesting(null);
    });
  };
  return (
    <div className="conns">
      {canEdit ? null : <ReadOnlyNote>Your role can see connections. Editors and owners manage them.</ReadOnlyNote>}
      <ul className="conn-list">
        {connections.filter((c) => c.kind !== "search_console" && c.kind !== "ga4").map((c) => {
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
                  {publishId === c.id ? (
                    <Badge tone="ion" icon="send">
                      Publishes this site
                    </Badge>
                  ) : null}
                  {c.has_secret ? (
                    <Badge icon="lock">Credentials encrypted · key v{c.key_version}</Badge>
                  ) : null}
                </p>
                {c.status_detail && !results[c.id] ? <p className="small muted conn-detail">{c.status_detail}</p> : null}
                {results[c.id] ? (
                  <div className="conn-test" role="status">
                    <p className="small">
                      <Icon name={results[c.id].ok ? "check" : "alert"} className="inline-ico" /> {results[c.id].text}
                    </p>
                    {results[c.id].checks.length ? (
                      <ul className="check-list">
                        {results[c.id].checks.map((ch) => (
                          <li key={ch.label} data-warn={ch.ok ? undefined : ""}>
                            <Icon name={ch.ok ? "check" : "alert"} />
                            <span>
                              <strong>{ch.label}</strong> {ch.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="conn-acts">
                {LIVE_TEST.has(c.kind) && test ? (
                  <Button size="sm" variant="secondary" icon="refresh" loading={busy && testing === c.id} disabled={!canEdit || (busy && testing !== c.id)} onClick={() => runTest(c.id)}>
                    Test
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" disabled title={`Live tests arrive in Phase ${k.phase}`} aria-describedby={`t-${c.id}`}>
                      Test
                    </Button>
                    <span id={`t-${c.id}`} className="sr-only">
                      Live tests arrive in Phase {k.phase}
                    </span>
                  </>
                )}
                {LIVE_TEST.has(c.kind) && choosePublish && canEdit && publishId !== c.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="send"
                    loading={busy && testing === null}
                    onClick={() =>
                      start(async () => {
                        const r = await choosePublish(c.id);
                        toast.push(r.ok ? { tone: "ok", title: r.message ?? "Saved." } : { tone: "danger", title: r.error ?? "Could not save." });
                      })
                    }
                  >
                    Use for publishing
                  </Button>
                ) : null}
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
                <SelectField label="Host" name="provider" defaultValue="github" options={[{ value: "github", label: "GitHub" }, { value: "gitea", label: "Gitea" }]} error={fe.provider} />
                <TextField label="Repository" name="repository" placeholder="https://github.com/owner/site" error={fe.repository} />
                <TextField label="API address (optional)" name="apiBaseUrl" placeholder="https://api.github.com" hint="Leave empty for github.com, or for Gitea's /api/v1 under the repository's host." error={fe.apiBaseUrl} />
                <TextField label="Branch" name="branch" defaultValue="main" error={fe.branch} />
                {presets.length ? (
                  <SelectField label="Site format" value={preset} onChange={(e) => setPreset(e.target.value)} options={presets.map((p) => ({ value: p.key, label: p.label }))} hint="Fills the folder, file name, live path and frontmatter below." />
                ) : null}
                <SelectField label="How it publishes" name="mode" defaultValue="pr" options={[{ value: "pr", label: "Open a pull request (recommended)" }, { value: "commit", label: "Commit to the branch" }]} error={fe.mode} />
                <TextField key={`d-${preset}`} label="Content folder" name="contentDir" defaultValue={pre?.contentDir ?? "content/posts"} error={fe.contentDir} />
                <TextField key={`f-${preset}`} label="File name" name="filenamePattern" defaultValue={pre?.filenamePattern ?? "{{slug}}.md"} error={fe.filenamePattern} />
                <TextField key={`l-${preset}`} label="Live path" name="livePath" defaultValue={pre?.livePath ?? "/blog/{{slug}}"} hint="Where the article appears on the site; internal links and the live check use it." error={fe.livePath} />
                <TextField label="Access token" name="secret" type="password" autoComplete="off" hint="Fine-grained token with contents and pull-request access to this repository only." error={fe.secret} />
                <TextareaField key={`t-${preset}`} className="span-2" label="Frontmatter template" name="frontmatterTemplate" rows={8} defaultValue={pre?.template ?? ""} hint="Placeholders like {{title}}, {{date}}, {{cover.chips}}. Values are written as quoted YAML, never raw." error={fe.frontmatterTemplate} spellCheck={false} />
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
                <TextField label="Live path" name="livePath" defaultValue="/blog/{{slug}}" error={fe.livePath} />
                <TextField className="span-2" label="Signing secret" name="secret" type="password" autoComplete="off" hint="Each delivery carries X-Lumoras-Timestamp and X-Lumoras-Signature: v1=HMAC-SHA256(secret, timestamp.body). Reject anything older than five minutes." error={fe.secret} />
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
