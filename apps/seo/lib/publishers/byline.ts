/**
 * Bylines as structured data (rule 10; owner decision of 10 October 2026).
 *
 * A byline is a real person or the client's organization ("Lumoras team"),
 * both configured per site by the client and never invented. Wherever an
 * article leaves the app with author data (the webhook body, Git frontmatter
 * placeholders, the JSON Feed, the pull request), a person is described as
 * schema.org `Person` and an organization as schema.org `Organization`. An
 * organization never carries a job title or personal credentials.
 *
 * Pure functions: the publishers and the pipeline call them; nothing here
 * reads the database or the network.
 */
import type { PublishableArticle } from "./types.ts";

export type AuthorKind = "person" | "organization";
export type SchemaAuthorType = "Person" | "Organization";

/** The byline as publishers receive it. */
export type Byline = {
  kind: AuthorKind;
  name: string;
  /** A person's real title; always "" for an organization. */
  role: string;
  /** schema.org type: Person for people, Organization for organizations. */
  type: SchemaAuthorType;
};

export const schemaTypeFor = (kind: AuthorKind): SchemaAuthorType => (kind === "organization" ? "Organization" : "Person");

/** The byline publishers get, from an authors row. An organization's role is dropped (it has none). */
export function toByline(a: { kind?: string | null; name: string; role: string }): Byline {
  const kind: AuthorKind = a.kind === "organization" ? "organization" : "person";
  return { kind, name: a.name, role: kind === "organization" ? "" : a.role, type: schemaTypeFor(kind) };
}

/**
 * The schema.org author node. Person: name and, when set, jobTitle.
 * Organization: name and the site's home page as url; never jobTitle.
 */
export function authorJsonLd(b: Byline, site: { domain: string }): Record<string, unknown> {
  if (b.kind === "organization") return { "@type": "Organization", name: b.name, url: `https://${site.domain}/` };
  return { "@type": "Person", name: b.name, ...(b.role ? { jobTitle: b.role } : {}) };
}

/** The article's schema.org BlogPosting, ready for a <script type="application/ld+json"> on the client's page. */
export function articleJsonLd(a: PublishableArticle, site: { domain: string }): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.updated,
    url: a.url,
    mainEntityOfPage: a.url,
    ...(a.keyword ? { keywords: [a.keyword, ...a.secondaryKeywords].join(", ") } : {}),
    wordCount: a.words,
    ...(a.author ? { author: authorJsonLd(a.author, site) } : {}),
  };
}
