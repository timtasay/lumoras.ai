import type { Metadata } from "next";
import { BRANDS, LEGAL_NAME, SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from "./site";

const SUFFIX = " · Lumoras";
const MAX_TITLE = 60;

type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  tags?: string[];
};

/**
 * Per-page metadata: title (template suffix only while the result stays
 * ≤ 60 characters), description, canonical, Open Graph and Twitter.
 */
export function pageMeta(p: PageMetaInput): Metadata {
  const fits = p.title.length + SUFFIX.length <= MAX_TITLE;
  const fullTitle = fits ? p.title + SUFFIX : p.title;
  return {
    title: fits ? p.title : { absolute: p.title },
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: {
      type: p.type ?? "website",
      url: p.path,
      siteName: SITE_NAME,
      locale: "en_US",
      title: fullTitle,
      description: p.description,
      ...(p.type === "article"
        ? {
            publishedTime: p.publishedTime,
            modifiedTime: p.modifiedTime ?? p.publishedTime,
            authors: [`${SITE_NAME} team`],
            tags: p.tags,
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: p.description,
    },
  };
}

/* ---------------------------- JSON-LD ---------------------------- */

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/icon.svg"),
    description: SITE_DESCRIPTION,
    brand: BRANDS.map((b) => ({ "@type": "Brand", name: b.name, url: b.url })),
    sameAs: BRANDS.map((b) => b.url),
  };
}

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
  };
}

export type Crumb = { name: string; path: string };

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

type ArticleLdInput = {
  type: "BlogPosting" | "TechArticle" | "Article";
  title: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified?: string;
  keywords?: string[];
  section?: string;
  wordCount?: number;
  image?: string;
};

export function articleLd(a: ArticleLdInput) {
  const url = absoluteUrl(a.path);
  return {
    "@context": "https://schema.org",
    "@type": a.type,
    headline: a.title,
    description: a.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: a.datePublished,
    dateModified: a.dateModified ?? a.datePublished,
    inLanguage: "en-US",
    author: { "@type": "Organization", name: `${SITE_NAME} team`, url: SITE_URL },
    publisher: { "@id": ORG_ID, "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: absoluteUrl("/icon.svg") } },
    image: absoluteUrl(a.image ?? `${a.path}/opengraph-image`),
    ...(a.keywords && a.keywords.length ? { keywords: a.keywords.join(", ") } : {}),
    ...(a.section ? { articleSection: a.section } : {}),
    ...(a.wordCount ? { wordCount: a.wordCount } : {}),
  };
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}
