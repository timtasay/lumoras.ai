# lumoras.ai

Website for **Lumoras**: sound orchestration for business. AI voice verticals for every industry,
including order support for retail and online stores (order status, tracking, cancellations,
changes, returns), and a POS for any service business with voice you can switch on anytime.

Product family: [Sonorch](https://sonorch.ai) (salons),
[SeasonX](https://seasonx.ai) (restaurants) and [KitchenSpot](https://kitchenspot.ai).

## Website (apps/web)

The production site lives in [`apps/web`](apps/web/README.md): Next.js 16, React 19,
TypeScript, plain CSS, built from the **A · Voice Core** direction (control-room dark and
clean-room light themes, the live voice-orb console), keeping two things from C · Spectrum: the
**Spectrum logo** and the **Spectrum particle field**, which sits behind the homepage and morphs
into a new formation for each section. Content (insights, knowledge base, help center, FAQ,
About) is Markdown/JSON under `apps/web/content/`.

```bash
pnpm install
pnpm dev      # local development
pnpm build    # production build (static pages + articles)
pnpm start    # serve the build
```

Plan and content format: `docs/site-plan.md`, `docs/content-spec.md`.

## Lumoras Growth (apps/seo) and shared packages

[`apps/seo`](apps/seo/README.md) is Lumoras Growth (working name), the multi-client SEO and content
platform, currently at Phase 2 (research: SEO data provider, budget and reserve, usage ledger, research
log, Search Console and GA4; brief in `docs/seo-platform-build-prompt.md`, progress in
`apps/seo/docs/phase-2-summary.md`). Both apps
share `packages/ui-tokens` (Voice Core tokens and the theme control) and `packages/ui-field` (the
Spectrum particle field).

```bash
pnpm dev:seo     # http://localhost:3007 (/design shows the design system)
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # whole workspace, as CI runs it
```

## Homepage prototypes

Open `prototypes/index.html` in a browser to compare three design directions:

| File | Direction | In one line |
| --- | --- | --- |
| `prototypes/a-voice-core.html` | A · Voice Core | Dark control room; a morphing voice orb plays a live call per industry |
| `prototypes/b-score.html` | B · Score | Light/dark enterprise editorial built on a conductor's score; variable-font and SVG morphs |
| `prototypes/c-spectrum.html` | C · Spectrum | Cinematic particle field that morphs shape chapter by chapter |

Each file is self-contained (Google Fonts only, no build step). `prototypes/BRIEF.md` holds the
shared copy and product facts.

Before any of this goes live, check these:

- Every figure is illustrative except Sonorch's own published results, which are credited to Sonorch.
- Compliance and security wording (SSO/SCIM, audit logs, card data handling) describes intended
  capabilities. Confirm it before launch.

## Logo concepts

`brand/logo-concepts/index.html` shows round 2: six concepts built on light (lanterns, dawn),
each shown large, on dark, as an app icon and down to 16px, with a shortlist you can copy.
Round 1 (ten sound-based marks, set aside) is in `round-1.html`. Mark-only SVGs are in
`brand/logo-concepts/svg/`. Round 2 marks live in `round2.py`; run `python3 build.py` to
regenerate everything.
