import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageHero } from "@/components/PageHero";
import { DemoForm } from "@/components/DemoForm";
import { CallChip } from "@/components/CallChip";
import { Icon } from "@/components/Icons";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Book a demo of the AI receptionist",
  description:
    "Book a walkthrough of Lumoras voice, POS and in-store sound for your locations, or call the live demo line now and talk to the AI receptionist yourself.",
  path: "/demo",
});

export default function DemoPage() {
  return (
    <PageShell>
      <div className="wrap">
        <Breadcrumbs items={[{ name: "Book a demo", path: "/demo" }]} />
        <div className="demo-grid">
          <div className="demo-copy">
            <PageHero
              eyebrow="Book a demo"
              title="Hear it answer your phone."
              lede="Tell us about your business and we'll tailor a walkthrough of voice, POS and sound for your locations. Want to hear it first? Call the live demo line."
            >
              <CallChip className="demo-chip" />
            </PageHero>
            <h2 className="sec-title demo-h">What to expect</h2>
            <ol className="expect">
              <li>
                <Icon name="phone" />
                <span><strong>A call you can try yourself.</strong> We&apos;ll set up the AI receptionist with your hours, services or menu so you can ring it.</span>
              </li>
              <li>
                <Icon name="card" />
                <span><strong>The POS on your workflow.</strong> Appointments or tickets, payments, staff and reporting, shown the way you&apos;d run them.</span>
              </li>
              <li>
                <Icon name="wave" />
                <span><strong>Sound for your stores.</strong> For retail, zones, dayparts and announcements across your locations.</span>
              </li>
              <li>
                <Icon name="layers" />
                <span><strong>A plan to go live.</strong> What to connect, what to tune, and how to switch on without closing for a day.</span>
              </li>
            </ol>
            <p className="demo-note">
              Running a salon or a restaurant? <a className="tlink" href="https://sonorch.ai">Sonorch</a> and{" "}
              <a className="tlink" href="https://seasonx.ai/demo">SeasonX</a> have their own demos. Have a quick question? Try the{" "}
              <Link className="tlink" href="/faq">FAQ</Link>.
            </p>
          </div>
          <DemoForm title="Tell us about your business" />
        </div>
      </div>
    </PageShell>
  );
}
