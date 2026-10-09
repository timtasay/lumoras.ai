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

export const metadata: Metadata = pageMeta({
  title: "Knowledge base: AI receptionists and voice AI",
  description:
    "In-depth guides to AI receptionists, voice AI, AI call centers, call forwarding, missed calls and store audio. Plain answers, with the arithmetic shown.",
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
          lede="In-depth guides to AI receptionists, voice AI and store audio. What they do, how they work, what they cost, and how to set them up without disrupting your week."
        />

        {guides.length === 0 ? (
          <EmptyState title="Guides are being written." text="The first knowledge-base guides will appear here shortly." />
        ) : (
          <>
            <dl className="stats-strip glass">
              <div>
                <dt className="mono">Guides</dt>
                <dd>{guides.length}</dd>
              </div>
              <div>
                <dt className="mono">Minutes of reading</dt>
                <dd>{minutes}</dd>
              </div>
              <div>
                <dt className="mono">Last updated</dt>
                <dd>
                  <time dateTime={lastUpdated}>{formatDate(lastUpdated)}</time>
                </dd>
              </div>
            </dl>

            {pillar ? (
              <section className="pg-sec" aria-labelledby="start-h">
                <div className="sec-head">
                  <h2 id="start-h" className="sec-title">Start here</h2>
                </div>
                <article className="pillar glass">
                  <div className="pillar-main">
                    <p className="eyebrow mono">{topicTitle(pillar.topic)} · {pillar.readingMinutes} min read</p>
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
                      <p className="mono kp-title">Key points</p>
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
              <div className="sec-head">
                <h2 id="topics-h" className="sec-title">Browse by topic</h2>
              </div>
              <div className="topic-grid">
                {KB_TOPICS.map((t, n) => {
                  const list = guides.filter((g) => g.topic === t.id);
                  return (
                    <section key={t.id} className="topic glass" aria-labelledby={`t-${t.id}`} style={{ ["--tone" as string]: `var(--s${(n % 4) + 1})` }}>
                      <p className="topic-n mono">{String(n + 1).padStart(2, "0")}</p>
                      <h3 id={`t-${t.id}`} className="topic-title">{t.title}</h3>
                      <p className="topic-blurb">{t.blurb}</p>
                      {list.length > 0 ? (
                        <ul className="topic-list">
                          {list.map((g) => (
                            <li key={g.slug}>
                              <Link href={`/knowledge-base/${g.slug}`}>
                                <span>{g.title}</span>
                                <span className="mins mono">{g.readingMinutes} min</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="topic-soon mono">Guide coming soon</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          </>
        )}

        <section className="pg-sec" aria-labelledby="more-help-h">
          <div className="sec-head">
            <h2 id="more-help-h" className="sec-title">Need a quick answer instead?</h2>
          </div>
          <div className="link-cards">
            <Link className="link-card glass" href="/help-center">
              <Icon name="help" />
              <span><strong>Help center</strong><span>Setup steps and how-to articles for every product.</span></span>
            </Link>
            <Link className="link-card glass" href="/faq">
              <Icon name="list" />
              <span><strong>FAQ</strong><span>Short answers about voice, POS, sound, pricing and data.</span></span>
            </Link>
            <Link className="link-card glass" href="/insights">
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
