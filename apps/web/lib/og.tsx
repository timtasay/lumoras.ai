import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/**
 * Open Graph card in the Voice Core palette: obsidian with mint and amber
 * glows, a faint control-room grid, the Spectrum brand mark and the title.
 * Uses next/og's bundled default font (no external font requests).
 */
export function ogImage({ eyebrow, title, footer = "lumoras.ai" }: { eyebrow?: string; title: string; footer?: string }) {
  const size = title.length > 70 ? 54 : title.length > 44 ? 64 : 76;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: "#06070B",
          backgroundImage:
            "radial-gradient(circle at 82% 18%, rgba(77,243,208,0.30), rgba(77,243,208,0) 42%), radial-gradient(circle at 4% 0%, rgba(255,138,76,0.20), rgba(255,138,76,0) 38%), radial-gradient(circle at 60% 120%, rgba(127,216,255,0.14), rgba(127,216,255,0) 46%), linear-gradient(rgba(255,255,255,0.035) 1px, rgba(255,255,255,0) 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, rgba(255,255,255,0) 1px)",
          backgroundSize: "1200px 630px, 1200px 630px, 1200px 630px, 64px 64px, 64px 64px",
          color: "#E9EEF5",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 28 28" fill="none">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3EE7FF" />
                <stop offset=".4" stopColor="#7C8CFF" />
                <stop offset=".72" stopColor="#FF6FB5" />
                <stop offset="1" stopColor="#FFD27A" />
              </linearGradient>
            </defs>
            <circle cx="14" cy="14" r="12.25" stroke="url(#g)" strokeWidth="1.5" />
            <path d="M7.5 14h1M10.75 10.5v7M14 7v14M17.25 10.5v7M20.5 13v2" stroke="url(#g)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1 }}>Lumoras</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {eyebrow ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: "#8A93A6" }}>
              <div style={{ width: 12, height: 12, borderRadius: 12, backgroundColor: "#4DF3D0", boxShadow: "0 0 18px #4DF3D0" }} />
              {eyebrow}
            </div>
          ) : null}
          <div style={{ display: "flex", fontSize: size, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2.5, maxWidth: 1040 }}>{title}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              height: 3,
              width: "100%",
              borderRadius: 3,
              backgroundImage: "linear-gradient(90deg, rgba(77,243,208,0), #4DF3D0 18%, #A6FFEC 52%, #FF8A4C 86%, rgba(255,138,76,0))",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#C3CAD6" }}>
            <span>{footer}</span>
            <span style={{ color: "#4DF3D0" }}>AI receptionist · Voice · POS · Sound</span>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
