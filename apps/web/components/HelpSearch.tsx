"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Icon } from "./Icons";

export type HelpIndexItem = { slug: string; title: string; description: string; category: string };

function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Client-side search over help article titles, descriptions and categories. */
export function HelpSearch({ items }: { items: HelpIndexItem[] }) {
  const [q, setQ] = useState("");
  const id = useId();
  const results = useMemo(() => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return items
      .map((it) => {
        const t = norm(it.title), d = norm(`${it.description} ${it.category}`);
        if (!terms.every((x) => t.includes(x) || d.includes(x))) return null;
        const score = terms.reduce((s, x) => s + (t.includes(x) ? 3 : 1), 0);
        return { it, score };
      })
      .filter((x): x is { it: HelpIndexItem; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.it);
  }, [q, items]);

  const active = q.trim().length > 0;

  return (
    <div className="hs" role="search">
      <label htmlFor={`${id}-q`} className="sr-only">
        Search help articles
      </label>
      <div className="hs-box">
        <Icon name="search" />
        <input
          id={`${id}-q`}
          type="search"
          placeholder="Search: forwarding, transfers, payments, hours…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          aria-controls={`${id}-res`}
          aria-describedby={`${id}-count`}
        />
      </div>
      <p id={`${id}-count`} className="hs-count" aria-live="polite">
        {active ? `${results.length} ${results.length === 1 ? "article" : "articles"} found` : ""}
      </p>
      <ul id={`${id}-res`} className="hs-res panel" hidden={!active || results.length === 0}>
        {results.map((r) => (
          <li key={r.slug}>
            <Link href={`/help-center/${r.slug}`}>
              <span className="hs-cat">{r.category}</span>
              <strong>{r.title}</strong>
              <span>{r.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      {active && results.length === 0 ? (
        <p className="hs-none">
          Nothing matched. Try a shorter word, browse the categories below, or <Link href="/demo" className="tlink">ask us directly</Link>.
        </p>
      ) : null}
    </div>
  );
}
