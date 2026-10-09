import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import { IconSprite } from "@/components/Icons";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme";
import { InsightCard } from "@/components/InsightCard";
import { JsonLd } from "@/components/JsonLd";
import { getInsights } from "@/lib/content";
import { organizationLd, websiteLd } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

/* Voice Core type: Sora (display), Geist (body), Geist Mono (labels and data). Self-hosted by next/font. */
const display = Sora({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});
const body = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist",
  display: "swap",
});
const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: AI Receptionist, Voice Agents & POS`, template: "%s · Lumoras" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Lumoras team", url: SITE_URL }],
  creator: "Lumoras LLC",
  publisher: "Lumoras LLC",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: "/" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const latest = getInsights().slice(0, 2);
  const latestCards =
    latest.length > 0 ? (
      latest.map((i) => <InsightCard key={i.slug} insight={i} variant="menu" headingLevel="p" />)
    ) : (
      <p className="co-empty">New insights are on the way.</p>
    );

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
        <SiteNav latest={latestCards} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <JsonLd data={[organizationLd(), websiteLd()]} />
      </body>
    </html>
  );
}
