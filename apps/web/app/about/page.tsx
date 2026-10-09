import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { CallChip } from "@/components/CallChip";
import { Icon } from "@/components/Icons";
import { getAbout } from "@/lib/content";
import { pageMeta } from "@/lib/seo";
import { tone } from "@/lib/tones";

export const metadata: Metadata = pageMeta({
  title: "About us: voice, POS and sound as one system",
  description:
    "Lumoras LLC builds AI receptionists, a POS for service businesses and in-store sound for retail, plus Sonorch, SeasonX and KitchenSpot. Here's how we work.",
  path: "/about",
});

export default function AboutPage() {
  const a = getAbout();

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "About us", path: "/about" }]} />
        {!a ? (
          <PageHero
            eyebrow="About us"
            title="About Lumoras"
            lede="Lumoras LLC builds sound orchestration for business: AI voice, point of sale and in-store audio working as one system. More about us is coming soon."
          />
        ) : (
          <>
            <PageHero eyebrow={a.hero.eyebrow} title={a.hero.title} lede={a.hero.lede} />

            {a.story.length > 0 ? (
              <section className="pg-sec" aria-labelledby="story-h">
                <div className="pg-head">
                  <h2 id="story-h" className="sec-title">One business day, four moments</h2>
                </div>
                <ol className="timeline">
                  {a.story.map((s, n) => (
                    <li key={s.time + s.title} className="tl-item panel" style={{ ["--tone" as string]: tone(n) }}>
                      <p className="tl-time">{s.time}</p>
                      <h3 className="tl-title">{s.title}</h3>
                      <p className="tl-text">{s.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {a.intro ? (
              <section className="pg-sec about-intro" aria-label="Why Lumoras">
                <p>{a.intro}</p>
              </section>
            ) : null}

            {a.build.items.length > 0 ? (
              <section className="pg-sec" aria-labelledby="build-h">
                <div className="pg-head">
                  <h2 id="build-h" className="sec-title">{a.build.title || "What we build"}</h2>
                </div>
                <div className="build-grid">
                  {a.build.items.map((b, n) => (
                    <article key={b.name} className="build panel" style={{ ["--tone" as string]: tone(n) }}>
                      <h3 className="build-name">{b.name}</h3>
                      <p>{b.text}</p>
                      {b.points?.length ? (
                        <ul className="kp-list">
                          {b.points.map((p) => (
                            <li key={p}>
                              <Icon name="check" />
                              <span>{p}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {a.products.length > 0 ? (
              <section className="pg-sec" aria-labelledby="fam-h">
                <div className="pg-head">
                  <h2 id="fam-h" className="sec-title">The product family</h2>
                </div>
                <div className="fam-grid">
                  {a.products.map((p, n) => (
                    <article key={p.name} className="fam panel" style={{ ["--tone" as string]: tone(n) }}>
                      <h3 className="fam-name">{p.name}</h3>
                      <p>{p.text}</p>
                      {p.url ? (
                        <a className="fam-link" href={p.url}>
                          Visit {p.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} <Icon name="arrow" />
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {a.principles.items.length > 0 ? (
              <section className="pg-sec" aria-labelledby="pr-h">
                <div className="pg-head">
                  <h2 id="pr-h" className="sec-title">{a.principles.title || "How we work"}</h2>
                </div>
                <ol className="principles">
                  {a.principles.items.map((p, n) => (
                    <li key={p.title}>
                      <span className="pr-n">{String(n + 1).padStart(2, "0")}</span>
                      <h3 className="pr-title">{p.title}</h3>
                      <p>{p.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {a.closing.title ? (
              <section className="ctaband panel" aria-labelledby="close-h">
                <div>
                  <h2 id="close-h" className="ctaband-title">{a.closing.title}</h2>
                  <p>{a.closing.text}</p>
                </div>
                <div className="ctaband-actions">
                  <Link className="btn btn-primary" href="/demo">
                    Book a demo <Icon name="arrow" />
                  </Link>
                  <CallChip />
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
