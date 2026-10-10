"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Segmented, SelectField, TextareaField, TextField } from "@/components/ui/Fields";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { idle, type ActionState } from "@/lib/actions-state";
import { formatAuthorKeys } from "@/lib/publishers/author-keys";
import type { SitePreset } from "@/lib/publishers/presets";
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
  if (c.kind === "git") return `${c.config.repository} · base ${c.config.branch ?? "main"} · ${c.config.contentDir ?? "content/posts"}/${c.config.filenamePattern ?? "{{slug}}.md"} · ${c.config.mode === "commit" ? "commits directly" : `opens a pull request into ${c.config.branch ?? "main"}`}${c.config.bodyFormat === "mdx" ? " · MDX" : ""}${c.config.requiredPath ? ` · waits for ${c.config.requiredPath}` : ""}`;
  if (c.kind === "wordpress") return `${c.config.siteUrl} · ${c.config.username}`;
  if (c.kind === "webhook") return `${c.config.endpoint} · signed HMAC-SHA256`;
  return "";
}

const LIVE_TEST = new Set(["git", "webhook"]);

/** owner/repo from https://host/owner/repo (for the token instructions). */
function repoName(url: string | undefined): string {
  const m = /^https:\/\/[^/]+\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}` : "the repository";
}

/**
 * A Git connection saved without its access token: what to create, where,
 * with which permissions, and a field to paste it. The token is sealed on the
 * server and never comes back.
 */
function TokenNeeded({ c, canEdit, save }: { c: ConnectionRow; canEdit: boolean; save?: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, action, pending] = useActionState(save ?? (async () => idle), idle);
  const repo = repoName(c.config.repository);
  const gitea = c.config.provider === "gitea";
  const base = c.config.branch ?? "main";
  return (
    <div className="conn-token" role="note" aria-labelledby={`tok-${c.id}`}>
      <p className="conn-token-h" id={`tok-${c.id}`}>
        <Icon name="lock" className="inline-ico" /> Token needed to publish to {repo}
      </p>
      {gitea ? (
        <ol className="conn-steps">
          <li>In Gitea: Settings → Applications → Generate new token, with repository read and write access.</li>
          <li>Use an account that can open pull requests on {repo}.</li>
        </ol>
      ) : (
        <ol className="conn-steps">
          <li>
            On GitHub: <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong> → Generate new token.
          </li>
          <li>
            Repository access: <strong>Only select repositories</strong> → <span className="mono">{repo}</span>, nothing else.
          </li>
          <li>
            Repository permissions: <strong>Contents</strong> read and write, <strong>Pull requests</strong> read and write (Metadata read-only is added automatically).
          </li>
          <li>Generate it and paste it below. {c.config.mode === "commit" ? `Commits land on ${base}.` : `Pull requests target ${base}; merging stays with the repository's own review.`}</li>
        </ol>
      )}
      {canEdit && save ? (
        <form action={action} className="conn-token-form" noValidate key={state.ok ? state.at : "tok"}>
          <ActionFeedback state={state} />
          <TextField label="Access token" name="secret" type="password" autoComplete="off" placeholder={gitea ? "Gitea access token" : "github_pat_…"} error={state.fieldErrors?.secret} hint="Encrypted with AES-256-GCM before it is stored. Nobody can read it back here, including you." />
          <Button type="submit" variant="primary" icon="lock" loading={pending}>
            Save token
          </Button>
        </form>
      ) : (
        <p className="muted small">An editor or owner of this workspace adds the token.</p>
      )}
    </div>
  );
}

