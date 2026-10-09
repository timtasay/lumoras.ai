import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { InsightCard } from "@/components/InsightCard";
import { EmptyState } from "@/components/EmptyState";
import { CtaBand } from "@/components/CtaBand";
import { getInsights } from "@/lib/content";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Insights for owners and operators",
  description:
    "Practical reads on AI receptionists, missed calls, no-shows, reminders and store music, for the people who run salons, restaurants, clinics and shops.",
  path: "/insights",
});

export default function InsightsPage() {
  const all = getInsights();
  const featured = all.slice(0, 3);
  const more = all.slice(3);

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Insights", path: "/insights" }]} />
        <PageHero
          eyebrow="Insights"
          title="For the people running the business."
          lede="Short, practical reads on phones, bookings, payments and the sound of your store. Written for owners and operators who would rather be on the floor than in a manual."
        />

        {all.length === 0 ? (
          <EmptyState title="New insights are on the way." text="We're writing the first articles now. Check back soon." />
        ) : (
          <>
            <section className="pg-sec" aria-labelledby="latest-h">
              <div className="sec-head">
                <h2 id="latest-h" className="sec-title">Latest</h2>
                <p className="sec-meta mono">{all.length} {all.length === 1 ? "article" : "articles"}</p>
              </div>
              <div className="ins-featured">
                {featured.map((i, n) => (
                  <InsightCard key={i.slug} insight={i} variant={n === 0 ? "feature" : "card"} headingLevel="h3" />
                ))}
              </div>
            </section>

            {more.length > 0 ? (
              <section className="pg-sec" aria-labelledby="more-h">
                <div className="sec-head">
                  <h2 id="more-h" className="sec-title">More insights</h2>
                </div>
                <div className="card-grid">
                  {more.map((i) => (
                    <InsightCard key={i.slug} insight={i} variant="card" headingLevel="h3" />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        <CtaBand />
      </div>
    </PageShell>
  );
}
