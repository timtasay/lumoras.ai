/**
 * Per-site public feeds of published articles (section 8.3): JSON Feed 1.1
 * (https://www.jsonfeed.org/version/1.1/) and RSS 2.0, so any custom site can
 * pull instead of receiving webhooks. Pure renderers; the route handler
 * (app/api/feeds/[token]/…) finds the site by its unguessable feed token.
 */
import { renderMarkdown } from "../content/markdown.ts";

export type FeedArticle = {
  id: string;
  url: string;
  title: string;
  description: string;
  bodyMd: string;
  date: string;
  updatedAt: Date;
  author: string | null;
  /** schema.org type of the byline: Person, or Organization for an organization byline. */
  authorType?: "Person" | "Organization" | null;
  tags: string[];
  keyword: string;
};
export type FeedSite = { name: string; domain: string; feedUrl: string };

export function jsonFeed(site: FeedSite, items: FeedArticle[]) {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: site.name,
    home_page_url: `https://${site.domain}/`,
    feed_url: site.feedUrl,
    language: "en",
    items: items.map((a) => ({
      id: a.id,
      url: a.url,
      title: a.title,
      summary: a.description,
      content_html: renderMarkdown(a.bodyMd),
      content_text: a.bodyMd,
      date_published: `${a.date}T00:00:00Z`,
      date_modified: a.updatedAt.toISOString(),
      ...(a.author ? { authors: [a.authorType === "Organization" ? { name: a.author, url: `https://${site.domain}/` } : { name: a.author }] } : {}),
      tags: a.tags,
      _lumoras: { keyword: a.keyword, ...(a.author ? { authorType: a.authorType ?? "Person" } : {}) },
    })),
  };
}

export const xmlEscape = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const rfc822 = (iso: string) => new Date(`${iso}T00:00:00Z`).toUTCString();

export function rssFeed(site: FeedSite, items: FeedArticle[]): string {
  const it = items
    .map(
      (a) => `    <item>
      <title>${xmlEscape(a.title)}</title>
      <link>${xmlEscape(a.url)}</link>
      <guid isPermaLink="false">${xmlEscape(a.id)}</guid>
      <pubDate>${rfc822(a.date)}</pubDate>
      <description>${xmlEscape(a.description)}</description>
${a.tags.map((t) => `      <category>${xmlEscape(t)}</category>`).join("\n")}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(site.name)}</title>
    <link>https://${xmlEscape(site.domain)}/</link>
    <description>${xmlEscape(`Articles published on ${site.domain}`)}</description>
${it}
  </channel>
</rss>
`;
}
