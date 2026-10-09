# lumoras.ai web app

Next.js 16 (App Router, Turbopack), React 19, TypeScript, plain CSS. The production site for
lumoras.ai, ported from the approved Spectrum prototype (`prototypes/c-spectrum.html`).

## Run

From the repo root (pnpm workspace):

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # static generation of every page and article
pnpm start        # serve the production build
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint (eslint-config-next)
```

Node 20.9+ is required (Next 16). Fonts (Bricolage Grotesque, Hanken Grotesk, Martian Mono)
are fetched by `next/font/google` at build time and self-hosted, so the build needs network
access to Google Fonts once.

## Where things live

| Path | What |
| --- | --- |
| `content/insights/*.md` | Insights (frontmatter: title, description, date, readingMinutes, keyword, tags, `art.kind` + `art.chips`) |
| `content/knowledge-base/*.md` | Guides (topic, updated, keyPoints, order) |
| `content/help-center/*.md` | Help articles (category, order, appliesTo, review) |
| `content/faq.json`, `content/about.json` | FAQ groups and the About page |
| `lib/content.ts` | Typed loaders, markdown to HTML (remark/rehype, heading ids), table of contents, related items |
| `lib/site.ts` | Site URL, names, demo line, product links, **TODO placeholders** (contact email/phone, sign-in URL) |
| `lib/seo.ts` | `pageMeta()` and JSON-LD builders |
| `components/` | Nav with Company dropdown, theme control, footer, `InsightArt`, cards, forms |
| `components/home/` | Homepage client islands: particle field (lazy), chapter rail, daypart, voice switch, verticals |
| `app/globals.css` | Spectrum tokens (dark + "Daylight spectrum" light) and shared components |
| `app/home.css`, `app/pages.css` | Homepage and inner-page styles |

The content format is specified in `docs/content-spec.md`. Loaders tolerate missing folders and
files (pages show an empty state), so the build never breaks while content is being written.
Set `LUMORAS_CONTENT_DIR` to point the loaders at a different folder (for example fixtures).

Adding an article: drop a `.md` file in the right folder and rebuild. Slugs come from file
names. New insights automatically appear in the Company dropdown (latest two), `/insights`,
related lists, the sitemap and `llms.txt`.

`InsightArt` draws card illustrations from frontmatter: `art.kind` is one of
`call | people | checklist | ticket | calendar | music | chart | zones`, and `art.chips` holds
two short labels.

## SEO notes

- Every route exports metadata: unique title (template `%s · Lumoras`, dropped when the result
  would exceed 60 characters), description from frontmatter, canonical, Open Graph and Twitter.
- `opengraph-image.tsx` per section and per article (title on the Spectrum gradient).
- `app/sitemap.ts` (static routes + all articles, lastModified from frontmatter),
  `app/robots.ts` (disallows `/api/`), `app/llms.txt/route.ts`, `app/icon.svg`.
- JSON-LD: Organization (Lumoras LLC with Sonorch, SeasonX, KitchenSpot as brands) and WebSite
  on every page; BreadcrumbList on inner pages; BlogPosting (insights), TechArticle (knowledge
  base), Article (help center), FAQPage (`/faq`).
- The homepage server-renders all copy; the particle canvas loads after `load` + idle via
  `next/dynamic` with `ssr: false`, pauses when the tab is hidden, uses fewer particles on small
  screens and renders a single static frame under `prefers-reduced-motion`.

## Demo requests

`POST /api/demo` validates the form (`lib/demo.ts`) and logs the request server-side
(`[demo-request]`). No email or CRM is wired yet: TODO before launch.
