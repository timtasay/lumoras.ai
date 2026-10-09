import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { EmptyState } from "@/components/EmptyState";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { Icon } from "@/components/Icons";
import { getFaq } from "@/lib/content";
import { faqLd, pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "FAQ: AI receptionist, POS and Retail Sound",
  description:
    "Answers about Lumoras: how the AI receptionist works, the POS, Retail Sound, which industries we serve, pricing and setup, and how customer data is handled.",
  path: "/faq",
});

export default function FaqPage() {
  const { groups } = getFaq();
  const all = groups.flatMap((g) => g.items);

  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "FAQ", path: "/faq" }]} />
        <PageHero
          eyebrow="FAQ"
          title="Frequently asked questions"
          lede="Straight answers about the AI receptionist, the point of sale, in-store sound, pricing, setup and your data."
        />

        {groups.length === 0 ? (
          <EmptyState title="Answers are being written." text="The FAQ will be here shortly. Until then, book a demo and ask us anything." />
        ) : (
          <div className="faq-layout">
            <nav className="faq-nav" aria-label="FAQ topics">
              <ul>
                {groups.map((g) => (
                  <li key={g.id}>
                    <a href={`#${g.id}`}>
                      {g.title}
                      <span className="mono">{g.items.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="faq-groups">
              {groups.map((g) => (
                <section key={g.id} id={g.id} className="faq-group" aria-labelledby={`${g.id}-h`}>
                  <h2 id={`${g.id}-h`} className="faq-title">{g.title}</h2>
                  {g.intro ? <p className="faq-intro">{g.intro}</p> : null}
                  <div className="faq-list">
                    {g.items.map((it) => (
                      <details key={it.q} className="qa">
                        <summary>
                          <span>{it.q}</span>
                          <Icon name="chev" />
                        </summary>
                        <p>{it.a}</p>
                      </details>
                    ))}
                  </div>
                </section>
              ))}
              <p className="faq-more">
                Looking for setup steps? Visit the <Link href="/help-center" className="tlink">help center</Link> or read the in-depth{" "}
                <Link href="/knowledge-base" className="tlink">knowledge base guides</Link>.
              </p>
            </div>
          </div>
        )}

        <CtaBand title="Still have a question?" text="Book a walkthrough and ask us directly, or call the live demo line to hear the AI receptionist answer." />
      </div>
      {all.length > 0 ? <JsonLd data={faqLd(all)} /> : null}
    </PageShell>
  );
}
