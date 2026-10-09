# Lumoras.ai website: prototype brief

Three distinct design directions for the lumoras.ai enterprise homepage. Same story and copy
backbone, three different visual worlds. Each is a single self-contained HTML file.

## Who Lumoras is

Lumoras builds **sound orchestration for business**: AI voice, point of sale and in-store audio
working as one system. Lumoras runs a family of AI voice verticals and a POS that works for any
service business, with voice that can be switched on at any time.

### Product family (real, use these names and domains)

| Product | Domain | What it is |
| --- | --- | --- |
| **Sonorch** | sonorch.ai | POS + AI receptionist for salons, barbers, spas, nail and lash studios, med spas. Answers every call, books and reschedules appointments, handles deposits and no-show policies, rebooks regulars, checks out at the chair. |
| **SeasonX** | seasonx.ai (coming soon) | POS + AI receptionist for restaurants. Not online yet: today the restaurant product lives on sonorch.ai next to salons and is moving to seasonx.ai. Label it "Coming soon to seasonx.ai" and link restaurant CTAs to sonorch.ai for now. Takes phone orders and reservations, answers menu, allergen and hours questions, pushes tickets to the kitchen, takes payment. |
| **KitchenSpot** | kitchenspot.ai | Restaurant discovery: every restaurant in town, its full menu, dish-by-dish ratings and reviews from verified diners, pickup ordering. Launch cities: Sarasota, Tampa, Orlando, Miami (Florida). Connects to SeasonX. |
| **Lumoras POS** | (platform) | The same POS core, configured for any service business: clinics, dental, auto service, home services, fitness, pet grooming, tutoring, repair shops. Appointments or tickets, payments, staff, inventory, multi-location. |
| **Lumoras Voice** | (platform) | AI receptionist / voice agent that plugs into Lumoras POS (or another system). Turn it on anytime: day one, or a year later. Same customers, same calendar, same menu. |
| **Lumoras Sound** | (platform) | Custom sound orchestration for retail stores: zoned in-store music, dayparted playlists that follow traffic and time of day, branded audio identity, automated announcements (store closing, curbside ready, promos), voice paging, synchronized across locations from one console. |

### What sonorch.ai says today (source of truth for salon + restaurant copy)

- Headline: "Every call answered. Every chair filled. Every table sat."
- Answers your phone 24/7, picks up on the first ring, recognizes regulars by phone number,
  checks live availability and books before the caller hangs up, takes reservations while staff
  run the floor, follows up with callers who didn't book (AI CRM drafts win-back texts; the
  owner approves before sending).
- Salon: 2 AM online booking, staff schedules, two-way text reminders, walk-in check-in kiosk,
  waitlist that refills cancellations, staff apps with no shared logins, commission and tip
  splits, review responses, social posting.
- Restaurant: AI reservations, tables, live kitchen tickets with table, course and modifiers
  ("no peanuts"), split checks, takeout.
- Reporting: revenue, utilization, no-shows, top sellers by day/week/month/staff; payroll-ready
  commission and tip reports.
- Pricing: free tier (cash and gift cards); POS plans from $99/month for up to 5 staff, month
  to month, setup included, AI receptionist with unlimited calls.
- Sonorch's own published results, usable when attributed to Sonorch: 98%+ of calls answered,
  70% fewer missed calls, 100% of bookings land on the live calendar, 10+ hours returned to the
  owner each week.
- Live demo line: 941-430-4049 ("Call the live demo"). Show as selectable text, not only a
  tel: link.
