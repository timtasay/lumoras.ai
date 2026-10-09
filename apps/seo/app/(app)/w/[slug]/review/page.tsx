import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { ReadOnlyNote } from "@/components/forms/FormBits";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, StatusLight } from "@/components/ui/Status";
import { readWorkspace } from "@/lib/actions";
import { can } from "@/lib/auth/permissions";
import { listReviewQueue } from "@/lib/data/content";
import { localParts } from "@/lib/content/schedule";
import { LABEL, TONE } from "@/lib/content/status";
import { relativeTime } from "@/lib/ui/time";

export const metadata: Metadata = { title: "Review queue" };

/** Articles waiting for a person: approve, request changes or reject (reviewers, editors, owners), soonest slot first. */
export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await readWorkspace(slug, async (tx, a) => ({ items: await listReviewQueue(tx), role: a.role }));
  const now = new Date();
  const canApprove = can(data.role, "content:approve");
  const waiting = data.items.filter((i) => i.status === "awaiting_review");
  const back = data.items.filter((i) => i.status === "changes_requested");
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>Content</b> · review gate
          </p>
          <h1>Review queue</h1>
          <p className="lede muted">Nothing publishes without a person approving it, unless a site is on autopilot. Lint and fact-check must pass before Approve is offered.</p>
        </div>
      </header>
      {!canApprove ? <ReadOnlyNote>Your role can read and comment on these articles. Reviewers, editors and owners approve them.</ReadOnlyNote> : null}
      {data.items.length === 0 ? (
        <EmptyState icon="gate" title="Nothing waits for review" text="Articles appear here once the pipeline has written, fact-checked and linted them." primary={<Link href={`/w/${slug}/content`} className={buttonClass("primary")}><span className="btn-label">Open the calendar</span></Link>} />
      ) : (
        <div className="stack-lg">
          {[
            { key: "w", title: "Awaiting review", items: waiting },
            { key: "b", title: "Changes requested", items: back },
          ]
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.key} aria-labelledby={`rq-${g.key}`}>
                <div className="sec-head">
                  <h2 id={`rq-${g.key}`}>
                    {g.title} <span className="muted">({g.items.length})</span>
                  </h2>
                </div>
                <ul className="rq-list">
                  {g.items.map((i) => {
                    const l = localParts(i.slot_at, i.timezone);
                    const days = Math.round((i.slot_at.getTime() - now.getTime()) / 86_400_000);
                    const blocked = i.unverifiable_claims > 0 || i.lint_passed === false || i.fact_check_passed !== true;
                    return (
                      <li key={i.id} className="panel rq-item">
                        <div className="rq-main">
                          <p className="rq-meta">
                            <Badge tone={TONE[i.status]}>{LABEL[i.status]}</Badge>
                            <span className="mono small">{i.domain}</span>
                            <span className="small muted">v{i.version}</span>
                          </p>
                          <h3 className="rq-title">
                            <Link href={`/w/${slug}/content/${i.id}`} className="rq-link">
                              {i.title || i.primary_keyword}
                            </Link>
                          </h3>
                          <p className="small muted">
                            Targets <strong>{i.primary_keyword}</strong>
                            {i.author_name ? ` · by ${i.author_name}` : ""}
                            {i.author_demo ? " (demo byline)" : ""}
                          </p>
                        </div>
                        <div className="rq-side">
                          <p className="small">
                            <Icon name="calendar" className="inline-ico" /> {l.date} {l.time}
                            <span className="muted"> · {days <= 0 ? "due now" : `in ${days} day${days === 1 ? "" : "s"}`}</span>
                          </p>
                          <p className="rq-checks">
                            <StatusLight state={i.lint_passed ? "ok" : "error"}>{i.lint_passed ? "Lint passed" : "Lint failing"}</StatusLight>
                            <StatusLight state={i.unverifiable_claims > 0 ? "error" : i.fact_check_passed ? "ok" : "warn"}>
                              {i.unverifiable_claims > 0 ? `${i.unverifiable_claims} unverifiable` : i.fact_check_passed ? "Fact-check passed" : "Not fact-checked"}
                            </StatusLight>
                          </p>
                          <p className="small muted">Waiting {relativeTime(i.waiting_since, now)}</p>
                          <Link href={`/w/${slug}/content/${i.id}`} className={buttonClass(canApprove && !blocked && i.status === "awaiting_review" ? "primary" : "secondary", "sm")}>
                            <span className="btn-label">{canApprove && i.status === "awaiting_review" ? (blocked ? "Open: blocked" : "Review") : "Read"}</span>
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
