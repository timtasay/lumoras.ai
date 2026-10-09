/**
 * Shared SVG sprite (rendered once in the root layout) and an <Icon> helper,
 * in the apps/web pattern: 24px grid, 1.8 stroke, round caps, currentColor.
 * The `spec` gradient paints the Spectrum brand mark and follows --s1..--s4.
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
      <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></symbol>
      <symbol id="i-back" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 8h16M4 16h16" /></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
      <symbol id="i-chev" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6" /></symbol>
      <symbol id="i-chev-r" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6" /></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M5.3 18.7l1.55-1.55M17.15 6.85l1.55-1.55" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" /></symbol>
      <symbol id="i-auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none" /></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></symbol>
      <symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></symbol>
      <symbol id="i-flow" viewBox="0 0 24 24"><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10M6.2 7.8l4.6 8.4M17.8 7.8l-4.6 8.4" /></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></symbol>
      <symbol id="i-trend" viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></symbol>
      <symbol id="i-audit" viewBox="0 0 24 24"><path d="M9 4h6l1 2h3v15H5V6h3z" /><path d="M9 13l2 2 4-4" /></symbol>
      <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></symbol>
      <symbol id="i-share" viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></symbol>
      <symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></symbol>
      <symbol id="i-swatch" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1.5-2-1.5-3.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" /></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M19.5 8.5A8 8 0 0 0 5 9M4.5 15.5A8 8 0 0 0 19 15" /><path d="M19.5 4v4.5H15M4.5 20v-4.5H9" /></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></symbol>
      <symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></symbol>
      <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" /></symbol>
      <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="M14 7l3 3" /></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></symbol>
      <symbol id="i-lint" viewBox="0 0 24 24"><path d="M5 6h14M5 12h9M5 18h6" /><path d="M15 17l2 2 4-4" /></symbol>
      <symbol id="i-gate" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z" /><path d="M11.5 13.5L20 4" /></symbol>
      <symbol id="i-pulse" viewBox="0 0 24 24"><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></symbol>
      <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="M4.5 7l7.5 6 7.5-6" /></symbol>
      <symbol id="i-google" viewBox="0 0 24 24"><path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z" /><path d="M12 21c2.4 0 4.5-.8 5.9-2.2l-2.9-2.2c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21z" /><path d="M7 13.8a5.4 5.4 0 0 1 0-3.5V8H4a9 9 0 0 0 0 8z" /><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7z" /></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.2v.3" /></symbol>
      <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.3" /></symbol>
      <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></symbol>
      <symbol id="i-down" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></symbol>
      <symbol id="i-sort" viewBox="0 0 24 24"><path d="M8 5v14M4.5 8.5L8 5l3.5 3.5M16 19V5M12.5 15.5L16 19l3.5-3.5" /></symbol>
      <symbol id="i-cmd" viewBox="0 0 24 24"><path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9V6.5zM15 6.5A2.5 2.5 0 1 1 17.5 9H15V6.5zM9 17.5A2.5 2.5 0 1 1 6.5 15H9v2.5zM15 17.5a2.5 2.5 0 1 0 2.5-2.5H15v2.5zM9 9h6v6H9z" /></symbol>
      <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" /></symbol>
      <symbol id="i-sparkle" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2.1 2.1.7-2.1.7L19 21.6l-.7-2.1-2.1-.7 2.1-.7z" /></symbol>
      <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.2a5.2 5.2 0 0 1 3 5.3" /></symbol>
      <symbol id="i-user-plus" viewBox="0 0 24 24"><circle cx="10" cy="8.5" r="3.4" /><path d="M3.8 19.5a6.2 6.2 0 0 1 12.4 0M18.5 8v6M15.5 11h6" /></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24"><path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7" /><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5" /></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></symbol>
      <symbol id="i-history" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4.5v4h4M12 8v4.5l3 2" /></symbol>
      <symbol id="i-plug" viewBox="0 0 24 24"><path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5" /></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10.5v6M13.5 10.5v6" /></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></symbol>
      <symbol id="i-radar" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6" /></symbol>
      <symbol id="i-building" viewBox="0 0 24 24"><path d="M4.5 20.5V5.5l8-2v17M12.5 8.5h7v12M3 20.5h18M7.5 8.5h2M7.5 12h2M7.5 15.5h2M15.5 12h1.5M15.5 15.5h1.5" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></symbol>
      <symbol id="i-skip" viewBox="0 0 24 24"><path d="M5 6l7 6-7 6zM13 6l7 6-7 6z" /></symbol>
    </svg>
  );
}

export type IconName =
  | "arrow" | "back" | "check" | "menu" | "close" | "chev" | "chev-r" | "search" | "sun" | "moon" | "auto"
  | "home" | "grid" | "calendar" | "flow" | "key" | "trend" | "audit" | "link" | "share" | "settings" | "swatch"
  | "bell" | "plus" | "bolt" | "play" | "refresh" | "doc" | "db" | "target" | "pen" | "shield" | "lint" | "gate"
  | "send" | "pulse" | "mail" | "google" | "alert" | "info" | "up" | "down" | "sort" | "cmd" | "globe" | "sparkle"
  | "users" | "user-plus" | "logout" | "eye" | "history" | "plug" | "trash" | "copy" | "radar" | "building" | "lock" | "skip";

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
