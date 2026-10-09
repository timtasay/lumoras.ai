import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleEditor, type EditorContext, type EditorItem } from "@/components/content/ArticleEditor";
import { Icon } from "@/components/Icons";
import { readWorkspace } from "@/lib/actions";
import { can, ROLE_LABEL, type WorkspaceRole } from "@/lib/auth/permissions";
import { getItem, listComments, listPublications, listReviews, listVersions, existingTargets, ownPages } from "@/lib/data/content";
import { getBrand, getSiteSettings, listAuthors } from "@/lib/data/sites";
import { isExternal, analyzeMarkdown } from "@/lib/content/markdown";
import { localParts, publishDateFor } from "@/lib/content/schedule";
import { LABEL, TONE } from "@/lib/content/status";
import { isUuid, NotFoundError } from "@/lib/db/tenant";
import { livePathPattern, loadPublishConnection } from "@/lib/publishers/registry";
import { readSeoRules } from "@/lib/validation";
import { commentAction, restoreVersionAction, reviewAction, saveEditAction, submitForReviewAction } from "../../content-actions";

export const metadata: Metadata = { title: "Article" };

const fmt = (d: Date, tz: string) => {
  const l = localParts(d, tz);
  return `${l.date} ${l.time}`;
};

export default async function ArticlePage({ params }: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId } = await params;
  if (!isUuid(itemId)) notFound();
  let data;
  try {
    data = await readWorkspace(slug, async (tx, a) => {
      const item = await getItem(tx, itemId);
      const site = await getSiteSettings(tx, item.site_id);
      const brand = await getBrand(tx, site.id);
      const pattern = site.publish_connection_id ? await loadPublishConnection(tx, site.publish_connection_id).then(livePathPattern, () => "/blog/{{slug}}") : "/blog/{{slug}}";
      const external = [...new Set(analyzeMarkdown(item.body_md).links.filter((l) => isExternal(l.url, site.domain)).map((l) => l.url))];
      return {
        role: a.role,
        item,
        site,
        brand,
        pattern,
        authors: await listAuthors(tx, site.id),
        routes: await tx.many<{ path: string }>("SELECT path FROM site_routes WHERE site_id = $1", [site.id]),
        pages: await ownPages(tx, site.id, pattern, item.id),
        checks: await tx.many<{ url: string; ok: boolean; status_code: number | null; error: string | null; checked_at: Date }>("SELECT url, ok, status_code, error, checked_at FROM link_checks WHERE site_id = $1 AND url = ANY($2)", [site.id, external]),
        existing: item.kind === "refresh" ? [] : await existingTargets(tx, site.id, item.id),
        versions: await listVersions(tx, item.id),
        comments: await listComments(tx, item.id),
        reviews: await listReviews(tx, item.id),
        publications: await listPublications(tx, item.id),
      };
    });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { item, site, brand } = data;
  const tz = site.timezone;
  const role = data.role as WorkspaceRole;
  const publishDate = item.publish_date ?? publishDateFor(item.slot_at, { writtenAt: item.written_at, now: new Date(), timezone: tz, allowBackdating: site.allow_backdating });
  const author = data.authors.find((x) => x.id === item.author_id);
  const editorItem: EditorItem = {
    id: item.id,
    status: item.status,
    statusLabel: LABEL[item.status],
    tone: TONE[item.status],
    title: item.title,
    description: item.description,
    bodyMd: item.body_md,
    slug: item.slug,
    primaryKeyword: item.primary_keyword,
    secondaryKeywords: item.secondary_keywords,
    authorId: item.author_id,
    cover: { kind: typeof item.cover?.kind === "string" ? item.cover.kind : "", chips: Array.isArray(item.cover?.chips) ? item.cover.chips.map(String) : [] },
    version: item.version,
    publishDate,
    slotLabel: `${fmt(item.slot_at, tz)} (${tz.replace(/_/g, " ")})`,
    runId: item.current_run_id,
    liveUrl: item.live_url,
    factCheck: item.fact_check.map((c) => ({ claim: c.claim, status: c.status, sourceUrl: c.sourceUrl, quote: c.quote, note: c.note, primary: c.primary, verified: c.verified })),
    factCheckPassed: item.fact_check_passed,
    unverifiable: item.unverifiable_claims,
    kind: item.kind,
  };
  const ctx: EditorContext = {
    domain: site.domain,
    livePrefix: `https://${site.domain}${data.pattern.replace("{{slug}}", "")}`,
    rules: readSeoRules(brand.seo_rules),
    bannedWords: brand.banned_words,
    authors: data.authors.map((x) => ({ id: x.id, name: x.name, role: x.role, is_demo: x.is_demo })),
    routes: data.routes.map((r) => ({ path: r.path })),
    pages: data.pages,
    linkChecks: data.checks.map((c) => [c.url, { url: c.url, ok: c.ok, status: c.status_code, error: c.error, checkedAt: c.checked_at.toISOString() }]),
    existingTargets: data.existing,
  };
  return (
    <div className="page page-wide">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <Link href={`/w/${slug}/content?site=${site.id}`} className="crumb">
              <Icon name="back" className="inline-ico" /> Content calendar
            </Link>
            {" · "}
            <span className="mono">{site.domain}</span>
          </p>
          <h1>{item.title || item.primary_keyword || "Planned article"}</h1>
          {item.primary_keyword ? (
            <p className="lede muted">
              Targets <strong>{item.primary_keyword}</strong>
              {item.secondary_keywords.length ? ` · also ${item.secondary_keywords.slice(0, 4).join(", ")}` : ""}
            </p>
          ) : null}
        </div>
      </header>
      {!item.body_md ? (
        <div className="banner" role="note">
          <Icon name="info" />
          <p>This slot has not been written yet. It is written {site.lead_days} day{site.lead_days === 1 ? "" : "s"} before it goes out.</p>
        </div>
      ) : (
        <ArticleEditor
          slug={slug}
          item={editorItem}
          ctx={ctx}
          versions={data.versions.map((v) => ({ version: v.version, title: v.title, description: v.description, bodyMd: v.body_md, source: v.source, note: v.note, by: v.actor_email ?? (v.actor_id.startsWith("system") ? "Pipeline" : "Someone"), at: fmt(v.created_at, tz) }))}
          comments={data.comments.map((c) => ({ id: c.id, name: c.name || c.email, body: c.body, at: fmt(c.created_at, tz), version: c.version }))}
          reviews={data.reviews.map((r) => ({ decision: r.decision, note: r.note, by: r.reviewer_email ?? "Autopilot", role: r.reviewer_role && r.reviewer_role in ROLE_LABEL ? ROLE_LABEL[r.reviewer_role as WorkspaceRole] : r.reviewer_role, at: fmt(r.created_at, tz), version: r.version }))}
          publications={data.publications.map((p) => ({ status: p.status, mode: p.mode, prUrl: p.pr_url, path: p.path, liveUrl: p.live_url, error: p.error, at: fmt(p.created_at, tz) }))}
          canEdit={can(role, "content:edit")}
          canApprove={can(role, "content:approve")}
          canComment={can(role, "comment:create")}
          canRun={can(role, "pipeline:run")}
          save={saveEditAction.bind(null, slug, item.id)}
          submit={submitForReviewAction.bind(null, slug, item.id)}
          restore={restoreVersionAction.bind(null, slug, item.id)}
          comment={commentAction.bind(null, slug, item.id)}
          review={reviewAction.bind(null, slug, item.id)}
          demoAuthor={!!author?.is_demo}
        />
      )}
    </div>
  );
}
