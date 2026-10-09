"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useDeferredValue, useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { ActionFeedback, ReadOnlyNote } from "@/components/forms/FormBits";
import { Button, buttonClass } from "@/components/ui/Button";
import { Segmented, TextareaField } from "@/components/ui/Fields";
import { Badge, StatusLight, type Tone } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { idle, type ActionState } from "@/lib/actions-state";
import { diffLines, diffStats, hunks } from "@/lib/content/diff";
import { lintArticle, lintPassed, type LinkCheck, type LintResult } from "@/lib/content/lint";
import { resolveLink, type InventoryRoute, type OwnPage } from "@/lib/content/links";
import { analyzeMarkdown, internalPath, renderMarkdown } from "@/lib/content/markdown";
import type { ExistingTarget } from "@/lib/content/headterm";
import type { SeoRules } from "@/lib/validation";

export type EditorItem = {
  id: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  title: string;
  description: string;
  bodyMd: string;
  slug: string | null;
  primaryKeyword: string | null;
  secondaryKeywords: string[];
  authorId: string | null;
  cover: { kind: string; chips: string[] };
  version: number;
  publishDate: string;
  slotLabel: string;
  runId: string | null;
  liveUrl: string | null;
  factCheck: { claim: string; status: string; sourceUrl: string | null; quote: string | null; note: string; primary: boolean; verified: boolean }[];
  factCheckPassed: boolean | null;
  unverifiable: number;
  kind: "new" | "refresh";
};

export type EditorContext = {
  domain: string;
  livePrefix: string;
  rules: SeoRules;
  bannedWords: string[];
  authors: { id: string; name: string; role: string; is_demo: boolean }[];
  routes: InventoryRoute[];
  pages: OwnPage[];
  linkChecks: [string, LinkCheck][];
  existingTargets: ExistingTarget[];
};

export type VersionView = { version: number; title: string; description: string; bodyMd: string; source: string; note: string | null; by: string; at: string };
export type CommentView = { id: string; name: string; body: string; at: string; version: number };
export type ReviewView = { decision: string; note: string; by: string; role: string | null; at: string; version: number };
export type PublicationView = { status: string; mode: string; prUrl: string | null; path: string | null; liveUrl: string | null; error: string | null; at: string };

const SOURCE_LABEL: Record<string, string> = { draft: "Draft", fact_check: "Fact-check", editor: "Edited", restore: "Restored" };
const DECISION: Record<string, [string, Tone]> = { approved: ["Approved", "ion"], rejected: ["Rejected", "danger"], changes_requested: ["Changes requested", "amber"], autopilot: ["Autopilot", "info"] };

function Count({ n, min, max }: { n: number; min?: number; max: number }) {
  const ok = n <= max && (min === undefined || n >= min);
  return (
    <span className="ed-count mono" data-ok={ok ? "" : undefined}>
      {n}
      {min !== undefined ? ` / ${min}–${max}` : ` / ${max}`}
    </span>
  );
}

/**
 * The article editor: Markdown with a live preview styled like the client's
 * site (approximated), and the right-hand panel: the lint checklist (the same
 * deterministic rules as the pipeline, run live in the browser on every edit),
 * fact-check evidence per claim, internal links and their status on the
 * publish date, version history with a diff, comments, and the review
 * decision (approve, request changes, reject) for the roles that may decide.
 */
