# Content spec for apps/web/content

All copy is original, written for lumoras.ai. Product facts come from `prototypes/BRIEF.md`
(Sonorch, SeasonX, KitchenSpot, Lumoras POS/Voice/Sound). Company legal name: **Lumoras LLC**.
Never put an email address, phone number, office address, founding date, team names, customer
names or statistics we cannot source into content. Example arithmetic is fine when labeled as
an example ("Say you miss eight calls a week..."). Author for every piece: `Lumoras team`.

Voice: plain, direct, specific, second person, short sentences. Show the arithmetic rather than
asserting numbers. No hype words (revolutionary, seamless, cutting-edge, game-changer), no
em-dash asides, no "not X, but Y" framing, no emoji.

SEO rules for every file:
- `title` ≤ 60 characters, contains the primary keyword naturally. The page H1 is the title.
- `description` 140–155 characters, written as a reason to click.
- Body starts with a 2–3 sentence answer to the title's question (good for featured snippets),
  then `##` sections (and `###` where needed). Never use `#` (H1) in the body.
- Link 3–6 related internal pages with descriptive anchor text, using the routes below.

## Routes that exist (link only to these)

`/`, `/#voice`, `/#pos`, `/#sound`, `/#verticals`, `/#products`, `/#enterprise`, `/about`,
`/insights`, `/knowledge-base`, `/help-center`, `/faq`, `/demo`, and every slug listed below
under its section. External: https://sonorch.ai, https://seasonx.ai, https://kitchenspot.ai.

## Insights: `content/insights/<slug>.md`

```yaml
---
title: "A no-show policy you can actually enforce"
description: "..."
date: "2026-10-06"            # YYYY-MM-DD, spread between 2026-08-20 and 2026-10-08
readingMinutes: 4
keyword: "no show policy"
tags: ["salons", "clinics"]   # industries it applies to
art:                          # drives the illustrated card (drawn in code)
  kind: "checklist"           # one of: call | people | checklist | ticket | calendar | music | chart | zones
  chips: ["Card hold: worth it?", "Reminder sent"]   # two short labels, ≤ 22 chars each
---
```
Body 700–1,100 words.

Slugs and primary keywords:
- `ai-receptionist-vs-answering-service` · ai phone answering service
- `ai-receptionist-cost` · ai receptionist cost
- `appointment-reminder-texts` · appointment reminder texts
- `no-show-policy` · no show policy
- `music-for-retail-stores` · music for retail stores
- `audio-branding-for-stores` · audio branding

## Knowledge base: `content/knowledge-base/<slug>.md`

```yaml
---
title: "What Is an AI Receptionist? How It Works and What It Costs"
description: "..."
topic: "ai-receptionists"     # ai-receptionists | voice-ai | call-centers | phone-lines | missed-calls | store-audio
updated: "2026-10-08"
readingMinutes: 7
keyword: "ai receptionist"
keyPoints:                    # three one-sentence takeaways shown above the article
  - "..."
  - "..."
  - "..."
order: 1
---
```
Body 1,300–2,000 words, cross-industry (salons, restaurants, clinics, trades, retail).

Slugs, topics and primary keywords:
- `what-is-an-ai-receptionist` · ai-receptionists · ai receptionist (+ ai virtual receptionist, ai receptionist for small business)
- `how-voice-ai-works` · voice-ai · voice ai for business
- `ai-call-center` · call-centers · ai call center
- `call-forwarding-for-business` · phone-lines · call forwarding for business
- `missed-calls` · missed-calls · missed calls small business
- `overhead-paging-and-store-announcements` · store-audio · overhead paging system

## Help center: `content/help-center/<slug>.md`

```yaml
---
title: "Connect your phone number to the AI receptionist"
description: "..."
category: "phone-and-voice"   # getting-started | phone-and-voice | pos-and-payments | retail-sound | account-and-data
order: 1
updated: "2026-10-08"
appliesTo: ["Sonorch", "SeasonX"]   # any of Sonorch, SeasonX, Lumoras POS, Lumoras Voice, Lumoras Sound
review: true                  # product team must confirm steps before launch
---
```
Body 250–600 words: what it does, numbered steps, what to check, related articles. Keep steps
at the level the product facts support; do not invent screen names beyond simple ones like
Settings, Phone, Hours, Team, Sound.

Slugs by category:
- getting-started: `getting-started-with-lumoras`, `which-product-is-right`, `plans-and-billing`
- phone-and-voice: `connect-your-phone-number`, `live-call-transfer`, `answering-hours`, `calls-and-transcripts`
- pos-and-payments: `take-card-payments`, `add-services-and-staff`
- retail-sound: `set-up-store-zones`, `schedule-announcements`
- account-and-data: `multi-location-access-and-sso`, `delete-customer-data`

## FAQ: `content/faq.json`

```json
{ "groups": [ { "id": "basics", "title": "The basics", "intro": "One sentence.",
  "items": [ { "q": "What is Lumoras?", "a": "Plain text answer, 1–4 sentences." } ] } ] }
```
Groups: basics, voice (AI receptionist), pos, sound (Retail Sound), industries,
pricing-and-setup, data-and-trust. 24–32 questions total. Answers are plain text (no Markdown).

## About: `content/about.json`

```json
{
  "hero": { "eyebrow": "About us", "title": "...", "lede": "..." },
  "story": [ { "time": "7:42 PM · Friday", "title": "...", "text": "..." } ],
  "intro": "One paragraph on the gap Lumoras closes.",
  "build": { "title": "...", "items": [ { "name": "...", "text": "...", "points": ["...", "..."] } ] },
  "products": [ { "name": "Sonorch", "url": "https://sonorch.ai", "text": "..." } ],
  "principles": { "title": "...", "items": [ { "title": "...", "text": "..." } ] },
  "closing": { "title": "...", "text": "..." }
}
```
`story` is four moments in one business day across different industries (a call answered, a
booking made, a sale rung up, a customer brought back). `principles` has six items.
