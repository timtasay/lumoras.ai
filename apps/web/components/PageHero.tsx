import type { ReactNode } from "react";

/** Shared hero for inner pages: eyebrow, the page's single H1, and a lede. */
export function PageHero({
  eyebrow,
  title,
  lede,
  children,
  center = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <header className={center ? "phero phero-center" : "phero"}>
      {eyebrow ? <p className="eyebrow mono">{eyebrow}</p> : null}
      <h1 className="ph-title">{title}</h1>
      {lede ? <p className="ph-lede">{lede}</p> : null}
      {children}
    </header>
  );
}