export function ArticleEditor({
  slug,
  item,
  ctx,
  versions,
  comments,
  reviews,
  publications,
  canEdit,
  canApprove,
  canComment,
  canRun,
  save,
  submit,
  restore,
  comment,
  review,
  demoAuthor,
}: {
  slug: string;
  item: EditorItem;
  ctx: EditorContext;
  versions: VersionView[];
  comments: CommentView[];
  reviews: ReviewView[];
  publications: PublicationView[];
  canEdit: boolean;
  canApprove: boolean;
  canComment: boolean;
  canRun: boolean;
  save: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submit: () => Promise<ActionState>;
  restore: (version: number) => Promise<ActionState>;
  comment: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  review: (decision: "approved" | "rejected" | "changes_requested", note: string) => Promise<ActionState>;
  demoAuthor: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const editable = canEdit && ["awaiting_review", "changes_requested", "approved", "failed"].includes(item.status);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [body, setBody] = useState(item.bodyMd);
  const [coverKind, setCoverKind] = useState(item.cover.kind);
  const [chips, setChips] = useState(item.cover.chips.join(", "));
  const [mode, setMode] = useState<"split" | "write" | "preview">("split");
  const [note, setNote] = useState("");
  const [diffWith, setDiffWith] = useState<number | null>(versions[1]?.version ?? null);
  const [saved, saveAction, saving] = useActionState(save, idle);
  const [cstate, commentAction, commenting] = useActionState(comment, idle);
  const [busy, start] = useTransition();
  const dBody = useDeferredValue(body);
  const dTitle = useDeferredValue(title);
  const dDesc = useDeferredValue(description);
  const dirty = title !== item.title || description !== item.description || body !== item.bodyMd || coverKind !== item.cover.kind || chips !== item.cover.chips.join(", ");

  const analysis = useMemo(() => analyzeMarkdown(dBody), [dBody]);
  const lint: LintResult[] = useMemo(
    () =>
      lintArticle(
        {
          title: dTitle,
          description: dDesc,
          bodyMd: dBody,
          slug: item.slug,
          primaryKeyword: item.primaryKeyword,
          authorId: item.authorId,
          cover: { kind: coverKind, chips: chips.split(",").map((c) => c.trim()).filter(Boolean) },
          publishDate: item.publishDate,
          rules: ctx.rules,
          bannedWords: ctx.bannedWords,
          siteDomain: ctx.domain,
          authors: ctx.authors,
          routes: ctx.routes,
          pages: ctx.pages,
          linkChecks: new Map(ctx.linkChecks),
          existingTargets: item.kind === "refresh" ? [] : ctx.existingTargets,
          itemId: item.id,
        },
        analysis,
      ),
    [dTitle, dDesc, dBody, coverKind, chips, analysis, item, ctx],
  );
  const lintOk = lintPassed(lint);
  const html = useMemo(() => renderMarkdown(dBody), [dBody]);
  const links = useMemo(
    () =>
      [...new Map(analysis.links.map((l) => [l.url, l])).values()]
        .map((l) => ({ ...l, path: internalPath(l.url, ctx.domain) }))
        .filter((l): l is typeof l & { path: string } => l.path !== null)
        .map((l) => ({ ...l, verdict: resolveLink(l.path, item.publishDate, ctx.routes, ctx.pages) })),
    [analysis, ctx, item.publishDate],
  );
  const author = ctx.authors.find((a) => a.id === item.authorId);
  const words = analysis.words;
  const blockers = [
    ...(item.unverifiable > 0 ? [`${item.unverifiable} unverifiable claim${item.unverifiable === 1 ? "" : "s"}: every claim needs a primary source or must be removed.`] : item.factCheckPassed !== true ? ["The fact-check has not passed for this version (edits since the last check)."] : []),
    ...(!lintOk ? ["Lint has failing rules."] : []),
    ...(item.status !== "awaiting_review" ? [`The article is ${item.statusLabel.toLowerCase()}, not awaiting review.`] : []),
  ];
  const decide = (d: "approved" | "rejected" | "changes_requested") =>
    start(async () => {
      const r = await review(d, note);
      toast.push(r.ok ? { tone: "ok", title: r.message ?? "Done." } : { tone: "danger", title: r.error ?? "That did not work." });
      if (r.ok) {
        setNote("");
        router.refresh();
      }
    });
  const diff = useMemo(() => {
    const other = versions.find((v) => v.version === diffWith);
    if (!other) return null;
    const lines = diffLines(other.bodyMd, item.bodyMd);
    return { other, lines: hunks(lines, 1), stats: diffStats(lines) };
  }, [diffWith, versions, item.bodyMd]);

  return (
    <div className="editor">
      <div className="ed-main">
        <div className="ed-strip panel">
          <Badge tone={item.tone}>{item.statusLabel}</Badge>
          <span className="small">
            <Icon name="calendar" className="inline-ico" /> Goes live {item.slotLabel}
          </span>
          <span className="small muted">
            Version {item.version} · {words.toLocaleString("en-US")} words
          </span>
          {author ? (
            <span className="small">
              <Icon name="users" className="inline-ico" /> {author.name}
              {author.is_demo ? <Badge tone="amber">Demo</Badge> : null}
            </span>
          ) : null}
          {item.runId ? (
            <Link className="tlink small" href={`/w/${slug}/runs/${item.runId}`}>
              Pipeline run
            </Link>
          ) : null}
        </div>
        {demoAuthor ? (
          <div className="banner" role="note">
            <Icon name="alert" />
            <p>
              <strong>The byline is a demo placeholder.</strong> Bylines are published as real people: replace the author before this goes live under the client&apos;s name.
            </p>
          </div>
        ) : null}
        {!editable ? <ReadOnlyNote>{canEdit ? `This article is ${item.statusLabel.toLowerCase()}: it can be edited while it awaits review, has changes requested, or is scheduled.` : "Your role can read, comment and (reviewers) decide. Editors change the text."}</ReadOnlyNote> : null}
        <form action={saveAction} className="ed-form">
          <ActionFeedback state={saved} />
          <div className="ed-fields">
            <div className="fld">
              <label className="fld-label" htmlFor="ed-title">
                Title <Count n={title.length} max={ctx.rules.titleMax} />
              </label>
              <input id="ed-title" name="title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} readOnly={!editable} />
            </div>
            <div className="fld">
              <label className="fld-label" htmlFor="ed-desc">
                Description <Count n={description.length} min={ctx.rules.descriptionMin} max={ctx.rules.descriptionMax} />
              </label>
              <textarea id="ed-desc" name="description" className="inp area" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} readOnly={!editable} />
            </div>
            <div className="ed-row">
              <div className="fld">
                <label className="fld-label" htmlFor="ed-cover">
                  Cover kind
                </label>
                {ctx.rules.coverKinds.length ? (
                  <select id="ed-cover" name="coverKind" className="inp sel" value={coverKind} onChange={(e) => setCoverKind(e.target.value)} disabled={!editable}>
                    {ctx.rules.coverKinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id="ed-cover" name="coverKind" className="inp" value={coverKind} onChange={(e) => setCoverKind(e.target.value)} readOnly={!editable} />
                )}
                {!editable ? <input type="hidden" name="coverKind" value={coverKind} /> : null}
              </div>
              <div className="fld">
                <label className="fld-label" htmlFor="ed-chips">
                  Cover chips
                </label>
                <input id="ed-chips" name="coverChips" className="inp" value={chips} onChange={(e) => setChips(e.target.value)} readOnly={!editable} aria-describedby="ed-chips-h" />
                <p className="fld-hint" id="ed-chips-h">
                  Comma separated{ctx.rules.coverChips ? `, ${ctx.rules.coverChips} of them, up to ${ctx.rules.coverChipMax} characters each` : ""}.
                </p>
              </div>
              <div className="fld">
                <span className="fld-label">URL</span>
                <p className="mono small ed-url">{item.slug ? `${ctx.livePrefix}${item.slug}` : "–"}</p>
              </div>
            </div>
          </div>
          <div className="ed-tools">
            <Segmented
              size="sm"
              label="Editor layout"
              value={mode}
              onChange={setMode}
              options={[
                { value: "split", label: "Side by side" },
                { value: "write", label: "Write" },
                { value: "preview", label: "Preview" },
              ]}
            />
            <span className="small muted">Markdown · ## sections · links as [text](/path)</span>
          </div>
          <div className="ed-panes" data-mode={mode}>
            <div className="ed-pane ed-write">
              <label className="sr-only" htmlFor="ed-body">
                Article body (Markdown)
              </label>
              <textarea id="ed-body" name="bodyMd" className="ed-text mono" value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable} spellCheck />
            </div>
            <div className="ed-pane ed-preview" aria-label="Preview">
              <article className="prev">
                <p className="prev-meta">
                  {item.publishDate} · {Math.max(1, Math.round(words / 220))} min read{author ? ` · ${author.name}` : ""}
                </p>
                <p className="prev-title">{title}</p>
                <p className="prev-lede">{description}</p>
                <div className="prev-cover" data-kind={coverKind} aria-hidden="true">
                  {chips
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean)
                    .map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                </div>
                <div className="prev-body" dangerouslySetInnerHTML={{ __html: html }} />
              </article>
            </div>
          </div>
          {editable ? (
            <div className="ed-acts">
              <input name="note" className="inp inp-sm" placeholder="What changed (optional)" aria-label="What changed" maxLength={500} />
              <Button type="submit" variant={dirty ? "primary" : "secondary"} icon="check" loading={saving} disabled={!dirty}>
                Save version {item.version + 1}
              </Button>
              {canRun && (item.status === "changes_requested" || item.factCheckPassed !== true) ? (
                <Button
                  variant="secondary"
                  icon="shield"
                  loading={busy}
                  disabled={dirty}
                  onClick={() =>
                    start(async () => {
                      const r = await submit();
                      toast.push(r.ok ? { tone: "ok", title: r.message ?? "Submitted." } : { tone: "danger", title: r.error ?? "Could not submit." });
                      if (r.ok) router.refresh();
                    })
                  }
                >
                  Fact-check and submit for review
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>

      <aside className="ed-side" aria-label="Checks, evidence, history and review">
        {canApprove && item.status === "awaiting_review" ? (
          <section className="side-card panel review-card" aria-labelledby="rv-h">
            <h2 id="rv-h" className="side-h">
              <Icon name="gate" /> Review
            </h2>
            {blockers.length ? (
              <ul className="check-list">
                {blockers.map((b) => (
                  <li key={b} data-warn="">
                    <Icon name="alert" />
                    {b}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Lint and fact-check passed. Approving schedules it for {item.slotLabel}.</p>
            )}
            <TextareaField label="Note to the editors" name="reviewNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint="Required when you request changes." />
            <div className="rv-acts">
              <Button variant="primary" icon="check" loading={busy} disabled={blockers.length > 0} onClick={() => decide("approved")}>
                Approve
              </Button>
              <Button variant="secondary" loading={busy} disabled={!note.trim()} onClick={() => decide("changes_requested")}>
                Request changes
              </Button>
              <Button variant="ghost" icon="close" loading={busy} onClick={() => decide("rejected")}>
                Reject
              </Button>
            </div>
          </section>
        ) : !canApprove && item.status === "awaiting_review" ? (
          <section className="side-card panel" aria-labelledby="rv-h2">
            <h2 id="rv-h2" className="side-h">
              <Icon name="gate" /> Review
            </h2>
            <ReadOnlyNote>Your role can read and comment. Reviewers, editors and owners approve.</ReadOnlyNote>
          </section>
        ) : null}

        <section className="side-card panel" aria-labelledby="lint-h">
          <h2 id="lint-h" className="side-h">
            <Icon name="lint" /> SEO checklist
            <StatusLight state={lintOk ? "ok" : "error"}>{lintOk ? "Passing" : `${lint.filter((l) => l.status === "fail").length} failing`}</StatusLight>
          </h2>
          <ul className="lint-list" aria-live="polite">
            {lint.map((r, i) => (
              <li key={`${r.rule}-${i}`} data-status={r.status}>
                <Icon name={r.status === "pass" ? "check" : "alert"} />
                <span className="lint-name">{r.label}</span>
                <span className="lint-detail">{r.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="side-card panel" aria-labelledby="fc-h">
          <h2 id="fc-h" className="side-h">
            <Icon name="shield" /> Fact-check evidence
            {item.factCheckPassed === true ? <Badge tone="ion">Passed</Badge> : item.unverifiable ? <Badge tone="danger">{item.unverifiable} unverifiable</Badge> : <Badge tone="amber">Not checked</Badge>}
          </h2>
          {item.factCheck.length ? (
            <ul className="ev-list">
              {item.factCheck.map((c, i) => (
                <li key={i} data-status={c.status}>
                  <Badge tone={c.status === "sourced" ? "ion" : c.status === "rewritten" ? "info" : c.status === "removed" ? "neutral" : "danger"}>{c.status}</Badge>
                  <p className="ev-claim">{c.claim}</p>
                  {c.sourceUrl ? (
                    <p className="ev-src mono">
                      {c.sourceUrl.startsWith("http") ? (
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="tlink">
                          {c.sourceUrl}
                        </a>
                      ) : (
                        "Brand profile · product facts"
                      )}
                      {c.primary ? " · primary source" : ""}
                    </p>
                  ) : null}
                  {c.quote ? <blockquote className="ev-quote">“{c.quote}”</blockquote> : null}
                  <p className="ev-note small muted">{c.note}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No fact-check yet for this article.</p>
          )}
        </section>

        <section className="side-card panel" aria-labelledby="ln-h">
          <h2 id="ln-h" className="side-h">
            <Icon name="link" /> Internal links on {item.publishDate}
          </h2>
          {links.length ? (
            <ul className="ln-list">
              {links.map((l) => (
                <li key={l.url} data-ok={l.verdict.ok ? "" : undefined}>
                  <Icon name={l.verdict.ok ? "check" : "alert"} />
                  <span className="mono">{l.path}</span>
                  <span className="small muted">{l.verdict.ok ? (l.verdict.target.source === "inventory" ? "in the route inventory" : `our article, live from ${l.verdict.target.from}`) : l.verdict.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No internal links.</p>
          )}
        </section>

        {publications.length ? (
          <section className="side-card panel" aria-labelledby="pub-h">
            <h2 id="pub-h" className="side-h">
              <Icon name="send" /> Publishing
            </h2>
            <ul className="pub-list">
              {publications.map((p, i) => (
                <li key={i}>
                  <Badge tone={p.status === "failed" ? "danger" : p.status === "merged" || p.status === "published" ? "ion" : "info"}>{p.status}</Badge>
                  <span className="small">
                    {p.mode === "pr" ? "Pull request" : p.mode === "commit" ? "Commit" : "Webhook"} · {p.at}
                  </span>
                  {p.prUrl ? (
                    <a className="tlink small" href={p.prUrl} target="_blank" rel="noopener noreferrer">
                      {p.prUrl}
                    </a>
                  ) : null}
                  {p.path ? <span className="mono small muted">{p.path}</span> : null}
                  {p.error ? <span className="small bad-text">{p.error}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="side-card panel" aria-labelledby="vh-h">
          <h2 id="vh-h" className="side-h">
            <Icon name="history" /> Versions
          </h2>
          <ol className="ver-list">
            {versions.map((v) => (
              <li key={v.version} data-current={v.version === item.version ? "" : undefined}>
                <span className="mono">v{v.version}</span>
                <span className="small">
                  {SOURCE_LABEL[v.source] ?? v.source} · {v.by} · {v.at}
                </span>
                {v.note ? <span className="small muted">{v.note}</span> : null}
                <span className="ver-acts">
                  {v.version !== item.version ? (
                    <button type="button" className="tlink small" aria-pressed={diffWith === v.version} onClick={() => setDiffWith(v.version)}>
                      Compare
                    </button>
                  ) : (
                    <Badge>current</Badge>
                  )}
                  {editable && v.version !== item.version ? (
                    <button
                      type="button"
                      className="tlink small"
                      onClick={() =>
                        start(async () => {
                          const r = await restore(v.version);
                          toast.push(r.ok ? { tone: "ok", title: r.message ?? "Restored." } : { tone: "danger", title: r.error ?? "Could not restore." });
                          if (r.ok) router.refresh();
                        })
                      }
                    >
                      Restore
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          {diff ? (
            <div className="diff-box">
              <p className="small">
                v{diff.other.version} → v{item.version}: <span className="diff-add">+{diff.stats.added}</span> <span className="diff-del">−{diff.stats.removed}</span> lines
              </p>
              <pre className="diff-view" aria-label={`Changes from version ${diff.other.version} to version ${item.version}`}>
                {diff.lines.map((l, i) =>
                  l.op === "gap" ? (
                    <span key={i} className="dl-gap">
                      ⋯ {l.skipped} unchanged line{l.skipped === 1 ? "" : "s"}
                      {"\n"}
                    </span>
                  ) : (
                    <span key={i} className={`dl dl-${l.op}`}>
                      <span className="sr-only">{l.op === "add" ? "added: " : l.op === "del" ? "removed: " : ""}</span>
                      {l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}
                      {l.text || " "}
                      {"\n"}
                    </span>
                  ),
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section className="side-card panel" aria-labelledby="cm-h">
          <h2 id="cm-h" className="side-h">
            <Icon name="mail" /> Comments and decisions
          </h2>
          <ul className="cm-list">
            {[...reviews.map((r) => ({ k: `r${r.at}${r.by}`, t: r.at, el: (
              <li key={`r${r.at}${r.by}`} className="cm cm-decision">
                <Badge tone={DECISION[r.decision]?.[1] ?? "neutral"}>{DECISION[r.decision]?.[0] ?? r.decision}</Badge>
                <span className="small">
                  {r.by}
                  {r.role ? ` (${r.role})` : ""} · v{r.version} · {r.at}
                </span>
                {r.note ? <p className="cm-body">{r.note}</p> : null}
              </li>
            ) })), ...comments.map((c) => ({ k: c.id, t: c.at, el: (
              <li key={c.id} className="cm">
                <span className="small">
                  <strong>{c.name}</strong> · v{c.version} · {c.at}
                </span>
                <p className="cm-body">{c.body}</p>
              </li>
            ) }))].map((x) => x.el)}
            {!reviews.length && !comments.length ? <li className="small muted">No comments yet.</li> : null}
          </ul>
          {canComment ? (
            <form action={commentAction} className="cm-form" key={cstate.ok ? cstate.at : "c"}>
              <ActionFeedback state={cstate} />
              <TextareaField label="Add a comment" name="body" rows={3} error={cstate.fieldErrors?.body} />
              <Button type="submit" size="sm" variant="secondary" loading={commenting}>
                Comment
              </Button>
            </form>
          ) : null}
        </section>
        {item.liveUrl ? (
          <a className={buttonClass("ghost", "sm")} href={item.liveUrl} target="_blank" rel="noopener noreferrer">
            <span className="btn-label">
              <Icon name="globe" /> {item.liveUrl}
            </span>
          </a>
        ) : null}
      </aside>
    </div>
  );
}
