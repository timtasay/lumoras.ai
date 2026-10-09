/**
 * Development seed: two demo workspaces with a member in every role, sites,
 * brand profiles and (clearly marked) demo authors. Idempotent: run it as
 * often as you like. Writes go through the same audited, row-level-security
 * path as the app (actor "system:seed").
 *
 * Lumoras: sonorch.ai, seasonx.ai and lumoras.ai, with facts taken only from
 * prototypes/BRIEF.md and docs/content-spec.md (no invented numbers, no
 * competitor guesses). Northwind Dental: fictional, on a reserved .example
 * domain, so a crawl of it simply finds nothing.
 *
 * Every demo author has is_demo = true and says so: bylines must be real people.
 */
import type pg from "pg";
import { withWorkspace, type Actor } from "./db/tenant.ts";
import { createSite, createAuthor } from "./data/sites.ts";
import { createConnection } from "./data/connections.ts";
import { advanceOnboarding } from "./data/workspaces.ts";
import type { Keyring } from "./crypto/secrets.ts";
import type { BrandInput, SiteInput } from "./validation.ts";
import { DEFAULT_SEO_RULES } from "./validation.ts";
import { addSeeds, saveKeywords, setBudget, setKeywordCluster, setKeywordStatus } from "./data/research.ts";
import { meteredCall } from "./metering/metered.ts";
import { FakeProvider } from "./providers/fake.ts";
import { marketFor } from "./research/market.ts";
import { runResearch } from "./research/service.ts";

const SEED: Actor = { actorId: "system:seed" };
const HYPE = ["revolutionary", "seamless", "cutting-edge", "game-changer"];

type SeedUser = { email: string; name: string; admin?: boolean };
type SeedSite = { input: Omit<SiteInput, "researchMaxAgeDays">; brand: Partial<BrandInput>; authors: { name: string; role: string; bio: string }[]; routes?: string[]; seeds?: string[] };
type SeedWorkspace = {
  name: string;
  slug: string;
  members: { email: string; role: "owner" | "editor" | "viewer" }[];
  sites: SeedSite[];
  webhook?: boolean;
  /** Monthly budgets in micro-USD (seo, llm) and posts (social): [ceiling, reserve]. */
  budgets: { seo_credits: [number, number]; llm_tokens: [number, number]; social_posts: [number, number] };
};

export const SEED_USERS: SeedUser[] = [
  { email: "staff@lumoras.example", name: "Lumoras staff (demo)", admin: true },
  { email: "owner@lumoras.example", name: "Demo owner, Lumoras" },
  { email: "editor@lumoras.example", name: "Demo editor, Lumoras" },
  { email: "viewer@lumoras.example", name: "Demo viewer, Lumoras" },
  { email: "owner@northwind-dental.example", name: "Demo owner, Northwind" },
  { email: "editor@northwind-dental.example", name: "Demo editor, Northwind" },
  { email: "viewer@northwind-dental.example", name: "Demo client reviewer, Northwind" },
];

const DEMO_AUTHOR = (site: string) => ({
  name: `Demo author for ${site}`,
  role: "Placeholder: replace with a real person",
  bio: "Seed data. Bylines are published as Person structured data, so this must be replaced with a real person, their real role and a bio they confirmed before anything is written.",
});

const LUMORAS_ROUTES = ["/", "/about", "/insights", "/knowledge-base", "/help-center", "/faq", "/demo",
  "/insights/ai-receptionist-vs-answering-service", "/insights/ai-receptionist-cost", "/insights/appointment-reminder-texts", "/insights/no-show-policy",
  "/insights/order-cancellations-and-changes-by-phone", "/insights/returns-and-exchanges-by-phone",
  "/knowledge-base/what-is-an-ai-receptionist", "/knowledge-base/how-voice-ai-works", "/knowledge-base/ai-call-center",
  "/knowledge-base/call-forwarding-for-business", "/knowledge-base/missed-calls", "/knowledge-base/where-is-my-order-calls"];

