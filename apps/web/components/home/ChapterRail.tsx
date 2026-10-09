"use client";

import { useEffect, useState } from "react";
import { setHome } from "@/lib/home-bus";

const CHAPTERS = [
  { id: "top", label: "Overview" },
  { id: "voice", label: "Voice" },
  { id: "pos", label: "Point of sale" },
  { id: "sound", label: "Retail sound" },
  { id: "verticals", label: "Verticals" },
  { id: "products", label: "Products" },
  { id: "enterprise", label: "Enterprise" },
  { id: "how", label: "Get started" },
];

/**
 * Observes the homepage chapters ([data-form] sections): drives the particle
 * formation and the chapter rail's current marker.
 */
export function ChapterRail() {
  const [ch, setCh] = useState(0);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-form]"));
    if (!("IntersectionObserver" in window) || sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const el = en.target as HTMLElement;
          setHome({ form: Number(el.dataset.form) });
          setCh(Number(el.dataset.ch));
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav className="rail" aria-label="Chapters">
      <ol>
        {CHAPTERS.map((c, i) => {
          const n = String(i).padStart(2, "0");
          return (
            <li key={c.id}>
              <button type="button" aria-current={ch === i ? "true" : undefined} aria-label={`${n} ${c.label}`} onClick={() => go(c.id)}>
                <span className="rl" aria-hidden="true">{c.label}</span>
                <span className="ri" aria-hidden="true">{n}</span>
                <span className="rt" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
