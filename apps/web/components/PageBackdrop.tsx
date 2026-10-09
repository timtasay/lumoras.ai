/**
 * Calm, static backdrop for inner pages: an iridescent gradient field and a
 * few spectrum hairlines. No canvas, no JS.
 */
export function PageBackdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="bd-field" />
      <svg className="bd-lines" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMin slice" focusable="false">
        <defs>
          <linearGradient id="bdl" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--s1)", stopOpacity: 0 }} />
            <stop offset=".25" style={{ stopColor: "var(--s1)" }} />
            <stop offset=".55" style={{ stopColor: "var(--s2)" }} />
            <stop offset=".8" style={{ stopColor: "var(--s3)" }} />
            <stop offset="1" style={{ stopColor: "var(--s4)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d="M-40 318 C 260 250, 520 380, 820 300 S 1300 210, 1500 270" />
        <path d="M-40 352 C 300 300, 560 420, 860 338 S 1320 260, 1500 318" />
        <path d="M-40 392 C 340 350, 600 452, 900 380 S 1340 312, 1500 366" />
      </svg>
      <div className="bd-fade" />
    </div>
  );
}
