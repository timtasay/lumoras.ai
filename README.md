# lumoras.ai

Website for **Lumoras**: sound orchestration for business. AI voice verticals for every industry,
a POS for any service business with voice you can switch on anytime, and custom sound
orchestration for retail stores.

Product family: [Sonorch](https://sonorch.ai) (salons),
[SeasonX](https://seasonx.ai) (restaurants) and [KitchenSpot](https://kitchenspot.ai).

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

`brand/logo-concepts/index.html` shows ten logo concepts (large, on dark, as an app icon and
down to 16px), with a shortlist you can copy. Mark-only SVGs are in `brand/logo-concepts/svg/`.
Edit `brand/logo-concepts/build.py` and run `python3 build.py` to regenerate both.
