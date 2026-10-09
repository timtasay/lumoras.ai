import type { TocItem } from "@/lib/content";

/** Table of contents from H2s: sticky aside on desktop, collapsible on small screens. */
export function Toc({ items }: { items: TocItem[] }) {
  if (items.length < 2) return null;
  const list = (
    <ol>
      {items.map((t) => (
        <li key={t.id}>
          <a href={`#${t.id}`}>{t.text}</a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <nav className="toc toc-desk" aria-label="On this page">
        <p className="toc-title mono">On this page</p>
        {list}
      </nav>
      <details className="toc toc-mob">
        <summary className="mono">On this page</summary>
        <nav aria-label="On this page (compact)">{list}</nav>
      </details>
    </>
  );
}
