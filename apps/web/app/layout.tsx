import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";
import { IconSprite } from "@/components/Icons";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { THEME_INIT_SCRIPT } from "@/components/ThemeControl";
import { InsightCard } from "@/components/InsightCard";
import { JsonLd } from "@/components/JsonLd";
import { getInsights } from "@/lib/content";
import { organizationLd, websiteLd } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-display",
  display: "swap",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});
const mono = Martian_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
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
    { media: "(prefers-color-scheme: light)", color: "#F2F3F8" },
    { media: "(prefers-color-scheme: dark)", color: "#04060F" },
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