export const SEED_WORKSPACES: SeedWorkspace[] = [
  {
    name: "Lumoras",
    slug: "lumoras",
    budgets: { seo_credits: [25_000_000, 5_000_000], llm_tokens: [50_000_000, 5_000_000], social_posts: [60, 0] },
    members: [
      { email: "owner@lumoras.example", role: "owner" },
      { email: "editor@lumoras.example", role: "editor" },
      { email: "viewer@lumoras.example", role: "viewer" },
    ],
    sites: [
      {
        input: { domain: "sonorch.ai", name: "Sonorch", industry: "Salons and spas", locale: "en-US", country: "US", serpLocation: "United States", timezone: "America/New_York" },
        brand: {
          overview: "Sonorch is a point of sale and AI receptionist for salons, barbers, spas, nail and lash studios and med spas. It answers every call, books and reschedules appointments, handles deposits and no-show policies, rebooks regulars and checks out at the chair.",
          positioning: "Every call answered. Every chair filled. Every table sat.",
          audience: "Owners and managers of salons, barbershops, spas, nail and lash studios and med spas.",
          currentGoal: "Keep the Insights section publishing: its pre-written queue ran dry on 7 October 2026.",
          sells: ["AI receptionist that answers 24/7, on the first ring", "Salon point of sale with checkout at the chair", "Online booking, staff schedules and two-way text reminders", "Walk-in check-in kiosk and a waitlist that refills cancellations", "Commission and tip splits, payroll-ready reports"],
          doesNotSell: ["Home services (HVAC, plumbing, electrical)", "Dental and medical clinics", "Restaurant software (that is SeasonX)"],
          productFacts: ["Free tier for cash and gift cards", "POS plans from $99/month for up to 5 staff, month to month, setup included", "AI receptionist included with unlimited calls", "Sonorch's own published results: 98%+ of calls answered, 70% fewer missed calls, 100% of bookings land on the live calendar, 10+ hours returned to the owner each week (attribute to Sonorch)"],
          forbiddenClaims: ["Any statistic Sonorch has not published", "Fake customer names or testimonials"],
          voiceRules: ["Confident, direct, short fragments", "Second person", "No emoji", "No em-dash asides"],
          bannedWords: HYPE,
          keyPages: [{ url: "https://sonorch.ai/", title: "Sonorch", description: "POS and AI receptionist for salons." }],
        },
        authors: [DEMO_AUTHOR("sonorch.ai")],
        seeds: ["salon pos", "no show policy", "esthetician salary", "salon booking software", "ai receptionist for salons", "salon deposit policy"],
      },
      {
        input: { domain: "seasonx.ai", name: "SeasonX", industry: "Restaurants", locale: "en-US", country: "US", serpLocation: "United States", timezone: "America/New_York" },
        brand: {
          overview: "SeasonX is an AI receptionist and point of sale for restaurants: full-service dining, quick service, cafés, bars and taprooms, takeout kitchens, pizzerias and family restaurants.",
          positioning: "The dinner rush answers its own phone.",
          audience: "Restaurant owners and general managers.",
          sells: ["AI receptionist for reservations and phone orders", "Restaurant POS with a live floor view", "Kitchen display on an existing tablet or screen", "Split checks, on-screen tips and card payments on a Zettle reader", "Offline mode for orders and cash"],
          doesNotSell: ["Salon software (that is Sonorch)", "Home services", "Dental and medical clinics"],
          productFacts: ["Takes reservations and phone orders, capturing party size, time, allergies and notes", "Only offers times the restaurant can seat", "Kitchen tickets turn red at ten minutes", "SeasonX is a product of Lumoras LLC"],
          forbiddenClaims: ["Any number attributed to SeasonX: it has no published stats and no pricing figures"],
          voiceRules: ["Plain and direct", "Second person", "No emoji"],
          bannedWords: HYPE,
          keyPages: [
            { url: "https://seasonx.ai/demo", title: "Book a walkthrough", description: "" },
            { url: "https://seasonx.ai/get-started", title: "Get started", description: "" },
          ],
        },
        authors: [DEMO_AUTHOR("seasonx.ai")],
        seeds: ["restaurant reservation system", "restaurant phone ordering", "restaurant waitlist app"],
      },
      {
        input: { domain: "lumoras.ai", name: "Lumoras", industry: "Software", locale: "en-US", country: "US", serpLocation: "United States", timezone: "America/New_York" },
        brand: {
          overview: "Lumoras LLC builds AI voice verticals and a point of sale that works for any service business, with voice that can be switched on at any time.",
          positioning: "Start with the POS. Add voice whenever you are ready.",
          audience: "Service businesses: salons, restaurants, clinics, trades and retail.",
          sells: ["Lumoras POS for any service business", "Lumoras Voice, an AI receptionist that plugs into the POS", "Sonorch (salons), SeasonX (restaurants), KitchenSpot (restaurant discovery)"],
          doesNotSell: ["In-store audio (retail is a voice vertical only)"],
          productFacts: ["Company legal name: Lumoras LLC"],
          forbiddenClaims: ["Email addresses, phone numbers, office addresses, founding dates, team names or customer names", "Statistics we cannot source"],
          voiceRules: ["Plain, direct, specific, second person, short sentences", "Show the arithmetic rather than asserting numbers", "No em-dash asides", "No \"not X, but Y\" framing", "No emoji", "Start with a 2 to 3 sentence direct answer, then ## sections; never # in the body"],
          bannedWords: HYPE,
          keyPages: [
            { url: "https://lumoras.ai/about", title: "About Lumoras", description: "" },
            { url: "https://lumoras.ai/insights", title: "Insights", description: "" },
            { url: "https://lumoras.ai/demo", title: "Book a demo", description: "" },
          ],
        },
        authors: [DEMO_AUTHOR("lumoras.ai")],
        routes: LUMORAS_ROUTES,
        seeds: ["ai receptionist", "missed calls", "call forwarding for business"],
      },
    ],
  },
  {
    name: "Northwind Dental (demo)",
    slug: "northwind-dental",
    webhook: true,
    budgets: { seo_credits: [10_000_000, 2_000_000], llm_tokens: [20_000_000, 2_000_000], social_posts: [30, 0] },
    members: [
      { email: "owner@northwind-dental.example", role: "owner" },
      { email: "editor@northwind-dental.example", role: "editor" },
      { email: "viewer@northwind-dental.example", role: "viewer" },
    ],
    sites: [
      {
        input: { domain: "northwind-dental.example", name: "Northwind Dental", industry: "Dental and medical", locale: "en-US", country: "US", serpLocation: "Seattle, Washington, United States", timezone: "America/Los_Angeles" },
        brand: {
          overview: "A fictional family and cosmetic dental practice used as demo data.",
          positioning: "Gentle dentistry for the whole family (demo).",
          audience: "Families in the practice's city (demo).",
          sells: ["Cleanings and check-ups", "Fillings and crowns", "Invisalign"],
          doesNotSell: ["Medical advice beyond dentistry", "Cosmetic surgery"],
          forbiddenClaims: ["Guaranteed outcomes", "\"Painless\" claims"],
          voiceRules: ["Warm and plain", "No medical jargon without a short explanation"],
          bannedWords: HYPE,
        },
        authors: [
          { name: "Dr. Alex Example (demo)", role: "Placeholder dentist", bio: "Fictional demo person. Replace with a real clinician before publishing." },
          { name: "Sam Example (demo)", role: "Placeholder hygienist", bio: "Fictional demo person." },
        ],
        seeds: ["dental implants", "teeth whitening cost"],
      },
    ],
  },
];

