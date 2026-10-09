import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Icon } from "@/components/Icons";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page doesn't exist. Head back to the Lumoras homepage, insights, knowledge base or help center.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <PageShell className="pg-404">
      <div className="wrap nf">
        <p className="nf-code" aria-hidden="true">
          404
        </p>
        <h1 className="ph-title">This page is off the score.</h1>
        <p className="ph-lede">The link may be old, or the page moved. Here are a few places to pick the tune back up.</p>
        <div className="nf-actions">
          <Link className="btn btn-primary" href="/">
            Back to the homepage <Icon name="arrow" />
          </Link>
          <Link className="btn btn-ghost" href="/help-center">
            Visit the help center
          </Link>
        </div>
        <ul className="nf-links">
          <li><Link href="/insights">Insights</Link></li>
          <li><Link href="/knowledge-base">Knowledge base</Link></li>
          <li><Link href="/faq">FAQ</Link></li>
          <li><Link href="/demo">Book a demo</Link></li>
        </ul>
      </div>
    </PageShell>
  );
}