- Tone: confident, direct, short fragments, second person ("You didn't open a business to run
  software.").

### Key messages

1. **One conductor for every sound your business makes.** Phone calls, the front counter, the
   checkout, the music on the floor and the announcements overhead, orchestrated as one system.
2. **AI voice verticals for every industry.** Purpose-built voice agents that already know the
   vocabulary of the trade (a balayage vs. a gloss, a 4-top at 7:30, a 60k-mile service).
3. **Start with the POS. Add voice whenever you're ready.** Voice is a switch, not a migration.
4. **Custom sound orchestration for retail.** Every zone, every daypart, every location.
5. **Enterprise-ready.** Multi-location rollups, SSO and SCIM, role-based access, audit logs,
   open API and webhooks, card data handled by the payment processor (Lumoras never stores
   card numbers), dedicated onboarding.

### Verticals to show (pick 10–14)

Salons & spas (Sonorch) · Restaurants (SeasonX) · Retail stores (Lumoras Sound) · Medical &
dental clinics · Med spas · Auto service · Home services (HVAC, plumbing, electrical) ·
Fitness & wellness studios · Hotels & hospitality · Veterinary & pet grooming · Professional
services (legal, accounting) · Property management · Education & tutoring · Repair shops.

For each vertical, a realistic one-line example of what the voice agent does, e.g.
- Salon: "Books a 90-minute balayage with Maya on Thursday and takes the $25 deposit."
- Restaurant: "Takes a pickup order for two birria tacos and an horchata, ready at 6:40."
- Auto: "Quotes the 60,000-mile service and holds the 8:00 drop-off bay."
- Dental: "Moves a cleaning to next Tuesday and sends the new-patient forms."
- Home services: "Triages a no-heat call, books the after-hours tech, texts the ETA."
- Retail: "Plays the 4 pm energy set in Zone A and announces curbside pickup at the door."

### How it works (a real sequence, numbering is fine)

1. **Connect**: bring your POS data, calendar, menu or service list (or start on Lumoras POS).
2. **Tune**: voice, greeting, policies, hours, escalation rules, store soundscapes.
3. **Go live**: forward your number, pair your store speakers.
4. **Orchestrate**: every call, sale and sound in one console with live analytics.

### Figures

These are prototypes. Any metric must read as illustrative and the footer must say
"Prototype · figures are illustrative". Prefer capability facts over invented stats
(24/7 answering, answers on the first ring, multilingual, every location in one console).
No fake customer logos, no fake testimonials with real-sounding names.

### Nav

Platform · Verticals · Products · Retail Sound · Enterprise · Company. Right side:
"Sign in" and a primary "Book a demo" / "Talk to sales".

## Technical contract (all three files)

- One self-contained `.html` file, full document with `<!doctype html>`, `<meta charset>`,
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  and a `<title>`.
- Fonts from Google Fonts only (`fonts.googleapis.com`), with real fallback stacks.
- No external images, no external scripts unless truly needed (then cdnjs, exact version).
  All visuals are CSS, inline SVG, or `<canvas>`.
- All colors as tokens in `:root`. Dark-only pages set `color-scheme: dark` on `:root` and an
  explicit `body` background.
- Works at 400px wide: 16px+ side gutter, no horizontal page scroll, grids collapse.
- Complete at rest: nothing meant to be read starts at `opacity: 0` waiting for a scroll
  observer. Scroll-linked effects use CSS `animation-timeline: view()` inside `@supports`, or JS
  that only enhances already-visible content.
- `prefers-reduced-motion: reduce` turns off continuous and scroll-driven motion.
- Visible keyboard focus. Buttons are `<button>`, links are `<a>`.
- Forms: handle submit in JS with `preventDefault()` and show an inline confirmation.
- No `alert()`, no `window.open`, no `mailto:` reliance.
- A small fixed "direction switcher" chip (bottom-left) linking to the other two prototypes
  (`a-voice-core.html`, `b-score.html`, `c-spectrum.html`) and to `index.html`.

## Theme selection (all pages)

Every page offers **Light · Dark · Auto**, with the same behavior everywhere:

- **Control**: a three-option segmented control in the nav's right side, before "Sign in",
  visible at every width (compact icon-only on mobile). Markup: a container with
  `role="radiogroup" aria-label="Color theme"` and three `<button type="button" role="radio"
  aria-checked>` items: Light (sun icon), Dark (moon icon), Auto (half-filled circle icon). Each
  has a visually hidden text label and a `title`. Arrow keys move between options. The active
  option has a sliding indicator pill that morphs to the chosen slot.
- **State**: Auto removes `data-theme` from `<html>` and follows `prefers-color-scheme`
  (live, including OS changes while the page is open). Light/Dark set
  `data-theme="light"` / `"dark"`. The choice is saved in `localStorage` under
  `lumoras-theme` (`light` | `dark` | `auto`), shared across all prototypes, read and written
  inside try/catch. A tiny inline script in `<head>` applies the saved choice before first paint.
  Default when nothing is saved: Auto.
- **Tokens**: every color is a token. Light-first pages define light on bare `:root`; dark-first
  pages define dark on bare `:root` with `color-scheme: dark`, then light values under
  `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {…; color-scheme: light} }`
  and again under `:root[data-theme="light"]`. Both themes are designed, not inverted.
- **Switch animation**: when supported and motion is allowed, use the View Transitions API for a
  circular reveal that grows from the clicked button (`clip-path: circle()` on
  `::view-transition-new(root)`, about 600 ms, cubic-bezier(.2,.7,.1,1)). Otherwise switch
  instantly.
- **Canvas visuals** read their colors from CSS tokens and redraw on change. Each page dispatches
  `document` event `lumoras:themechange` with `{ detail: { mode, resolved } }` whenever the
  resolved theme changes (button or OS).
