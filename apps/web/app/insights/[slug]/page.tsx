import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { InsightArt } from "@/components/InsightArt";
import { InsightCard } from "@/components/InsightCard";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { Icon } from "@/components/Icons";
import { formatDate, getInsight, getInsights, getRelatedInsights, tagLabel } from "@/lib/content";
import { articleLd, pageMeta } from "@/lib/seo";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return getInsights().map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const i = getInsight(slug);
  if (!i) return {};
  return pageMeta({
    title: i.title,
    description: i.description,
    path: `/insights/${i.slug}`,
    type: "article",
    publishedTime: i.date,
    tags: [i.keyword, ...i.tags].filter(Boolean),
  });
}

export default async function InsightPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const i = getInsight(slug);
  if (!i) notFound();
  const related = getRelatedInsights(slug, 3);
  const path = `/insights/${i.slug}`;

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Insights", path: "/insights" }, { name: i.title, path }]} />
        <article className="art art-insight">
          <header className="art-head">
            {i.tags.length > 0 ? <p className="eyebrow">{i.tags.map(tagLabel).join(" · ")}</p> : null}
            <h1 className="art-title">{i.title}</h1>
            {i.description ? <p className="art-lede">{i.description}</p> : null}
            <p className="byline">
              By {i.author} on <time dateTime={i.date}>{formatDate(i.date, true)}</time>
              <span aria-hidden="true"> · </span>
              {i.readingMinutes} min read
            </p>
          </header>
          <InsightArt kind={i.art.kind} chips={i.art.chips} size="lg" className="art-hero" />
          <div className="prose" dangerouslySetInnerHTML={{ __html: i.html }} />
          <p className="art-back">
            <Link href="/insights" className="tlink">
              All insights
            </Link>
          </p>
        </article>

        {related.length > 0 ? (
          <section className="pg-sec" aria-labelledby="rel-h">
            <div className="pg-head">
              <h2 id="rel-h" className="sec-title">Related insights</h2>
              <Link href="/insights" className="sec-link">
                All insights <Icon name="arrow" />
              </Link>
            </div>
            <div className="card-grid">
              {related.map((r) => (
                <InsightCard key={r.slug} insight={r} variant="card" headingLevel="h3" />
              ))}
            </div>
          </section>
        ) : null}

        <CtaBand />
      </div>
      <JsonLd
        data={articleLd({
          type: "BlogPosting",
          title: i.title,
          description: i.description,
          path,
          datePublished: i.date,
          keywords: [i.keyword, ...i.tags].filter(Boolean),
          wordCount: i.words,
        })}
      />
    </PageShell>
  );
}
