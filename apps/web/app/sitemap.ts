import type { MetadataRoute } from "next";
import { getGuides, getHelpArticles, getInsights } from "@/lib/content";
import { LEGAL_UPDATED, absoluteUrl } from "@/lib/site";

const maxDate = (dates: string[], fallback: string) => dates.reduce((m, d) => (d > m ? d : m), "") || fallback;

export default function sitemap(): MetadataRoute.Sitemap {
  const today = new Date().toISOString().slice(0, 10);
  const insights = getInsights();
  const guides = getGuides();
  const help = getHelpArticles();
  const latestAll = maxDate([...insights.map((i) => i.date), ...guides.map((g) => g.updated), ...help.map((h) => h.updated)], today);

  const statics: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: latestAll, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/about"), lastModified: latestAll, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/insights"), lastModified: maxDate(insights.map((i) => i.date), today), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/knowledge-base"), lastModified: maxDate(guides.map((g) => g.updated), today), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/help-center"), lastModified: maxDate(help.map((h) => h.updated), today), changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/faq"), lastModified: latestAll, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/demo"), lastModified: latestAll, changeFrequency: "yearly", priority: 0.5 },
    { url: absoluteUrl("/privacy"), lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/terms"), lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.3 },
  ];

  return [
    ...statics,
    ...insights.map((i) => ({ url: absoluteUrl(`/insights/${i.slug}`), lastModified: i.date, changeFrequency: "monthly" as const, priority: 0.7 })),
    ...guides.map((g) => ({ url: absoluteUrl(`/knowledge-base/${g.slug}`), lastModified: g.updated, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...help.map((h) => ({ url: absoluteUrl(`/help-center/${h.slug}`), lastModified: h.updated, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
