import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { StillStuck } from "@/components/StillStuck";
import { Icon } from "@/components/Icons";
import { categoryTitle, formatDate, getHelpArticle, getHelpArticles, getRelatedHelp } from "@/lib/content";
import { articleLd, pageMeta } from "@/lib/seo";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return getHelpArticles().map((h) => ({ slug: h.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const h = getHelpArticle(slug);
  if (!h) return {};
  return pageMeta({
    title: h.title,
    description: h.description,
    path: `/help-center/${h.slug}`,
    type: "article",
    publishedTime: h.updated,
    modifiedTime: h.updated,
  });
}

export default async function HelpArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const h = getHelpArticle(slug);
  if (!h) notFound();
  const related = getRelatedHelp(slug, 4);
  const path = `/help-center/${h.slug}`;

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Help center", path: "/help-center" }, { name: h.title, path }]} />
        {/* data-review marks articles awaiting product sign-off (frontmatter review: true) */}
        <article className="art art-help" data-review={h.review ? "pending" : undefined}>
          <header className="art-head">
            <p className="eyebrow">
              <Link href={`/help-center#${h.category}`}>{categoryTitle(h.category)}</Link>
            </p>
            <h1 className="art-title">{h.title}</h1>
            {h.description ? <p className="art-lede">{h.description}</p> : null}
            {h.appliesTo.length > 0 ? (
              <div className="applies">
                <span className="applies-k">Applies to</span>
                <ul>
                  {h.appliesTo.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="byline">
              Updated <time dateTime={h.updated}>{formatDate(h.updated, true)}</time>
            </p>
          </header>
          <div className="prose prose-help" dangerouslySetInnerHTML={{ __html: h.html }} />
        </article>

        {related.length > 0 ? (
          <section className="pg-sec pg-narrow" aria-labelledby="rel-h">
            <div className="pg-head">
              <h2 id="rel-h" className="sec-title">Related articles</h2>
              <Link href="/help-center" className="sec-link">
                Help center <Icon name="arrow" />
              </Link>
            </div>
            <ul className="pop-grid pop-2">
              {related.map((a) => (
                <li key={a.slug}>
                  <Link className="pop panel" href={`/help-center/${a.slug}`}>
                    <span className="pop-cat">{categoryTitle(a.category)}</span>
                    <strong>{a.title}</strong>
                    <Icon name="arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="pg-narrow">
          <StillStuck />
        </div>
      </div>
      <JsonLd
        data={articleLd({
          type: "Article",
          title: h.title,
          description: h.description,
          path,
          datePublished: h.updated,
          dateModified: h.updated,
          section: categoryTitle(h.category),
          wordCount: h.words,
        })}
      />
    </PageShell>
  );
}
