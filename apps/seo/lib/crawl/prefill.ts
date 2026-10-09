/**
 * Brand-profile pre-fill from a crawl, without a model: the homepage's meta
 * description becomes the overview draft, its title (or first heading) the
 * positioning draft, and the key pages keep their titles and descriptions.
 * The client corrects all of it in onboarding. Page text is untrusted data:
 * it is stored as plain text and shown escaped, never interpreted.
 */
import type { KeyPage } from "./crawler.ts";

export type BrandPrefill = {
  overview: string;
  positioning: string;
  keyPages: { url: string; title: string; description: string }[];
  siteName: string | null;
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export function brandPrefill(pages: KeyPage[]): BrandPrefill {
  const home = pages.find((p) => p.path === "/") ?? pages[0];
  const title = clean(home?.title);
  const h1 = clean(home?.h1);
  return {
    overview: clean(home?.description),
    positioning: h1 && h1 !== title ? h1 : title,
    keyPages: pages.map((p) => ({ url: p.url, title: clean(p.title), description: clean(p.description) })),
    siteName: clean(home?.siteName) || null,
  };
}
