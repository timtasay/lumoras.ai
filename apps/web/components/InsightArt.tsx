import type { ArtKind } from "@/lib/content";

/**
 * Illustration for insight cards and article headers: a small UI vignette in
 * the Voice Core palette with two floating chips. Pure HTML/CSS/inline SVG, so
 * it follows the light and dark tokens and costs no image requests.
 * --tone is the vignette accent, --tone-2 the corner glow.
 */

const TONE: Record<ArtKind, [string, string]> = {
  call: ["var(--v-salon)", "var(--v-restaurant)"],
  people: ["var(--v-dental)", "var(--v-salon)"],
  checklist: ["var(--v-salon)", "var(--v-dental)"],
  ticket: ["var(--v-restaurant)", "var(--v-home)"],
  calendar: ["var(--v-dental)", "var(--v-salon)"],
  music: ["var(--v-retail)", "var(--v-restaurant)"],
  chart: ["var(--v-salon)", "var(--v-dental)"],
  zones: ["var(--v-restaurant)", "var(--v-dental)"],
};

function Bars({ n, seed = 1 }: { n: number; seed?: number }) {
  const hs = Array.from({ length: n }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin((i + 1) * 1.7 * seed + seed)));
  return (
    <span className="ia-bars">
      {hs.map((h, i) => (
        <i key={i} style={{ height: `${Math.round(h * 100)}%` }} />
      ))}
    </span>
  );
}

function Vignette({ kind }: { kind: ArtKind }) {
  switch (kind) {
    case "call":
      return (
        <div className="ia-ui ia-call">
          <div className="ia-row">
            <span className="ia-avatar" />
            <span className="ia-lines">
              <i style={{ width: "62%" }} />
              <i style={{ width: "40%" }} />
            </span>
            <span className="ia-live" />
          </div>
          <Bars n={22} seed={1.3} />
          <div className="ia-row ia-btns">
            <span className="ia-pill" />
            <span className="ia-pill ia-pill-on" />
          </div>
        </div>
      );
    case "people":
      return (
        <div className="ia-ui ia-people">
          {[0.78, 0.6, 0.7].map((w, i) => (
            <div className="ia-row" key={i}>
              <span className="ia-avatar" style={{ ["--h" as string]: i }} />
              <span className="ia-lines">
                <i style={{ width: `${w * 100}%` }} />
                <i style={{ width: `${w * 60}%` }} />
              </span>
              <span className={i === 0 ? "ia-tag ia-tag-on" : "ia-tag"} />
            </div>
          ))}
        </div>
      );
    case "checklist":
      return (
        <div className="ia-ui ia-check">
          {[1, 1, 0, 0].map((on, i) => (
            <div className="ia-row" key={i}>
              <span className={on ? "ia-box ia-box-on" : "ia-box"}>
                {on ? (
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 6.3l2.2 2.2 4.8-5" />
                  </svg>
                ) : null}
              </span>
              <span className="ia-lines">
                <i style={{ width: `${[72, 58, 80, 46][i]}%` }} />
              </span>
            </div>
          ))}
        </div>
      );
    case "ticket":
      return (
        <div className="ia-ui ia-ticket">
          <div className="ia-row ia-ticket-head">
            <span className="ia-lines">
              <i style={{ width: "46%" }} />
            </span>
            <span className="ia-timer">09:42</span>
          </div>
          {[64, 48, 70, 36].map((w, i) => (
            <div className="ia-row" key={i}>
              <span className="ia-qty" />
              <span className="ia-lines">
                <i style={{ width: `${w}%` }} />
              </span>
            </div>
          ))}
          <div className="ia-row ia-btns">
            <span className="ia-pill" />
            <span className="ia-pill" />
            <span className="ia-pill ia-pill-on" />
          </div>
        </div>
      );
    case "calendar":
      return (
        <div className="ia-ui ia-cal">
          <div className="ia-row ia-cal-head">
            <span className="ia-lines">
              <i style={{ width: "38%" }} />
            </span>
          </div>
          <div className="ia-grid">
            {Array.from({ length: 21 }, (_, i) => (
              <span key={i} className={i === 9 ? "on" : i === 4 || i === 15 ? "soft" : i === 12 ? "x" : undefined} />
            ))}
          </div>
        </div>
      );
    case "music":
      return (
        <div className="ia-ui ia-music">
          <div className="ia-row">
            <span className="ia-cover" />
            <span className="ia-lines">
              <i style={{ width: "70%" }} />
              <i style={{ width: "44%" }} />
            </span>
          </div>
          <span className="ia-progress">
            <i />
          </span>
          <Bars n={16} seed={2.1} />
        </div>
      );
    case "chart":
      return (
        <div className="ia-ui ia-chart">
          <div className="ia-row ia-kpis">
            <span className="ia-kpi" />
            <span className="ia-kpi" />
          </div>
          <svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
            <path className="ia-area" d="M0 70 L25 58 L50 62 L75 44 L100 48 L125 30 L150 34 L175 18 L200 22 L200 80 L0 80 Z" />
            <path className="ia-line" d="M0 70 L25 58 L50 62 L75 44 L100 48 L125 30 L150 34 L175 18 L200 22" />
            <circle className="ia-dot" cx="175" cy="18" r="4" />
          </svg>
        </div>
      );
    case "zones":
      return (
        <div className="ia-ui ia-zones">
          {["A", "B", "C", "D"].map((z, i) => (
            <div className={i === 0 ? "ia-zone on" : "ia-zone"} key={z}>
              <span className="ia-zl">{z}</span>
              <span className="ia-spk" />
              <span className="ia-lvl">
                <i style={{ width: `${[78, 40, 62, 30][i]}%` }} />
              </span>
            </div>
          ))}
        </div>
      );
  }
}

export function InsightArt({
  kind,
  chips,
  size = "md",
  className,
}: {
  kind: ArtKind;
  chips: [string, string] | string[];
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [a, b] = chips;
  return (
    <div
      className={`ia ia-${size}${className ? ` ${className}` : ""}`}
      style={{ ["--tone" as string]: TONE[kind][0], ["--tone-2" as string]: TONE[kind][1] }}
      aria-hidden="true"
      data-kind={kind}
    >
      <span className="ia-glow" />
      <Vignette kind={kind} />
      {a ? (
        <span className="ia-chip ia-chip-a">
          <span className="ia-chip-dot" />
          {a}
        </span>
      ) : null}
      {b ? (
        <span className="ia-chip ia-chip-b">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6.3l2.2 2.2 4.8-5" />
          </svg>
          {b}
        </span>
      ) : null}
    </div>
  );
}
