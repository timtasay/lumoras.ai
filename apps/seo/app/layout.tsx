import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "@lumoras/ui-tokens/tokens.css";
import "@lumoras/ui-tokens/theme-control.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/charts.css";
import "./styles/pipeline.css";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@lumoras/ui-tokens/theme";
import { IconSprite } from "@/components/Icons";
import { AppShell } from "@/components/shell/AppShell";
import { PRODUCT_NAME } from "@/components/shell/nav";
import { isDesignRouteEnabled } from "@/lib/env";

/* Voice Core type, same as lumoras.ai: Sora (display), Geist (body), Geist Mono (labels and data). */
const display = Sora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-sora", display: "swap" });
const body = Geist({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: "Plan, produce, publish and measure SEO content for every client site from one place.",
  applicationName: PRODUCT_NAME,
  // A private app: nothing here belongs in a search index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page is per-request (env flags now, signed-in sessions from Phase 1).
  await connection();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <IconSprite />
        <AppShell designEnabled={isDesignRouteEnabled()}>{children}</AppShell>
      </body>
    </html>
  );
}
