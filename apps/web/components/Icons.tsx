/**
 * Shared SVG sprite (rendered once in the root layout) and an <Icon> helper.
 * The `spec` gradient paints the Spectrum brand mark (kept from the Spectrum
 * direction) and follows the --s1..--s4 theme tokens.
 */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="spec" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--s1)" }} />
          <stop offset=".4" style={{ stopColor: "var(--s2)" }} />
          <stop offset=".72" style={{ stopColor: "var(--s3)" }} />
          <stop offset="1" style={{ stopColor: "var(--s4)" }} />
        </linearGradient>
      </defs>
      <symbol id="i-phone" viewBox="0 0 24 24"><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></symbol>
      <symbol id="i-card" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h4" /></symbol>
      <symbol id="i-wave" viewBox="0 0 24 24"><path d="M3 12h1.5M7 8v8M11 4.5v15M15 8.5v7M19 10.5v3" /></symbol>
      <symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.5M4 12h.5M4 18h.5" /></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3.5l9 4.5-9 4.5-9-4.5 9-4.5z" /><path d="M3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5" /></symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 8h16M4 16h16" /></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
      <symbol id="i-chev" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6" /></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></symbol>
      <symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.2" /></symbol>
      <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M5.3 18.7l1.55-1.55M17.15 6.85l1.55-1.55" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" /></symbol>
      <symbol id="i-auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none" /></symbol>
    </svg>
  );
}

export type IconName =
  | "phone" | "card" | "wave" | "layers" | "list" | "arrow" | "check" | "menu" | "close" | "chev" | "search" | "book" | "help" | "ext" | "doc" | "sun" | "moon" | "auto";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `ico ${className}` : "ico"} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** The Lumoras brand mark (Spectrum logo): a ring with a five-bar waveform, stroked in the spectrum gradient. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none" aria-hidden="true" focusable="false">
      <circle cx="14" cy="14" r="12.25" stroke="url(#spec)" strokeWidth="1.5" />
      <path d="M7.5 14h1M10.75 10.5v7M14 7v14M17.25 10.5v7M20.5 13v2" stroke="url(#spec)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
