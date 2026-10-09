import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { EmptyState } from "@/components/EmptyState";
import { HelpSearch } from "@/components/HelpSearch";
import { StillStuck } from "@/components/StillStuck";
import { Icon } from "@/components/Icons";
import { HELP_CATEGORIES, categoryTitle, getHelpArticles } from "@/lib/content";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Help center: setup and how-to guides",
  description:
    "Step-by-step help for Lumoras: connect your phone number, set answering hours, transfer live calls, take card payments, set up store zones and manage data.",
  path: "/help-center",
});

const POPULAR = [
  "getting-started-with-lumoras",
  "connect-your-phone-number",
  "live-call-transfer",
  "answering-hours",
  "take-card-payments",
  "set-up-store-zones",
];

export default function HelpCenterPage() {
  const articles = getHelpArticles();
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  let popular = POPULAR.map((s) => bySlug.get(s)).filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (popular.length < 4) popular = [...popular, ...articles.filter((a) => !popular.includes(a))].slice(0, 6);
  const index = articles.map((a) => ({ slug: a.slug, title: a.title, description: a.description, category: categoryTitle(a.category) }));

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Help center", path: "/help-center" }]} />
        <PageHero
          center
          eyebrow="Help center"
          title="How can we help?"
          lede="Setup steps and how-to articles for Lumoras POS, Lumoras Voice, Lumoras Sound, Sonorch and SeasonX."
        >
          {articles.length > 0 ? <HelpSearch items={index} /> : null}
        </PageHero>

        {articles.length === 0 ? (
          <EmptyState title="Help articles are on the way." text="We're writing setup guides now. In the meantime, book a demo and we'll walk you through it." />
        ) : (
          <>
            <section className="pg-sec" aria-labelledby="pop-h">
              <div className="sec-head">
                <h2 id="pop-h" className="sec-title">Popular articles</h2>
              </div>
              <ul className="pop-grid">
                {popular.map((a) => (
                  <li key={a.slug}>
                    <Link className="pop glass" href={`/help-center/${a.slug}`}>
                      <span className="mono pop-cat">{categoryTitle(a.category)}</span>
                      <strong>{a.title}</strong>
                      <Icon name="arrow" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="pg-sec" aria-labelledby="cat-h">
              <div className="sec-head">
                <h2 id="cat-h" className="sec-title">Browse by category</h2>
              </div>
              <div className="cat-grid">
                {HELP_CATEGORIES.map((c, n) => {
                  const list = articles.filter((a) => a.category === c.id);
                  return (
                    <section key={c.id} className="cat glass" id={c.id} aria-labelledby={`c-${c.id}`} style={{ ["--tone" as string]: `var(--s${(n % 4) + 1})` }}>
                      <div className="cat-head">
                        <h3 id={`c-${c.id}`} className="cat-title">{c.title}</h3>
                        <span className="cat-count mono">
                          {list.length} {list.length === 1 ? "article" : "articles"}
                        </span>
                      </div>
                      <p className="cat-blurb">{c.blurb}</p>
                      {list.length > 0 ? (
                        <ul className="cat-list">
                          {list.map((a) => (
                            <li key={a.slug}>
                              <Link href={`/help-center/${a.slug}`}>{a.title}</Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="topic-soon mono">Articles coming soon</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          </>
        )}

        <StillStuck />

        <section className="pg-sec" aria-labelledby="deeper-h">
          <div className="sec-head">
            <h2 id="deeper-h" className="sec-title">Go deeper</h2>
          </div>
          <div className="link-cards">
            <Link className="link-card glass" href="/knowledge-base">
              <Icon name="book" />
              <span><strong>Knowledge base</strong><span>In-depth guides to AI receptionists, voice AI and store audio.</span></span>
            </Link>
            <Link className="link-card glass" href="/faq">
              <Icon name="list" />
              <span><strong>FAQ</strong><span>Short answers about pricing, setup, industries and data.</span></span>
            </Link>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
