import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { Toc } from "@/components/Toc";
import { Icon } from "@/components/Icons";
import { formatDate, getGuide, getGuides, getRelatedGuides, topicTitle } from "@/lib/content";
import { articleLd, pageMeta } from "@/lib/seo";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return getGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) return {};
  return pageMeta({
    title: g.title,
    description: g.description,
    path: `/knowledge-base/${g.slug}`,
    type: "article",
    publishedTime: g.updated,
    modifiedTime: g.updated,
    tags: [g.keyword].filter(Boolean),
  });
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) notFound();
  const related = getRelatedGuides(slug, 3);
  const path = `/knowledge-base/${g.slug}`;

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Knowledge base", path: "/knowledge-base" }, { name: g.title, path }]} />
        <article className="art art-doc">
          <header className="art-head">
            <p className="eyebrow mono">{topicTitle(g.topic)}</p>
            <h1 className="art-title">{g.title}</h1>
            {g.description ? <p className="art-lede">{g.description}</p> : null}
            <p className="byline">
              By Lumoras team · Updated <time dateTime={g.updated}>{formatDate(g.updated, true)}</time>
              <span aria-hidden="true"> · </span>
              {g.readingMinutes} min read
            </p>
          </header>
          <div className="doc-grid">
            <aside className="doc-aside">
              <Toc items={g.toc} />
            </aside>
            <div className="doc-main">
              {g.keyPoints.length > 0 ? (
                <section className="keypoints glass" aria-labelledby="kp-h">
                  <h2 id="kp-h" className="mono kp-title">Key points</h2>
                  <ul className="kp-list">
                    {g.keyPoints.map((k) => (
                      <li key={k}>
                        <Icon name="check" />
                        <span>{k}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <div className="prose" dangerouslySetInnerHTML={{ __html: g.html }} />
            </div>
          </div>
        </article>

        {related.length > 0 ? (
          <section className="pg-sec" aria-labelledby="rel-h">
            <div className="sec-head">
              <h2 id="rel-h" className="sec-title">Related guides</h2>
              <Link href="/knowledge-base" className="sec-link">
                All guides <Icon name="arrow" />
              </Link>
            </div>
            <div className="guide-grid">
              {related.map((r) => (
                <Link key={r.slug} className="guide-card glass" href={`/knowledge-base/${r.slug}`}>
                  <span className="mono gc-topic">{topicTitle(r.topic)} · {r.readingMinutes} min</span>
                  <span className="gc-title">{r.title}</span>
                  <span className="gc-desc">{r.description}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <CtaBand />
      </div>
      <JsonLd
        data={articleLd({
          type: "TechArticle",
          title: g.title,
          description: g.description,
          path,
          datePublished: g.updated,
          dateModified: g.updated,
          keywords: [g.keyword].filter(Boolean),
          section: topicTitle(g.topic),
          wordCount: g.words,
        })}
      />
    </PageShell>
  );
}