/** A site format (lib/publishers/presets.ts): fills the Git connection's fields. */
export type TemplatePreset = Omit<SitePreset, "seoRules">;

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
  saveToken,
}: {
  connections: ConnectionRow[];
  canEdit: boolean;
  create: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  remove: (id: string) => Promise<ActionState>;
  publishId?: string | null;
  test?: (id: string) => Promise<ActionState>;
  choosePublish?: (id: string | null) => Promise<ActionState>;
  presets?: TemplatePreset[];
  /** Adds a token to a connection saved without one. */
  saveToken?: (id: string, prev: ActionState, fd: FormData) => Promise<ActionState>;
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
          const needsToken = c.kind === "git" && !c.has_secret;
          const [light, text] = needsToken ? (["warn", "Token needed"] as [LightState, string]) : LIGHT[c.status];
          return (
            <li key={c.id} className="panel conn" data-token-needed={needsToken ? "" : undefined}>
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
                {c.status_detail && !results[c.id] && !needsToken ? <p className="small muted conn-detail">{c.status_detail}</p> : null}
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
                {needsToken ? <TokenNeeded c={c} canEdit={canEdit} save={saveToken ? saveToken.bind(null, c.id) : undefined} /> : null}
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
                <SelectField key={`h-${preset}`} label="Host" name="provider" defaultValue={pre?.provider ?? "github"} options={[{ value: "github", label: "GitHub" }, { value: "gitea", label: "Gitea" }]} error={fe.provider} />
                <TextField key={`r-${preset}`} label="Repository" name="repository" placeholder="https://github.com/owner/site" defaultValue={pre?.repository ?? ""} error={fe.repository} />
                <TextField label="API address (optional)" name="apiBaseUrl" placeholder="https://api.github.com" hint="Leave empty for github.com, or for Gitea's /api/v1 under the repository's host." error={fe.apiBaseUrl} />
                <TextField key={`b-${preset}`} label="Base branch" name="branch" defaultValue={pre?.branch ?? "main"} hint="Pull requests target this branch (or commits land on it)." error={fe.branch} />
                {presets.length ? (
                  <SelectField label="Site format" value={preset} onChange={(e) => setPreset(e.target.value)} options={presets.map((p) => ({ value: p.key, label: p.label }))} hint="Fills the repository, folder, file name, live path, frontmatter and body format below." />
                ) : null}
                <SelectField label="How it publishes" name="mode" defaultValue="pr" options={[{ value: "pr", label: "Open a pull request (recommended)" }, { value: "commit", label: "Commit to the branch" }]} error={fe.mode} />
                <TextField key={`d-${preset}`} label="Content folder" name="contentDir" defaultValue={pre?.contentDir ?? "content/posts"} error={fe.contentDir} />
                <TextField key={`f-${preset}`} label="File name" name="filenamePattern" defaultValue={pre?.filenamePattern ?? "{{slug}}.md"} error={fe.filenamePattern} />
                <TextField key={`l-${preset}`} label="Live path" name="livePath" defaultValue={pre?.livePath ?? "/blog/{{slug}}"} hint="Where the article appears on the site; internal links and the live check use it." error={fe.livePath} />
                <TextField label="Access token (can be added later)" name="secret" type="password" autoComplete="off" hint="Fine-grained token with Contents and Pull requests read and write on this repository only. Leave it empty to save the settings now: the connection shows “token needed” until it is added." error={fe.secret} />
                <TextareaField key={`t-${preset}`} className="span-2" label="Frontmatter template" name="frontmatterTemplate" rows={8} defaultValue={pre?.template ?? ""} hint="Placeholders like {{title}}, {{date}}, {{cover.chips}}, {{author.key}}. Values are written as quoted YAML, never raw." error={fe.frontmatterTemplate} spellCheck={false} />
                <SelectField key={`m-${preset}`} label="Body format" name="bodyFormat" defaultValue={pre?.bodyFormat ?? "markdown"} options={[{ value: "markdown", label: "Markdown" }, { value: "mdx", label: "MDX (escapes <, { and } in the text)" }]} hint="MDX sites compile the body as code: a bare < or { would break their build." error={fe.bodyFormat} />
                <TextField key={`q-${preset}`} label="Format check (optional)" name="requiredPath" defaultValue={pre?.requiredPath ?? ""} placeholder="src/content/post-schema.ts" hint="A file that must be on the base branch before anything publishes, e.g. once the site's post format change is merged." error={fe.requiredPath} />
                <TextareaField key={`a-${preset}`} className="span-2" label="Author keys (for {{author.key}})" name="authorKeys" rows={4} defaultValue={pre ? formatAuthorKeys(pre.authorKeys) : ""} placeholder="Tran = tran" hint="One per line: the byline's name as set on this site's Authors, then the key the site's frontmatter uses." error={fe.authorKeys} spellCheck={false} />
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
