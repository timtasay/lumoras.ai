import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { formatDate } from "@/lib/content";
import { pageMeta } from "@/lib/seo";
import { BRANDS, DEMO_LINE, LEGAL_NAME, LEGAL_UPDATED, PRIVACY_EMAIL, PRODUCTS, SECURITY_EMAIL } from "@/lib/site";

// Written from what lumoras.ai actually does: no accounts, a demo request form that is emailed
// through Resend and logged, Google Analytics, hosting on a VPS behind Cloudflare.
// Keep it true when the site changes (new forms, new trackers, sign-in).

export const metadata: Metadata = pageMeta({
  title: "Privacy policy",
  description:
    "How Lumoras LLC handles personal information on lumoras.ai: the demo request form, Google Analytics cookies, server logs, the providers involved and your choices.",
  path: "/privacy",
});

const mail = (address: string) => <a href={`mailto:${address}`}>{address}</a>;

export default function PrivacyPage() {
  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Privacy policy", path: "/privacy" }]} />
        <div className="pg-narrow art-help">
          <PageHero
            eyebrow="Legal"
            title="Privacy policy"
            lede="What we collect on lumoras.ai, why, who helps us process it, and how to reach us about it. We don't sell your information and we don't use it for advertising."
          >
            <p className="byline">
              Last updated <time dateTime={LEGAL_UPDATED}>{formatDate(LEGAL_UPDATED, true)}</time>
            </p>
          </PageHero>

          <div className="prose">
            <h2 id="who-we-are">Who we are and what this covers</h2>
            <p>
              {LEGAL_NAME} (&quot;Lumoras&quot;, &quot;we&quot;, &quot;us&quot;) runs this website, lumoras.ai. This policy covers
              lumoras.ai only.
            </p>
            <p>
              Our products have their own websites and their own policies, which apply when you use them:
            </p>
            <ul>
              {BRANDS.map((b) => (
                <li key={b.name}>
                  <strong>{b.name}</strong>: <a href={b.privacy}>privacy policy</a> and <a href={b.terms}>terms</a> on{" "}
                  {b.domain}
                </li>
              ))}
            </ul>
            <p>
              The live demo line ({DEMO_LINE}) is answered by the Sonorch voice service. A call to it is covered by the{" "}
              <a href={PRODUCTS.sonorch.privacy}>Sonorch privacy policy</a>, not this one.
            </p>

            <h2 id="what-we-collect">What we collect</h2>
            <p>
              lumoras.ai has no accounts, sign-ups or passwords. We collect information in three ways.
            </p>
            <h3>The demo request form</h3>
            <p>
              When you <Link href="/demo">book a demo</Link>, you give us your name, work email, company, how many locations you run,
              your industry, and which products interest you (Voice, POS, Retail orders, Enterprise). The form also has a hidden field
              that only bots fill in, so we can ignore spam.
            </p>
            <p>
              We don&apos;t store the request in a database. Our server sends it by email to our team&apos;s inbox and writes a copy
              to its application log, so a request isn&apos;t lost if the email fails.
            </p>
            <h3>Email you send us</h3>
            <p>If you email us, we get your address and whatever you write.</p>
            <h3>Visits to the site</h3>
            <p>
              Like any website, our server and Cloudflare, which sits in front of it, record technical details of each request: IP
              address, browser and device type, the page asked for, the referring page and the time. Google Analytics collects
              similar details about how the site is used. See <a href="#cookies">Cookies and analytics</a>.
            </p>

            <h2 id="how-we-use">How we use it</h2>
            <ul>
              <li>To reply to your demo request and contact you about Lumoras, as the form says.</li>
              <li>To answer your questions.</li>
              <li>To keep the site running and secure, and to investigate abuse or attacks.</li>
              <li>To see, in aggregate, which pages are useful and how people find the site.</li>
              <li>To meet legal obligations.</li>
            </ul>
            <p>
              We do <strong>not</strong> sell your information, use it for advertising, or share it with others for their own
              marketing.
            </p>

            <h2 id="providers">Who helps us process it</h2>
            <p>We share information only with the providers that run the site for us, and only what they need:</p>
            <ul>
              <li>
                <strong>Resend</strong> delivers the demo request email to our inbox.
              </li>
              <li>
                <strong>Our email provider</strong> hosts the inbox the request and your emails arrive in.
              </li>
              <li>
                <strong>Cloudflare</strong> handles DNS, encrypts traffic and protects the site from attacks. Every request passes
                through it.
              </li>
              <li>
                <strong>Our hosting provider</strong> rents us the virtual private server the site runs on, where the server logs are
                kept.
              </li>
              <li>
                <strong>Google</strong> provides Google Analytics.
              </li>
              <li>Authorities, when the law requires it.</li>
            </ul>
            <p>
              Lumoras LLC is based in the United States, and these providers may process information in the United States and other
              countries.
            </p>

            <h2 id="cookies">Cookies and analytics</h2>
            <p>
              We use <strong>Google Analytics</strong> to count visits and see which pages are read. It sets first-party cookies,{" "}
              <code>_ga</code> and <code>_ga_&lt;ID&gt;</code>, that tell visits from the same browser apart and last up to two years.
              Google receives the page you view, the referring page, your browser and device type, and your IP address, which it uses
              to estimate your approximate location. Google handles this under the{" "}
              <a href="https://policies.google.com/privacy">Google Privacy Policy</a>; see also{" "}
              <a href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites that use its services</a>.
            </p>
            <p>
              To opt out, block cookies for lumoras.ai in your browser, use a content blocker, or install the{" "}
              <a href="https://tools.google.com/dlpage/gaoptout">Google Analytics opt-out add-on</a>. The site works the same without
              them.
            </p>
            <p>
              <strong>Cloudflare</strong> may set a strictly necessary cookie to tell people from bots. Your light or dark theme choice
              is saved in your browser&apos;s local storage (<code>lumoras-theme</code>), stays on your device and is never sent to us.
            </p>
            <p>We don&apos;t use advertising cookies or tracking pixels.</p>

            <h2 id="retention">How long we keep it</h2>
            <ul>
              <li>Demo requests and emails stay in our inbox as long as we need them to follow up and keep business records, or until you ask us to delete them.</li>
              <li>Server logs are kept only as long as needed for security and troubleshooting.</li>
              <li>Google Analytics keeps event data for no more than 14 months.</li>
            </ul>

            <h2 id="security">Security</h2>
            <p>
              All traffic to lumoras.ai is encrypted with HTTPS. Access to the server, its logs and our inbox is limited to the people
              who need it. No system is perfectly secure. If you find a vulnerability, please report it responsibly to{" "}
              {mail(SECURITY_EMAIL)}.
            </p>

            <h2 id="your-rights">Your rights</h2>
            <p>Depending on where you live, you can ask us to:</p>
            <ul>
              <li><strong>Access</strong>: send you a copy of the personal information we hold about you.</li>
              <li><strong>Correct</strong>: fix information that is wrong.</li>
              <li><strong>Delete</strong>: erase your information, for example a demo request.</li>
              <li><strong>Port</strong>: give it to you in a structured, machine-readable format.</li>
              <li><strong>Object</strong>: stop certain uses, such as contacting you about Lumoras.</li>
            </ul>
            <p>
              Email {mail(PRIVACY_EMAIL)}. We&apos;ll reply within 30 days. For data held by Sonorch, SeasonX or KitchenSpot, use the
              contact in that product&apos;s policy.
            </p>

            <h2 id="children">Children</h2>
            <p>
              lumoras.ai is for businesses and people 18 and older. We don&apos;t knowingly collect information from children under 13.
              If you think we have, contact us and we&apos;ll delete it.
            </p>

            <h2 id="changes">Changes to this policy</h2>
            <p>
              When we change this policy, we update this page and the &quot;Last updated&quot; date above. Using the site after that
              date means you accept the updated policy.
            </p>

            <h2 id="contact">Contact</h2>
            <p>
              {LEGAL_NAME}, privacy: {mail(PRIVACY_EMAIL)}
              <br />
              Security reports: {mail(SECURITY_EMAIL)}
            </p>
            <p>
              See also our <Link href="/terms">terms of use</Link>.
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
