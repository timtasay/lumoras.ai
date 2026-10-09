/**
 * Shared SVG sprite (rendered once in the root layout) and an <Icon> helper.
 * The `spec` gradient is used by the brand mark and follows the theme tokens.
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
      <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></symbol>
      <symbol id="i-cal" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></symbol>
      <symbol id="i-bag" viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></symbol>
      <symbol id="i-lang" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" /></symbol>
      <symbol id="i-transfer" viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3" /></symbol>
      <symbol id="i-msg" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z" /><path d="M8 9.5h8M8 12.5h5" /></symbol>
      <symbol id="i-ticket" viewBox="0 0 24 24"><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7z" /><path d="M14 8v2M14 12v0M14 14v2" /></symbol>
      <symbol id="i-card" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h4" /></symbol>
      <symbol id="i-team" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.4" /><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15.5 15c2.3-.2 4.2 1.1 5 4" /></symbol>
      <symbol id="i-box" viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></symbol>
      <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></symbol>
      <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20V4M4 20h16" /><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6" /></symbol>
      <symbol id="i-zones" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></symbol>
      <symbol id="i-wave" viewBox="0 0 24 24"><path d="M3 12h1.5M7 8v8M11 4.5v15M15 8.5v7M19 10.5v3" /></symbol>
      <symbol id="i-mega" viewBox="0 0 24 24"><path d="M4 10v4h3l7 4V6l-7 4H4z" /><path d="M17.5 9a4 4 0 0 1 0 6" /></symbol>
      <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M6 4v16M12 4v16M18 4v16M4 14h4M10 8h4M16 16h4" /></symbol>
      <symbol id="i-scissors" viewBox="0 0 24 24"><circle cx="6.5" cy="17" r="2.5" /><circle cx="17.5" cy="17" r="2.5" /><path d="M8.3 15.2L18 4M15.7 15.2L6 4" /></symbol>
      <symbol id="i-utensils" viewBox="0 0 24 24"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7v3h3" /></symbol>
      <symbol id="i-store" viewBox="0 0 24 24"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16" /><path d="M10 20v-5h4v5" /></symbol>
      <symbol id="i-cross" viewBox="0 0 24 24"><path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4z" /></symbol>
      <symbol id="i-spark" viewBox="0 0 24 24"><path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8L11 3z" /><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></symbol>
      <symbol id="i-car" viewBox="0 0 24 24"><path d="M4 16v-4l2-5h12l2 5v4H4z" /><circle cx="7.5" cy="16.5" r="1.8" /><circle cx="16.5" cy="16.5" r="1.8" /><path d="M4 12h16" /></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><path d="M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5" /><path d="M12 18c-1.6 0-2.5-1-2.5-2.3 0-1.6 1.5-2.3 2.5-3.7 1 1.4 2.5 2.1 2.5 3.7 0 1.3-.9 2.3-2.5 2.3z" /></symbol>
      <symbol id="i-dumbbell" viewBox="0 0 24 24"><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" /></symbol>
      <symbol id="i-bed" viewBox="0 0 24 24"><path d="M3 18V6M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6" /><circle cx="7" cy="10.5" r="1.8" /></symbol>
      <symbol id="i-paw" viewBox="0 0 24 24"><circle cx="6.5" cy="10" r="1.8" /><circle cx="10" cy="6" r="1.8" /><circle cx="14.5" cy="6" r="1.8" /><circle cx="18" cy="10" r="1.8" /><path d="M12.2 12c-3 0-5.5 3.5-5.5 5.5 0 1.5 1.2 2.5 2.7 2.5 1.2 0 1.8-.6 2.8-.6s1.6.6 2.8.6c1.5 0 2.7-1 2.7-2.5 0-2-2.5-5.5-5.5-5.5z" /></symbol>
      <symbol id="i-brief" viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="12" rx="2" /><path d="M9 7V5h6v2M3.5 12h17" /></symbol>
      <symbol id="i-building" viewBox="0 0 24 24"><path d="M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3" /></symbol>
      <symbol id="i-cap" viewBox="0 0 24 24"><path d="M2.5 9.5L12 5l9.5 4.5L12 14 2.5 9.5z" /><path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5M21.5 9.5V15" /></symbol>
      <symbol id="i-wrench" viewBox="0 0 24 24"><path d="M15 3.5a5 5 0 0 0-4.6 6.9L4 16.8V20h3.2l6.4-6.4A5 5 0 0 0 20.5 9l-3 1-2.5-2.5 1-3-1-1z" /></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2.5 2.5M13.5 9.5l2 2" /></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6L12 3z" /><path d="M9 12l2 2 4-4" /></symbol>
      <symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.5M4 12h.5M4 18h.5" /></symbol>
      <symbol id="i-code" viewBox="0 0 24 24"><path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" /></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3.5l9 4.5-9 4.5-9-4.5 9-4.5z" /><path d="M3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" /></symbol>
      <symbol id="i-onboard" viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c1-3.5 3.5-5.5 6.5-5.5 1.5 0 2.8.4 3.9 1.2M18 14v6M15 17h6" /></symbol>
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
  | "phone" | "user" | "cal" | "bag" | "lang" | "transfer" | "msg" | "ticket" | "card" | "team" | "box" | "pin"
  | "chart" | "zones" | "clock" | "wave" | "mega" | "mic" | "sliders" | "scissors" | "utensils" | "store" | "cross"
  | "spark" | "car" | "home" | "dumbbell" | "bed" | "paw" | "brief" | "building" | "cap" | "wrench" | "key" | "shield"
  | "list" | "code" | "layers" | "lock" | "onboard" | "arrow" | "check" | "menu" | "close" | "chev" | "search" | "book"
  | "help" | "ext" | "doc" | "sun" | "moon" | "auto";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `ico ${className}` : "ico"} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** The Lumoras brand mark: a ring with a five-bar waveform, stroked in the spectrum gradient. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none" aria-hidden="true" focusable="false">
      <circle cx="14" cy="14" r="12.25" stroke="url(#spec)" strokeWidth="1.5" />
      <path d="M7.5 14h1M10.75 10.5v7M14 7v14M17.25 10.5v7M20.5 13v2" stroke="url(#spec)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
