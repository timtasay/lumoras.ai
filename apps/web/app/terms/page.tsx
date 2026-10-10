import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { formatDate } from "@/lib/content";
import { pageMeta } from "@/lib/seo";
import { BRANDS, LEGAL_EMAIL, LEGAL_NAME, LEGAL_UPDATED } from "@/lib/site";

// Terms for the lumoras.ai website (the old /tos redirects here, see next.config.ts).
// The products have their own terms on their own sites.

export const metadata: Metadata = pageMeta({
  title: "Terms of use",
  description:
    "The terms for using lumoras.ai, the Lumoras LLC website: what the site offers, acceptable use, content and ownership, disclaimers and how to contact us.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Terms of use", path: "/terms" }]} />
        <div className="pg-narrow art-help">
          <PageHero
            eyebrow="Legal"
            title="Terms of use"
            lede="The rules for using lumoras.ai. They're short: use the site lawfully, don't abuse it, and read the articles as general information."
          >
            <p className="byline">
              Last updated <time dateTime={LEGAL_UPDATED}>{formatDate(LEGAL_UPDATED, true)}</time>
            </p>
          </PageHero>

          <div className="prose">
            <h2 id="acceptance">Accepting these terms</h2>
            <p>
              lumoras.ai is run by {LEGAL_NAME} (&quot;Lumoras&quot;, &quot;we&quot;, &quot;us&quot;). By using the site you agree
              to these terms. If you don&apos;t agree, please don&apos;t use it.
            </p>
            <p>
              You must be at least 18 to request a demo. If you use the site for an organization, you confirm you are allowed to act
              for it.
            </p>

            <h2 id="the-site">What the site is</h2>
            <p>
              lumoras.ai describes our AI receptionist, AI voice agents and point of sale, publishes insights, knowledge base guides and
              help center articles, and lets you request a demo. It has no accounts or paid services.
            </p>
            <p>
              Using a Lumoras product is covered by that product&apos;s own terms or by a separate agreement with us, not by these terms:
            </p>
            <ul>
              {BRANDS.map((b) => (
                <li key={b.name}>
                  <strong>{b.name}</strong>: <a href={b.terms}>terms</a> and <a href={b.privacy}>privacy policy</a> on {b.domain}
                </li>
              ))}
            </ul>

            <h2 id="your-responsibilities">Your responsibilities</h2>
            <ul>
              <li>Give accurate information when you request a demo.</li>
              <li>Follow all laws that apply to you.</li>
              <li>Don&apos;t use the site for unlawful, harmful or abusive purposes.</li>
              <li>
                Don&apos;t attack, overload or try to break into the site, and don&apos;t send automated or spam form submissions.
              </li>
            </ul>

            <h2 id="content">Content on the site</h2>
            <p>
              Articles, guides and answers on lumoras.ai are general information, not legal, financial or other professional advice.
              Sample calls, conversations and figures are illustrative. Features, prices and availability can change, and nothing on
              the site is an offer to sell.
            </p>

            <h2 id="privacy">Privacy</h2>
            <p>
              Our <Link href="/privacy">privacy policy</Link> explains what we collect on this site, including the demo request form and
              Google Analytics, and how we use it.
            </p>

            <h2 id="intellectual-property">Intellectual property</h2>
            <p>
              The content, names, logos and technology on lumoras.ai, including Lumoras, Sonorch, SeasonX and KitchenSpot, belong to{" "}
              {LEGAL_NAME} or its licensors. You may not copy, modify or distribute any part of the site without our written consent.
            </p>

            <h2 id="links">Links to other sites</h2>
            <p>
              The site links to our product sites and to other websites. Each has its own terms, and we aren&apos;t responsible for
              sites we don&apos;t run.
            </p>

            <h2 id="disclaimers">Disclaimers and limitation of liability</h2>
            <p>
              lumoras.ai is provided &quot;as is&quot; and &quot;as available&quot;. We don&apos;t promise it will be uninterrupted,
              secure or error-free. To the fullest extent the law allows, {LEGAL_NAME} disclaims all warranties and is not liable for
              any damages arising from your use of the site.
            </p>

            <h2 id="changes">Changes to these terms</h2>
            <p>
              We may update these terms. When we do, we change this page and the &quot;Last updated&quot; date above. Using the site
              after that date means you accept the updated terms.
            </p>

            <h2 id="contact">Contact</h2>
            <p>
              Questions about these terms: <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