export type SeedResult = { users: Record<string, string>; workspaces: Record<string, { id: string; sites: Record<string, string> }> };

export async function seed(db: pg.Pool, opts: { keyring?: Keyring | null; research?: boolean } = {}): Promise<SeedResult> {
  const users: Record<string, string> = {};
  // auth tables are not tenant tables; the audit trigger records them with the seed as actor
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id', 'system:seed', true), set_config('app.action', 'seed.users', true)");
    for (const u of SEED_USERS) users[u.email] = await upsertUserTx(c, u);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }

  const out: SeedResult = { users, workspaces: {} };
  for (const w of SEED_WORKSPACES) {
    const wc = await db.connect();
    let wsId: string;
    try {
      await wc.query("BEGIN");
      await wc.query("SELECT set_config('app.actor_id', 'system:seed', true), set_config('app.action', 'seed.workspace', true)");
      const existing = await wc.query<{ id: string }>("SELECT id FROM auth_organization WHERE slug = $1", [w.slug]);
      wsId = existing.rows[0]?.id ?? (await wc.query<{ id: string }>("INSERT INTO auth_organization (name, slug) VALUES ($1, $2) RETURNING id", [w.name, w.slug])).rows[0].id;
      for (const m of w.members) {
        await wc.query("INSERT INTO auth_member (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO NOTHING", [wsId, users[m.email], m.role]);
      }
      await wc.query("COMMIT");
    } catch (e) {
      await wc.query("ROLLBACK");
      throw e;
    } finally {
      wc.release();
    }
    const sites: Record<string, string> = {};
    await withWorkspace(db, { ...SEED, workspaceId: wsId }, async (tx) => {
      await tx.action("seed.sites");
      for (const s of w.sites) {
        let siteId = (await tx.maybe<{ id: string }>("SELECT id FROM sites WHERE domain = $1", [s.input.domain]))?.id;
        if (!siteId) siteId = (await createSite(tx, wsId, s.input)).id;
        sites[s.input.domain] = siteId;
        const b = { ...s.brand };
        await tx.exec(
          `UPDATE brand_profiles SET overview = $2, positioning = $3, audience = $4, current_goal = $5, sells = $6, does_not_sell = $7,
             product_facts = $8, forbidden_claims = $9, voice_rules = $10, banned_words = $11, key_pages = $12::jsonb, seo_rules = $13::jsonb
           WHERE site_id = $1`,
          [siteId, b.overview ?? "", b.positioning ?? "", b.audience ?? "", b.currentGoal ?? "", b.sells ?? [], b.doesNotSell ?? [], b.productFacts ?? [],
            b.forbiddenClaims ?? [], b.voiceRules ?? [], b.bannedWords ?? [], JSON.stringify(b.keyPages ?? []), JSON.stringify(DEFAULT_SEO_RULES)],
        );
        for (const a of s.authors) {
          if (!(await tx.maybe("SELECT 1 FROM authors WHERE site_id = $1 AND name = $2", [siteId, a.name]))) {
            const created = await createAuthor(tx, wsId, siteId, { ...a, avatarUrl: null });
            await tx.exec("UPDATE authors SET is_demo = true WHERE id = $1", [created.id]);
          }
        }
        if (s.routes?.length) {
          await tx.exec(
            `INSERT INTO site_routes (workspace_id, site_id, url, path, source)
             SELECT $1, $2, 'https://' || $3 || p, p, 'seed: docs/content-spec.md' FROM unnest($4::text[]) AS p
             ON CONFLICT (site_id, url) DO NOTHING`,
            [wsId, siteId, s.input.domain, s.routes],
          );
        }
        if (s.seeds?.length) await addSeeds(tx, wsId, siteId, s.seeds, 0, SEED.actorId);
        if (w.webhook && opts.keyring && !(await tx.maybe("SELECT 1 FROM connections WHERE site_id = $1", [siteId]))) {
          await createConnection(tx, opts.keyring, wsId, siteId, { kind: "webhook", label: "Demo webhook", endpoint: `https://${s.input.domain}/hooks/lumoras`, secret: "demo-signing-secret-not-real" });
        }
      }
      await advanceOnboarding(tx, "done", sites[w.sites[0].input.domain]);
      for (const [category, [ceiling, reserve]] of Object.entries(w.budgets)) {
        if (!(await tx.maybe("SELECT 1 FROM budgets WHERE category = $1", [category]))) await setBudget(tx, wsId, category as "seo_credits", ceiling, reserve);
      }
    });
    out.workspaces[w.slug] = { id: wsId, sites };
    if (opts.research !== false && w.slug === "lumoras") await seedResearch(db, wsId, sites["sonorch.ai"], w.sites[0]);
  }
  return out;
}

