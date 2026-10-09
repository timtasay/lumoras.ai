# lumoras.ai web app

Next.js 16 (App Router, Turbopack), React 19, TypeScript, plain CSS. The production site for
lumoras.ai, built from the **A · Voice Core** prototype (`prototypes/a-voice-core.html`) with two
elements carried over from C · Spectrum (`prototypes/c-spectrum.html`): the **Spectrum logo**
(nav, footer, `app/icon.svg`, Organization logo, OG cards) and the **Spectrum particle field**
behind the homepage.

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

Node 20.9+ is required (Next 16). Fonts (Sora for display, Geist for body, Geist Mono for labels
and data) are fetched by `next/font/google` at build time and self-hosted, so the build needs
network access to Google Fonts once.

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
| `lib/theme.ts` | Theme key (`lumoras-theme`), theme-color values, the pre-paint init script |
| `components/` | Nav with Company dropdown, theme control, footer, `InsightArt`, cards, forms, static inner-page backdrop |
| `components/home/` | Homepage islands: `VoiceConsole` (+ `orb-engine.ts`, `console-data.ts`), `HelloCycle`, `Verticals` + `VertHighlight`, `SwitchDemo`, `RetailSound`, and the particle field (`FieldLoader` → `ParticleField` → `field-engine.ts`) |
| `app/globals.css` | Voice Core tokens (dark control room + light clean-room lab), Spectrum logo/field tokens (`--s1..--s4`, `--cv-*`) and shared components |
| `app/home.css`, `app/pages.css` | Homepage and inner-page styles |

The content format is specified in `docs/content-spec.md`. Loaders tolerate missing folders and
files (pages show an empty state), so the build never breaks while content is being written.
Set `LUMORAS_CONTENT_DIR` to point the loaders at a different folder (for example fixtures).

Adding an article: drop a `.md` file in the right folder and rebuild. Slugs come from file
names. New insights automatically appear in the Company dropdown (latest two), `/insights`,
related lists, the sitemap and `llms.txt`.

`InsightArt` draws card illustrations (Voice Core palette, both themes) from frontmatter: `art.kind` is one of
`call | people | checklist | ticket | calendar | music | chart | zones`, and `art.chips` holds
two short labels.

## SEO notes

- Every route exports metadata: unique title (template `%s · Lumoras`, dropped when the result
  would exceed 60 characters), description from frontmatter, canonical, Open Graph and Twitter.
- `opengraph-image.tsx` per section and per article (Voice Core obsidian with mint/amber glows,
  Spectrum logo, no external fonts).
- `app/sitemap.ts` (static routes + all articles, lastModified from frontmatter),
  `app/robots.ts` (disallows `/api/`), `app/llms.txt/route.ts`, `app/icon.svg`.
- JSON-LD: Organization (Lumoras LLC with Sonorch, SeasonX, KitchenSpot as brands) and WebSite
  on every page; BreadcrumbList on inner pages; BlogPosting (insights), TechArticle (knowledge
  base), Article (help center), FAQPage (`/faq`).
- The homepage server-renders all copy, including the completed salon call in the voice
  console. The H1 reads "The voice of every business." with an eyebrow inside it carrying
  "AI receptionist · AI voice agents" for search.
- The particle canvas loads after `load` + idle via `next/dynamic` with `ssr: false`, pauses
  when the tab is hidden, uses fewer particles on small screens and renders a single static
  frame under `prefers-reduced-motion`. Inner pages use a static CSS backdrop instead.

## Homepage particle field

`FieldLoader` observes every `[data-form]` section (and the footer) and writes the active
formation to `lib/home-bus.ts`; `field-engine.ts` morphs the particles between formations.

| Section | Formation |
| --- | --- |
| Hero (`#top`) | sphere, dimmed and set to the right so the voice orb stays the centrepiece |
| Instruments strip, Platform bento (`#platform`) | waveform |
| AI voice verticals (`#verticals`) | constellation: one cluster behind each vertical card; hovering or focusing a card lights its cluster |
| Product family (`#products`) | orbits |
| POS + voice switch (`#switch`) | receipt, printing out of the POS mock |
| Retail Sound (`#sound`) | speaker rings; the daypart picker changes their pace and colour |
| Enterprise (`#enterprise`) | globe |
| How it works (`#how`) | stream with four nodes |
| Closing CTA (`#demo`) and footer | sphere |

Colours come from the Spectrum tokens: additive glow in dark, normal compositing in light. Each
formation has its own dim level, homepage panels are frosted glass over the field, and text
that sits directly on it gets a soft `.scrim`, so copy stays above 4.5:1 contrast.

## Demo requests

`POST /api/demo` validates the form (`lib/demo.ts`) and logs the request server-side
(`[demo-request]`). No email or CRM is wired yet: TODO before launch.
