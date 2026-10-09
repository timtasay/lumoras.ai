import Link from "next/link";
import type { Insight } from "@/lib/content";
import { formatDate, tagLabel } from "@/lib/content";
import { InsightArt } from "./InsightArt";

type Props = {
  insight: Insight;
  variant?: "menu" | "card" | "feature";
  headingLevel?: "h2" | "h3" | "p";
  showDescription?: boolean;
};

/** Illustrated insight card. The whole card is one link (title is the accessible name). */
export function InsightCard({ insight, variant = "card", headingLevel = "h3", showDescription = true }: Props) {
  const H = headingLevel;
  return (
    <article className={`icard icard-${variant}`}>
      <InsightArt kind={insight.art.kind} chips={insight.art.chips} size={variant === "feature" ? "md" : "sm"} />
      <div className="icard-body">
        {variant !== "menu" && insight.tags.length > 0 ? (
          <p className="icard-tags">{insight.tags.slice(0, 2).map(tagLabel).join(" · ")}</p>
        ) : null}
        <H className="icard-title">
          <Link href={`/insights/${insight.slug}`} className="icard-link">
            {insight.title}
          </Link>
        </H>
        {showDescription && variant !== "menu" ? <p className="icard-desc">{insight.description}</p> : null}
        <p className="icard-meta">
          By {insight.author} on <time dateTime={insight.date}>{formatDate(insight.date)}</time>
          {variant !== "menu" ? <span> · {insight.readingMinutes} min read</span> : null}
        </p>
      </div>
    </article>
  );
}