/**
 * Demo research for sonorch.ai, bought through the real metered path from the
 * FakeProvider (synthetic fixtures, no network, no real money): a few seeds,
 * a SERP and its free repeat (a cache hit), the domain overview, and some
 * saved keywords in each status. Skipped when the site already has research.
 */
async function seedResearch(db: pg.Pool, workspaceId: string, siteId: string, site: SeedSite): Promise<void> {
  const ctx = { ...SEED, workspaceId, siteId };
  const already = await withWorkspace(db, ctx, (tx) => tx.maybe("SELECT 1 FROM research_log WHERE site_id = $1 LIMIT 1", [siteId]), { readOnly: true });
  if (already) return;
  const deps = { db, provider: new FakeProvider() };
  const market = marketFor({ country: site.input.country, locale: site.input.locale, serp_location: site.input.serpLocation });
  const s = { id: siteId, domain: site.input.domain, research_max_age_days: 90 };
  const brand = { sells: site.brand.sells ?? [], does_not_sell: site.brand.doesNotSell ?? [] };
  const pos = await runResearch(deps, ctx, s, brand, market, { kind: "ideas", seed: "salon pos" });
  const policy = await runResearch(deps, ctx, s, brand, market, { kind: "ideas", seed: "no show policy" });
  const salary = await runResearch(deps, ctx, s, brand, market, { kind: "ideas", seed: "esthetician salary" });
  await runResearch(deps, ctx, s, brand, market, { kind: "serp", keyword: "salon no show policy" });
  await runResearch(deps, ctx, s, brand, market, { kind: "serp", keyword: "salon no show policy" }); // the repeat: a free cache hit
  await meteredCall(deps, ctx, { op: "domainOverview", params: { domain: site.input.domain, market } });
  await withWorkspace(db, ctx, async (tx) => {
    await tx.action("seed.keywords");
    const now = new Date();
    for (const [r, cluster] of [[pos, "Point of sale"], [policy, "Policies"], [salary, "Careers"]] as const) {
      if (r.kind !== "ideas") continue;
      const rows = r.rows.filter((x) => x.target && x.fit !== "not_offered").slice(0, 4);
      await saveKeywords(tx, workspaceId, siteId, rows.map((x) => ({ ...x, market: market.label, fit: x.fit, variantKey: x.variantKey, cluster, sourceLogId: r.logId, metricsAt: now })));
    }
    const ids = async (kw: string[]) => (await tx.many<{ id: string }>("SELECT id FROM keywords WHERE site_id = $1 AND keyword = ANY($2)", [siteId, kw])).map((x) => x.id);
    await setKeywordStatus(tx, siteId, await ids(["salon pos", "salon cancellation policy"]), "targeted");
    await setKeywordStatus(tx, siteId, await ids(["no show policy"]), "published");
    await setKeywordStatus(tx, siteId, await ids(["salon no show policy"]), "ranking");
    await setKeywordCluster(tx, siteId, await ids(["esthetician salary"]), "Careers");
  });
}

async function upsertUserTx(c: pg.PoolClient, u: SeedUser): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO auth_user (name, email, email_verified, role) VALUES ($1, $2, true, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role RETURNING id`,
    [u.name, u.email, u.admin ? "admin" : "user"],
  );
  return r.rows[0].id;
}

