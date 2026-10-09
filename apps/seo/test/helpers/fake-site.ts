/**
 * A fake client website for tests: robots.txt → sitemap index → two sitemaps
 * (one gzipped) → pages with titles and descriptions. URLs it lists use
 * http://<domain>:<port>, so the crawler stays on "the site" while the test
 * resolves <domain> to 127.0.0.1. Also serves one off-site URL (must be
 * ignored) and a page that redirects to a private address (must be refused).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";

export type FakeSite = { port: number; origin: string; hits: string[]; close(): Promise<void> };

export const FAKE_PAGES: Record<string, { title: string; description: string; h1: string }> = {
  "/": {
    title: "Northwind Dental · Family dentistry in Seattle",
    description: "Family and cosmetic dentistry in Seattle: cleanings, fillings, crowns and Invisalign, with evening appointments and same-week emergency visits.",
    h1: "Gentle dentistry for the whole family",
  },
  "/about": { title: "About Northwind Dental", description: "Our practice, our hygienists and how we work.", h1: "About us" },
  "/services/cleanings": { title: "Teeth cleaning", description: "Six-monthly cleanings and check-ups.", h1: "Cleanings" },
  "/services/invisalign": { title: "Invisalign clear aligners", description: "Straighter teeth without metal braces.", h1: "Invisalign" },
  "/pricing": { title: "Prices and insurance", description: "What a visit costs and which insurers we accept.", h1: "Pricing" },
  "/blog/how-often-should-you-floss": { title: "How often should you floss?", description: "A hygienist's answer.", h1: "How often should you floss?" },
};

export async function startFakeSite(domain = "northwind-dental.test", host = "127.0.0.1"): Promise<FakeSite> {
  const hits: string[] = [];
  let origin = "";
  const page = (p: string) => {
    const x = FAKE_PAGES[p];
    return `<!doctype html><html><head><meta charset="utf-8"><title>${x.title.replace("&", "&amp;")}</title>
<meta name="description" content="${x.description}"><meta property="og:site_name" content="Northwind Dental"></head>
<body><h1>${x.h1}</h1><p>Demo page.</p></body></html>`;
  };
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    hits.push(path);
    if (path === "/robots.txt") {
      res.setHeader("content-type", "text/plain");
      return res.end(`User-agent: *\nDisallow: /admin\n\nSitemap: ${origin}/sitemap_index.xml\n`);
    }
    if (path === "/sitemap_index.xml") {
      res.setHeader("content-type", "application/xml");
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>${origin}/sitemap-blog.xml.gz</loc><lastmod>2026-10-01</lastmod></sitemap>
</sitemapindex>`);
    }
    if (path === "/sitemap-pages.xml") {
      res.setHeader("content-type", "application/xml");
      const urls = ["/", "/about", "/services/cleanings", "/services/invisalign", "/pricing"];
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u, i) => `  <url><loc>${origin}${u}</loc><lastmod>2026-09-${String(10 + i).padStart(2, "0")}</lastmod></url>`).join("\n")}
  <url><loc>https://elsewhere.example/not-ours</loc></url>
  <url><loc><![CDATA[${origin}/services/cleanings?ref=a&amp;b]]></loc></url>
</urlset>`);
    }
    if (path === "/sitemap-blog.xml.gz") {
      res.setHeader("content-type", "application/x-gzip");
      return res.end(
        zlib.gzipSync(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${origin}/blog/how-often-should-you-floss</loc><lastmod>2026-10-01T09:00:00+00:00</lastmod></url>
</urlset>`),
      );
    }
    if (FAKE_PAGES[path]) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(page(path));
    }
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((r) => server.listen(Number(process.env.FAKE_SITE_PORT ?? 0), host, r));
  const port = (server.address() as AddressInfo).port;
  origin = `http://${domain}:${port}`;
  return {
    port,
    origin,
    hits,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
