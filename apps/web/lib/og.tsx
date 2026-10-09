import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/**
 * Open Graph card: title text on the Spectrum gradient, brand mark and URL.
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
          backgroundColor: "#04060F",
          backgroundImage:
            "radial-gradient(circle at 8% 0%, rgba(62,231,255,0.38), rgba(62,231,255,0) 46%), radial-gradient(circle at 100% 10%, rgba(255,111,181,0.32), rgba(255,111,181,0) 44%), radial-gradient(circle at 70% 110%, rgba(124,140,255,0.42), rgba(124,140,255,0) 52%), radial-gradient(circle at 104% 92%, rgba(255,210,122,0.26), rgba(255,210,122,0) 34%)",
          color: "#F2F4FF",
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
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: "#C9CEE6" }}>{eyebrow}</div>
          ) : null}
          <div style={{ display: "flex", fontSize: size, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1040 }}>{title}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              height: 4,
              width: "100%",
              borderRadius: 4,
              backgroundImage: "linear-gradient(90deg, #3EE7FF, #7C8CFF 38%, #FF6FB5 70%, #FFD27A)",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#C9CEE6" }}>
            <span>{footer}</span>
            <span>AI receptionist · Voice · POS · Sound</span>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
