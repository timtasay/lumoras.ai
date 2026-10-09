"use client";

import { flushSync } from "react-dom";
import { useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icons";
import { Badge } from "@/components/ui/Status";
import { withViewTransition } from "@/lib/ui/motion";

type Article = { id: string; title: string; keyword: string; status: "Scheduled" | "Awaiting review" | "Published"; date: string; words: number; tone: "ion" | "amber" | "info" };

const ARTICLES: Article[] = [
  { id: "a1", title: "AI receptionist for salons: what it handles and what it should not", keyword: "ai receptionist for salons", status: "Awaiting review", date: "Tue 14 Oct", words: 2140, tone: "amber" },
  { id: "a2", title: "How restaurants stop losing phone orders at the dinner rush", keyword: "restaurant phone orders", status: "Scheduled", date: "Fri 17 Oct", words: 1860, tone: "info" },
  { id: "a3", title: "No-show policy templates that clients actually accept", keyword: "no show policy", status: "Published", date: "Tue 7 Oct", words: 1720, tone: "ion" },
];

/**
 * List → detail with the View Transitions API: the card and the detail header
 * share a view-transition-name, so the card morphs into the page. Without
 * support, or under reduced motion, the swap is instant.
 */
export function MorphDemo() {
  const [open, setOpen] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState<string | null>(null);
  const go = (id: string | null) =>
    withViewTransition(() => {
      flushSync(() => setOpen(id));
      if (id === null) document.getElementById(`morph-${lastOpen}`)?.focus();
    });
  const a = ARTICLES.find((x) => x.id === open);

  return (
    <div className="morph">
      {a ? (
        <article className="morph-detail panel" style={{ viewTransitionName: `card-${a.id}` } as CSSProperties}>
          <button type="button" className="morph-back" onClick={() => go(null)} autoFocus>
            <Icon name="back" /> All articles
          </button>
          <div className="morph-dhead">
            <Badge tone={a.tone}>{a.status}</Badge>
            <h3 style={{ viewTransitionName: `title-${a.id}` } as CSSProperties}>{a.title}</h3>
            <p className="mono muted">
              {a.keyword} · {a.date} · {a.words.toLocaleString("en-US")} words
            </p>
          </div>
          <div className="morph-body">
            <p>
              The detail page grows out of the card you pressed: same surface, same title, now with room for the editor, the SEO
              checklist and the fact-check evidence (Phase 3).
            </p>
            <ul className="morph-check">
              <li><Icon name="check" /> Title 58 characters</li>
              <li><Icon name="check" /> 4 internal links resolve on {a.date}</li>
              <li><Icon name="check" /> 7 of 7 claims sourced</li>
            </ul>
          </div>
        </article>
      ) : (
        <ul className="morph-list">
          {ARTICLES.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                id={`morph-${x.id}`}
                className="morph-card panel"
                style={{ viewTransitionName: `card-${x.id}` } as CSSProperties}
                onClick={() => {
                  setLastOpen(x.id);
                  go(x.id);
                }}
              >
                <span className="morph-top">
                  <Badge tone={x.tone}>{x.status}</Badge>
                  <span className="mono muted">{x.date}</span>
                </span>
                <span className="morph-title" style={{ viewTransitionName: `title-${x.id}` } as CSSProperties}>
                  {x.title}
                </span>
                <span className="morph-kw mono">{x.keyword}</span>
                <Icon name="arrow" className="morph-go" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
