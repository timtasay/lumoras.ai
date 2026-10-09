# lumoras.ai site: implementation plan

Direction chosen: **A · Voice Core** (`prototypes/a-voice-core.html`), with two elements carried
over from C · Spectrum: the Spectrum **logo** and the Spectrum **background particle field**, which
sits behind the Voice Core homepage and morphs into a new formation for each section. Light · Dark ·
Auto themes. (The site was first built from Spectrum; that version is in git history.) Add a **Company** dropdown like seasonx.ai: About us, Insights,
Knowledge base, Help center, FAQ, plus the two latest insights as illustrated cards.

## Stack (matches seasonx.ai and kitchenspot.ai)

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, pnpm workspace: `apps/web`.
- Plain CSS with the Voice Core tokens (no Tailwind). Fonts self-hosted through `next/font/google`
  (Sora, Geist, Geist Mono), so no layout shift and no third-party font request.
- Content in Markdown with frontmatter under `apps/web/content/` (see `docs/content-spec.md`),
  statically generated at build time.

## Pages in phase 1

| Route | What |
| --- | --- |
| `/` | Voice Core homepage, ported to React, over the Spectrum particle field. Text server-rendered; the orb console and particle canvas are client-only enhancements loaded after paint. |
| `/about` | About Lumoras LLC: what we build, the product family, how we work. |
| `/insights`, `/insights/[slug]` | Articles for owners and operators, illustrated cards, newest first. |
| `/knowledge-base`, `/knowledge-base/[slug]` | In-depth guides by topic (AI receptionists, voice AI, AI call centers, phone lines, missed calls, store audio). |
| `/help-center`, `/help-center/[slug]` | Setup and how-to articles by category, with links to the Sonorch and SeasonX help centers. |
| `/faq` | Grouped answers, FAQPage structured data. |
| `/demo` | Demo request form (posts to `/api/demo`, which validates and logs until an email provider is configured). |

Nav items Platform, Verticals, Products, Retail and Enterprise link to homepage sections
in phase 1. Company opens the dropdown.

## SEO (built in, not bolted on)

Keyword research (OpenSEO, US, Oct 2026) sets the targets:

| Keyword | Volume | KD | Where |
| --- | --- | --- | --- |
| ai receptionist | 49,500 | 25 | Home title + H2s; KB pillar `what-is-an-ai-receptionist` |
| ai call center | 33,100 | 20 | KB `ai-call-center`; phase 2 Enterprise page |
| ai voice agents | 22,200 | 34 | Home; verticals section |
| pos system for small business | 4,400 | 22 | Home POS chapter; phase 2 POS page |
| ai receptionist for small business | 2,900 | 32 | Home; KB pillar |
| ai phone answering service | 2,400 | 18 | Insight `ai-receptionist-vs-answering-service` |
| ai virtual receptionist | 1,900 | 25 | KB pillar |
| voice ai for business | 1,600 | 15 | Home voice chapter; KB `how-voice-ai-works` |
| appointment reminder texts | 480 | 18 | Insight `appointment-reminder-texts` |
| where is my order (retail order calls) | n/a | n/a | KB `where-is-my-order-calls`; home `#retail` |
| order cancellation / returns and exchanges | n/a | n/a | Insights `order-cancellations-and-changes-by-phone`, `returns-and-exchanges-by-phone` |
| no show policy | 170 | 0 | Insight `no-show-policy` |
| call forwarding for business | 140 | 0 | KB `call-forwarding-for-business` |
| ai receptionist cost / pricing | 90 / 90 | 7 / 10 | Insight `ai-receptionist-cost` |
| ai receptionist for dental / medical office | 40–90 | 0–6 | Phase 2 industry pages (CPC $110–165) |

Technical:
- Metadata API on every route: unique title (≤ 60 chars) and description (≤ 155), canonical,
  Open Graph and Twitter cards, `metadataBase` = https://lumoras.ai.
- Generated Open Graph images (`opengraph-image.tsx`) per section and per article.
- `sitemap.ts` (every static route and article, with lastModified), `robots.ts`, `llms.txt`.
- JSON-LD: Organization (legal name Lumoras LLC, with Sonorch, SeasonX and KitchenSpot as
  brands), WebSite, BreadcrumbList on inner pages, BlogPosting for insights, TechArticle for
  knowledge-base guides, FAQPage on `/faq`, Article for help-center pages.
- One H1 per page, logical H2/H3, descriptive link text, internal links between insights,
  guides, help articles and the homepage.
- Core Web Vitals: static HTML, LCP is the headline text, the canvas starts after load and
  idles off-screen, no layout shift from fonts, minimal client JS on content pages.
- Original copy only. Nothing is copied from seasonx.ai or sonorch.ai (duplicate content across
  your own domains would compete with itself).

## Phase 2 (proposed, not in this build)

Dedicated landing pages for the highest-value terms: `/ai-receptionist`, `/pos`,
`/retail` (order support by phone), `/enterprise` (AI call center), and `/industries/[slug]` for the 14 verticals
(dental, medical, HVAC, plumbing, legal, salons, restaurants...). Then Search Console, rank
tracking in OpenSEO, and a publishing cadence for insights.

## Needs from you before launch

- Contact email and phone for Lumoras (placeholders live in `apps/web/lib/site.ts`).
- Privacy policy, terms and security pages (not written by us; linked once provided).
- Product review of help-center articles (marked `review: true` in their frontmatter).
- Hosting target (seasonx.ai runs Next.js behind Caddy and Cloudflare; the same works here).
