/**
 * Voice Core theme logic shared by every Lumoras app.
 *
 * - Three modes: Light, Dark and Auto (follow the system). Auto is "no
 *   attribute" on <html>; Light and Dark set [data-theme].
 * - The choice is stored in localStorage under THEME_KEY.
 * - THEME_INIT_SCRIPT goes in <head> and applies a saved choice before first
 *   paint, so a forced theme never flashes.
 * - Changing the resolved theme runs a circular View Transition reveal from the
 *   control that was pressed (skipped under reduced motion), then dispatches
 *   THEME_EVENT on document so canvases can re-read their colour tokens.
 *
 * Server-safe: nothing here touches window until a function is called.
 */
export const THEME_KEY = "lumoras-theme";

/** Fired on document after the resolved theme changes. detail: { mode, resolved }. */
export const THEME_EVENT = "lumoras:themechange";

/** Browser chrome colours: the Voice Core page background in each theme. */
export const THEME_COLORS = { light: "#F3F6F8", dark: "#06070B" } as const;

/** Inline script for <head>: applies the saved Light/Dark choice before first paint (Auto = no attribute). */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content',t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}')});}}catch(e){}})();`;

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";
export type ThemeChangeDetail = { mode: ThemeMode; resolved: ResolvedTheme };

/** Order of the segmented control: Light · Dark · Auto. */
export const THEME_ORDER: readonly ThemeMode[] = ["light", "dark", "auto"];

export function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return "auto";
}

export const systemDarkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export const resolveMode = (m: ThemeMode): ResolvedTheme =>
  m === "auto" ? (systemDarkQuery().matches ? "dark" : "light") : m;

/** Writes [data-theme] and keeps the browser chrome colour in step. */
export function writeThemeAttr(m: ThemeMode) {
  const root = document.documentElement;
  if (m === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", m);
  // browser chrome follows a forced choice; Auto restores each meta's own colour
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((el) => {
    const own = (el.getAttribute("media") || "").includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    el.setAttribute("content", m === "auto" ? own : THEME_COLORS[m]);
  });
}

/* Tiny external store for the chosen mode (localStorage-backed), for useSyncExternalStore. */
let current: ThemeMode | null = null;
const listeners = new Set<() => void>();
export const getThemeMode = (): ThemeMode => (current ??= readStoredMode());
export const getServerThemeMode = (): ThemeMode => "auto";
export const subscribeThemeMode = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
export function setThemeModeState(m: ThemeMode) {
  current = m;
  listeners.forEach((l) => l());
}
/** Persists a mode choice (best effort: storage can be blocked). */
export function persistThemeMode(m: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, m);
  } catch {}
}

export function dispatchThemeChange(detail: ThemeChangeDetail) {
  document.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_EVENT, { detail }));
}

type VTDocument = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> };
};

/** Duration and easing of the circular theme reveal. */
export const THEME_REVEAL = { duration: 600, easing: "cubic-bezier(.2,.7,.1,1)" } as const;

/**
 * Applies a theme change. When the resolved theme actually changes and the
 * browser supports View Transitions (and motion is allowed), the new theme is
 * revealed as a circle growing from `origin`; otherwise it switches instantly.
 * `commit` runs inside the transition (write the attribute, announce).
 */
export function revealThemeChange(changes: boolean, origin: HTMLElement | null, commit: () => void) {
  const doc = document as VTDocument;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (changes && typeof doc.startViewTransition === "function" && !reduce) {
    const rect = origin ? origin.getBoundingClientRect() : { left: innerWidth / 2, top: 0, width: 0, height: 0 };
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = doc.startViewTransition(commit);
    vt.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
          { ...THEME_REVEAL, pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
  } else {
    commit();
  }
}
