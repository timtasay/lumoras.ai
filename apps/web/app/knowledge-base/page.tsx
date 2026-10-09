import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { EmptyState } from "@/components/EmptyState";
import { CtaBand } from "@/components/CtaBand";
import { Icon } from "@/components/Icons";
import { KB_TOPICS, formatDate, getGuides, topicTitle } from "@/lib/content";
import { pageMeta } from "@/lib/seo";
import { tone } from "@/lib/tones";

export const metadata: Metadata = pageMeta({
  title: "Knowledge base: AI receptionists and voice AI",
  description:
    "In-depth guides to AI receptionists, voice AI, AI call centers, call forwarding, missed calls and retail order calls. Plain answers, with the arithmetic shown.",
  path: "/knowledge-base",
});

export default function KnowledgeBasePage() {
  const guides = getGuides();
  const minutes = guides.reduce((s, g) => s + g.readingMinutes, 0);
  const lastUpdated = guides.reduce((m, g) => (g.updated > m ? g.updated : m), "");
  const pillar = guides.find((g) => g.slug === "what-is-an-ai-receptionist") ?? guides[0];

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Knowledge base", path: "/knowledge-base" }]} />
        <PageHero
          eyebrow="Knowledge base"
          title="How the phone, the counter and the store floor actually work."
          lede="In-depth guides to AI receptionists, voice AI and retail order calls. What they do, how they work, what they cost, and how to set them up without disrupting your week."
        />

        {guides.length === 0 ? (
          <EmptyState title="Guides are being written." text="The first knowledge-base guides will appear here shortly." />
        ) : (
          <>
            <dl className="stats-strip panel">
              <div>
                <dt>Guides</dt>
                <dd>{guides.length}</dd>
              </div>
              <div>
                <dt>Minutes of reading</dt>
                <dd>{minutes}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>
                  <time dateTime={lastUpdated}>{formatDate(lastUpdated)}</time>
                </dd>
              </div>
            </dl>

            {pillar ? (
              <section className="pg-sec" aria-labelledby="start-h">
                <div className="pg-head">
                  <h2 id="start-h" className="sec-title">Start here</h2>
                </div>
                <article className="pillar panel">
                  <div className="pillar-main">
                    <p className="eyebrow">{topicTitle(pillar.topic)} · {pillar.readingMinutes} min read</p>
                    <h3 className="pillar-title">
                      <Link href={`/knowledge-base/${pillar.slug}`}>{pillar.title}</Link>
                    </h3>
                    <p className="pillar-desc">{pillar.description}</p>
                    <Link className="btn btn-primary" href={`/knowledge-base/${pillar.slug}`} aria-label={`Read the guide: ${pillar.title}`}>
                      Read the guide <Icon name="arrow" />
                    </Link>
                  </div>
                  {pillar.keyPoints.length > 0 ? (
                    <div className="pillar-points">
                      <p className="kp-title">Key points</p>
                      <ul className="kp-list">
                        {pillar.keyPoints.map((k) => (
                          <li key={k}>
                            <Icon name="check" />
                            <span>{k}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              </section>
            ) : null}

            <section className="pg-sec" aria-labelledby="topics-h">
              <div className="pg-head">
                <h2 id="topics-h" className="sec-title">Browse by topic</h2>
              </div>
              <div className="topic-grid">
                {KB_TOPICS.map((t, n) => {
                  const list = guides.filter((g) => g.topic === t.id);
                  return (
                    <section key={t.id} className="topic panel" aria-labelledby={`t-${t.id}`} style={{ ["--tone" as string]: tone(n) }}>
                      <p className="topic-n">{String(n + 1).padStart(2, "0")}</p>
                      <h3 id={`t-${t.id}`} className="topic-title">{t.title}</h3>
                      <p className="topic-blurb">{t.blurb}</p>
                      {list.length > 0 ? (
                        <ul className="topic-list">
                          {list.map((g) => (
                            <li key={g.slug}>
                              <Link href={`/knowledge-base/${g.slug}`}>
                                <span>{g.title}</span>
                                <span className="mins">{g.readingMinutes} min</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="topic-soon">Guide coming soon</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          </>
        )}

        <section className="pg-sec" aria-labelledby="more-help-h">
          <div className="pg-head">
            <h2 id="more-help-h" className="sec-title">Need a quick answer instead?</h2>
          </div>
          <div className="link-cards">
            <Link className="link-card panel" href="/help-center">
              <Icon name="help" />
              <span><strong>Help center</strong><span>Setup steps and how-to articles for every product.</span></span>
            </Link>
            <Link className="link-card panel" href="/faq">
              <Icon name="list" />
              <span><strong>FAQ</strong><span>Short answers about voice, POS, retail orders, pricing and data.</span></span>
            </Link>
            <Link className="link-card panel" href="/insights">
              <Icon name="doc" />
              <span><strong>Insights</strong><span>Practical reads for owners and operators.</span></span>
            </Link>
          </div>
        </section>

        <CtaBand />
      </div>
    </PageShell>
  );
}
