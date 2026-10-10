/**
 * Site-wide constants. Anything marked TODO must be confirmed before launch.
 */
export const SITE_URL = "https://lumoras.ai";
export const SITE_NAME = "Lumoras";
export const LEGAL_NAME = "Lumoras LLC";
export const TAGLINE = "Sound orchestration for every business";
export const SITE_DESCRIPTION =
  "Lumoras builds AI receptionists and AI voice agents for every industry, including order support for retail, and a POS for service businesses, working as one system.";

/** TODO(launch): replace with the real Lumoras contact address. Not rendered anywhere yet. */
export const CONTACT_EMAIL = "TODO@lumoras.ai";
/** TODO(launch): replace with the real Lumoras business phone. Not rendered anywhere yet. */
export const CONTACT_PHONE = "TODO";

/** Live AI receptionist demo line (published on sonorch.ai). */
export const DEMO_LINE = "941-430-4049";
export const DEMO_LINE_TEL = "tel:+19414304049";

/** Legal pages (/privacy, /terms): contacts carried over from the old lumoras.ai and the shared "Last updated" date. */
export const PRIVACY_EMAIL = "privacy@lumoras.ai";
export const LEGAL_EMAIL = "legal@lumoras.ai";
export const SECURITY_EMAIL = "security@lumoras.ai";
export const LEGAL_UPDATED = "2026-10-10";

/** TODO(launch): point at the real sign-in URL once the console has a public address. */
export const SIGN_IN_URL = "#";

export const PRODUCTS = {
  sonorch: {
    name: "Sonorch",
    url: "https://sonorch.ai",
    domain: "sonorch.ai",
    helpCenter: "https://sonorch.ai",
    privacy: "https://sonorch.ai/privacy",
    terms: "https://sonorch.ai/terms",
    description: "POS and AI receptionist for salons, barbers, spas, nail and lash studios and med spas.",
  },
  seasonx: {
    name: "SeasonX",
    url: "https://seasonx.ai",
    domain: "seasonx.ai",
    helpCenter: "https://seasonx.ai/help-center",
    demo: "https://seasonx.ai/demo",
    getStarted: "https://seasonx.ai/get-started",
    privacy: "https://seasonx.ai/privacy",
    terms: "https://seasonx.ai/terms",
    description: "AI receptionist and point of sale for restaurants.",
  },
  kitchenspot: {
    name: "KitchenSpot",
    url: "https://kitchenspot.ai",
    domain: "kitchenspot.ai",
    privacy: "https://kitchenspot.ai/privacy",
    terms: "https://kitchenspot.ai/terms",
    description: "Restaurant discovery with full menus, dish-by-dish ratings and pickup ordering.",
  },
} as const;

export const BRANDS = [PRODUCTS.sonorch, PRODUCTS.seasonx, PRODUCTS.kitchenspot];

/** Homepage section anchors used by the nav and footer. */
export const NAV_SECTIONS = [
  { label: "Platform", href: "/#platform" },
  { label: "Verticals", href: "/#verticals" },
  { label: "Products", href: "/#products" },
  { label: "Retail", href: "/#retail" },
  { label: "Enterprise", href: "/#enterprise" },
] as const;

export const COMPANY_LINKS = [
  { label: "About us", href: "/about", hint: "Who we are and what we build" },
  { label: "Insights", href: "/insights", hint: "Articles for owners and operators" },
  { label: "Knowledge base", href: "/knowledge-base", hint: "In-depth guides by topic" },
  { label: "Help center", href: "/help-center", hint: "Setup and how-to articles" },
  { label: "FAQ", href: "/faq", hint: "Short answers to common questions" },
] as const;

export function absoluteUrl(path = "/"): string {
  if (path.startsWith("http")) return path;
  return SITE_URL + (path.startsWith("/") ? path : `/${path}`);
}
