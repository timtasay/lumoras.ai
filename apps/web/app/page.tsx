import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./home.css";
import { Icon } from "@/components/Icons";
import { CallChip } from "@/components/CallChip";
import { DemoForm } from "@/components/DemoForm";
import { FieldLoader } from "@/components/home/FieldLoader";
import { VoiceConsole } from "@/components/home/VoiceConsole";
import { HelloCycle } from "@/components/home/HelloCycle";
import { Verticals } from "@/components/home/Verticals";
import { SwitchDemo } from "@/components/home/SwitchDemo";
import { RetailOrders } from "@/components/home/RetailOrders";
import { getGuide, getHelpArticle, getInsight } from "@/lib/content";
import { DEMO_LINE, DEMO_LINE_TEL, PRODUCTS } from "@/lib/site";

const HOME_TITLE = "Lumoras: AI Receptionist, Voice Agents & POS for Business";
const HOME_DESC =
  "An AI receptionist and AI voice agents for every industry, from bookings to retail order support, and a POS for any service business. Call the live demo line.";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESC,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Lumoras", locale: "en_US", title: HOME_TITLE, description: HOME_DESC },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESC },
};

/** Inline stroke icon (Voice Core line weight). */
function S({ children, w = 1.8 }: { children: ReactNode; w?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const ArrowOut = () => (
  <S w={2}>
    <path d="M7 17 17 7M8 7h9v9" />
  </S>
);

/** Links into the knowledge base, insights and help center; each renders only if its article exists. */
function Deeper({ links }: { links: { kind: "guide" | "insight" | "help"; slug: string; label: string }[] }) {
  const base = { guide: "/knowledge-base/", insight: "/insights/", help: "/help-center/" } as const;
  const found = links.filter((l) =>
    l.kind === "guide" ? getGuide(l.slug) : l.kind === "insight" ? getInsight(l.slug) : getHelpArticle(l.slug),
  );
  if (found.length === 0) return null;
  return (
    <p className="deeper">
      {found.map((l) => (
        <Link key={l.slug} href={base[l.kind] + l.slug}>
          {l.label} <Icon name="arrow" />
        </Link>
      ))}
    </p>
  );
}

/** Voice meter bars (deterministic, so the server and client agree). */
const METER = Array.from({ length: 56 }, (_, i) => {
  const env = Math.sin((i / 55) * Math.PI);
  const h = 18 + env * 70 + (Math.sin(i * 1.7) * 0.5 + 0.5) * 12;
  return { h: `${h.toFixed(1)}%`, d: `${(0.7 + ((i * 37) % 11) / 10).toFixed(2)}s`, dl: `-${(((i * 53) % 17) / 10).toFixed(2)}s` };
});

const SPECS: { icon: ReactNode; title: string; text: ReactNode }[] = [
  { icon: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" />, title: "Multi-location", text: "Every store, clinic or kitchen in one console. Roll up revenue, calls and orders by region, brand or location, then drill into a single front desk." },
  { icon: (<><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2M16 7l3 3M14 9l2 2" /></>), title: "SSO & SCIM", text: "SAML and OIDC single sign-on with your identity provider. SCIM provisions staff on their first day and removes access the moment they leave." },
  { icon: (<><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3z" /><path d="m9 12 2 2 4-4" /></>), title: "Role-based access", text: "Owners, regional managers, front desk and staff each see exactly what their role needs, scoped down to the location and the report." },
  { icon: (<><path d="M8 3h8l4 4v14H4V3h4z" /><path d="M8 11h8M8 15h8M8 7h4" /></>), title: "Audit logs", text: "Every refund, schedule change, voice-agent setting and permission edit is recorded with who, what and when. Exportable for your reviews." },
  {
    icon: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
    title: "Open API & webhooks",
    text: (
      <>
        REST API and signed webhooks for calls, bookings, orders and payments, such as <code>call.completed</code> and{" "}
        <code>booking.created</code>. Stream events to your warehouse, CRM or BI stack.
      </>
    ),
  },
  { icon: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>), title: "Card data stays with the processor", text: "Payments are tokenized by the payment processor. Lumoras never stores card numbers, including the deposits a voice agent collects over the phone." },
  { icon: (<><circle cx="9" cy="8" r="4" /><path d="M2 21c1-4 4-6 7-6s6 2 7 6M17 11l2 2 4-4" /></>), title: "Dedicated onboarding", text: "A named team maps your services, menus, policies and stores, migrates your data and stays with you through go-live at every location." },
  { icon: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>), title: "24/7 answering", text: "Voice agents pick up on the first ring around the clock, in multiple languages, and escalate to a person by your rules when it matters." },
];

const STEPS = [
  { n: "01", t: "Connect", p: "Bring your POS data, calendar, menu or service list, or start fresh on Lumoras POS.", tags: ["Services", "Menu", "Staff", "Customers"] },
  { n: "02", t: "Tune", p: "Set the voice, greeting, policies, hours and escalation rules, down to what can be canceled, changed or returned.", tags: ["Greeting", "Deposits", "Returns", "Hand-off"] },
  { n: "03", t: "Go live", p: "Forward your number. Your existing line keeps ringing, now answered, day and night.", tags: ["Call forwarding", "After hours"] },
  { n: "04", t: "Orchestrate", p: "Every call, sale and order in one console, with live analytics across every location.", tags: ["Transcripts", "Revenue", "Orders"] },
];

const RETAIL_CAPS = [
  ["Where's my order?", "Verifies the caller with an order number plus email, phone or zip, then reads back the status and delivery date in plain language."],
  ["Tracking by text", "The tracking link lands in a text or email while the shopper is still on the line, so nobody has to dig for a confirmation."],
  ["Cancellations", "Cancels inside the window you set, before an order is packed, and sends the refund back to the original payment."],
  ["Order changes", "Size, color, shipping address or shipping speed, changed while the order can still change, with a confirmation sent."],
  ["Returns and exchanges", "Checks the item against your return policy, sends the prepaid label and starts the exchange or refund."],
  ["Hands off with context", "Lost parcels, damaged items and anything outside your rules go to your team with the order and the transcript attached."],
];

export default function HomePage() {
  return (
    <div className="home">
      <FieldLoader />
      <div className="vignette" aria-hidden="true" />

      {/* ============ HERO ============ */}
      <section className="hero" id="top" data-form="0" aria-labelledby="h1">
        <div className="wrap">
          <div className="hero-head">
            <h1 className="display" id="h1">
              <span className="eyebrow h1-eyebrow">
                <span className="live-dot" aria-hidden="true" />
                AI receptionist · AI voice agents · POS
              </span>
              <span className="sr-only">: </span>
              <span className="h1-main">
                The voice of <span className="soft">every business.</span>
              </span>
            </h1>
            <div className="hero-sub">
              <p className="lede scrim">
                Lumoras orchestrates AI voice and point of sale into one system: an AI receptionist and AI voice agents purpose-built
                for every industry, from bookings to retail orders, on a POS that runs any service business.
              </p>
              <div className="cta-row">
                <Link className="btn btn-primary" href="#demo">
                  Book a demo <Icon name="arrow" />
                </Link>
                <CallChip />
              </div>
            </div>
          </div>

          <VoiceConsole />

          <div className="hero-foot">
            <span>
              Pick an industry, or call the live demo line any hour: <span className="mono sel">{DEMO_LINE}</span>
            </span>
            <span>Names, numbers and prices in this demo are illustrative.</span>
          </div>
        </div>
      </section>

      {/* ============ STRIP ============ */}
      <section className="strip" data-form="1" aria-labelledby="strip-h">
        <div className="wrap strip-in">
          <div className="strip-title">
            <h2 id="strip-h">One platform, four instruments</h2>
            <p>Played separately or as one score.</p>
          </div>
          <div className="inst">
            <S><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></S>
            <h3>Voice <span>01</span></h3>
            <p>AI receptionists that answer, book and take orders.</p>
          </div>
          <div className="inst">
            <S><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h4" /></S>
            <h3>POS <span>02</span></h3>
            <p>Appointments or tickets, payments, staff, inventory.</p>
          </div>
          <div className="inst">
            <S><path d="M4 5h16v11H9l-5 4V5z" /><path d="M8 9h8M8 12h5" /></S>
            <h3>Text <span>03</span></h3>
            <p>Confirmations, reminders and tracking links by text.</p>
          </div>
          <div className="inst">
            <S><circle cx="12" cy="12" r="3" /><circle cx="4.5" cy="6" r="1.6" /><circle cx="19.5" cy="6" r="1.6" /><circle cx="4.5" cy="18" r="1.6" /><circle cx="19.5" cy="18" r="1.6" /><path d="M6 7l3.6 3M18 7l-3.6 3M6 17l3.6-3M18 17l-3.6-3" /></S>
            <h3>Orchestrator <span>04</span></h3>
            <p>One console conducting every call, sale and order.</p>
          </div>
        </div>
      </section>

      {/* ============ PLATFORM BENTO ============ */}
      <section className="sec" id="platform" data-form="1" aria-labelledby="platform-h">
        <div className="wrap">
          <div className="sec-head scrim">
            <p className="eyebrow"><b>01</b> Platform</p>
            <h2 id="platform-h">One conductor for every sound your business makes.</h2>
            <div>
              <p className="lede">
                Phone calls, the front counter, the checkout and the orders on their way to customers. Lumoras runs them as one
                system, so every part knows what the others just did.
              </p>
              <Deeper
                links={[
                  { kind: "guide", slug: "what-is-an-ai-receptionist", label: "What is an AI receptionist?" },
                  { kind: "guide", slug: "how-voice-ai-works", label: "How voice AI works" },
                ]}
              />
            </div>
          </div>

          <div className="bento">
            <article className="card b-voice rv">
              <p className="k mono"><i />Lumoras Voice</p>
              <h3>Answers on the first ring. At 2 AM, too.</h3>
              <p className="d">
                A voice agent that knows your services, your menu, your prices and your policies. It recognizes regulars by phone
                number, checks live availability and books before the caller hangs up.
              </p>
              <dl className="vfacts">
                <div><dt>Coverage</dt><dd>24/7, every line</dd></div>
                <div><dt>Hand-off</dt><dd>Warm transfer to staff</dd></div>
                <div><dt>Follow-up</dt><dd>Win-back texts, owner-approved</dd></div>
              </dl>
              <div className="meter" aria-hidden="true">
                <div className="meter-bars">
                  {METER.map((m, i) => (
                    <i key={i} style={{ ["--h" as string]: m.h, ["--d" as string]: m.d, ["--dl" as string]: m.dl }} />
                  ))}
                </div>
                <div className="meter-read mono"><span>Inbound · Line 1</span><span><b>Speaking</b> · en-US</span><span>Live</span></div>
              </div>
            </article>

            <article className="card b-cal rv">
              <p className="k mono"><i />Live calendar</p>
              <h3>Bookings land on the real calendar.</h3>
              <div className="cal" role="img" aria-label="Calendar preview, Thursday 2:30 slot booked by the voice agent">
                {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
                  <span className="dh mono" key={d}>{d}</span>
                ))}
                <span className="c busy">Cut</span><span className="c" /><span className="c busy">Color</span><span className="c busy">Gloss</span><span className="c" />
                <span className="c" /><span className="c busy">Brows</span><span className="c busy">Cut</span><span className="c busy">Cut</span><span className="c busy">Mani</span>
                <span className="c busy">Color</span><span className="c busy">Cut</span><span className="c" /><span className="c tgt"><span className="o">Open 2:30</span><span className="b">2:30 · Maya</span></span><span className="c busy">Lash</span>
                <span className="c" /><span className="c" /><span className="c busy">Facial</span><span className="c busy">Cut</span><span className="c" />
              </div>
              <p className="cal-note"><i aria-hidden="true" />No double-booking. No callback list. Deposit captured.</p>
            </article>

            <article className="card b-lang rv">
              <p className="k mono"><i />Multilingual</p>
              <h3>Speaks your callers&apos; language.</h3>
              <HelloCycle />
            </article>

            <article className="card b-pos rv rv-2">
              <p className="k mono"><i />Lumoras POS</p>
              <h3>A POS that runs any service business.</h3>
              <ul className="posrows">
                <li><span>Chair 3 · Cut + color</span><span>$142.00</span><small>Tip split 60/40 · <span className="ok">Paid</span></small></li>
                <li><span>Table 12 · 4-top</span><span>$186.40</span><small>Split check ×2 · <span className="ok">Paid</span></small></li>
                <li><span>Bay 2 · 60k service</span><span>$389.00</span><small>Parts reserved · Open</small></li>
              </ul>
            </article>

            <article className="card b-orders rv rv-2">
              <p className="k mono"><i />Retail orders</p>
              <h3>&ldquo;Where&apos;s my order?&rdquo; Answered.</h3>
              <ol className="track-mini" role="img" aria-label="Order 20814: ordered, packed and shipped; out for delivery today">
                <li className="done"><i /><small>Ordered</small></li>
                <li className="done"><i /><small>Shipped</small></li>
                <li className="now"><i /><small>Out today</small></li>
                <li><i /><small>Delivered</small></li>
              </ol>
              <p className="cal-note"><i aria-hidden="true" />Tracking link texted while the caller is on the line.</p>
            </article>

            <article className="card b-live rv rv-2">
              <p className="k mono"><i />Orchestrator</p>
              <h3>Every location, live in one console.</h3>
              <div className="pulse" aria-hidden="true">
                <svg viewBox="0 0 300 56" fill="none" preserveAspectRatio="none">
                  <path className="base" d="M0 32 H70 l7 -18 l8 36 l8 -28 l6 10 H160 l7 -18 l8 36 l8 -28 l6 10 H300" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  <path className="run" d="M0 32 H70 l7 -18 l8 36 l8 -28 l6 10 H160 l7 -18 l8 36 l8 -28 l6 10 H300" strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={770} />
                </svg>
                <div className="pulse-row mono"><span><b>Live</b> · calls, sales, orders</span><span>All locations</span></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <div className="wrap" aria-hidden="true"><div className="rule" /></div>

      {/* ============ VERTICALS ============ */}
      <section className="sec" id="verticals" data-form="4" aria-labelledby="vert-h">
        <div className="wrap">
          <div className="sec-head scrim">
            <p className="eyebrow"><b>02</b> AI voice verticals</p>
            <h2 id="vert-h">Agents that already speak the trade.</h2>
            <p className="lede">
              A balayage versus a gloss. A 4-top at 7:30. A 60,000-mile service. Each Lumoras AI voice agent is purpose-built for its
              industry, then tuned to your business on day one.
            </p>
          </div>
          <Verticals />
        </div>
      </section>

      {/* ============ PRODUCTS ============ */}
      <section className="sec sec-flush" id="products" data-form="5" aria-labelledby="prod-h">
        <div className="wrap">
          <div className="sec-head scrim">
            <p className="eyebrow"><b>03</b> Product family</p>
            <h2 id="prod-h">Built on one core. Named for the room it serves.</h2>
            <p className="lede">
              Sonorch for salons and spas. SeasonX for restaurants. KitchenSpot for the diners looking for them. Every one runs on
              Lumoras POS and Voice.
            </p>
          </div>

          <div className="pgrid">
            <article className="prod p-son rv">
              <div className="prod-top">
                <div className="pname">
                  <span className="mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--v-salon)" }} strokeWidth="1.8" strokeLinecap="round">
                      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
                    </svg>
                  </span>
                  <div><h3>Sonorch</h3><small>sonorch.ai · salons, barbers, spas, nail, lash, med spa</small></div>
                </div>
                <span className="status live"><i aria-hidden="true" />Live</span>
              </div>
              <p className="quote"><span>Every call answered.</span> <span>Every chair filled.</span> <span>Every table sat.</span></p>
              <p className="d">
                POS and AI receptionist in one. Sonorch answers every call, books and reschedules, takes deposits and enforces no-show
                policies, rebooks regulars and checks out at the chair. Staff apps with no shared logins, commission and tip splits,
                and a waitlist that refills cancellations.
              </p>
              <ul className="feats" aria-label="Sonorch capabilities">
                <li>2 AM online booking</li><li>Two-way text reminders</li><li>Walk-in check-in kiosk</li><li>Waitlist refills cancellations</li>
                <li>Commission &amp; tip splits</li><li>Review responses</li><li>Payroll-ready reports</li>
              </ul>
              <div className="stats">
                <div><b className="num">98%+</b><span>of calls answered</span></div>
                <div><b className="num">70%</b><span>fewer missed calls</span></div>
                <div><b className="num">100%</b><span>of bookings on the live calendar</span></div>
                <div><b className="num">10+</b><span>hours returned to the owner each week</span></div>
              </div>
              <p className="attr">Results published by Sonorch at sonorch.ai.</p>
              <div className="prod-foot">
                <p className="price">
                  Free tier for cash and gift cards. POS plans from <b className="num">$99/month</b> for up to 5 staff, setup included, AI
                  receptionist with unlimited calls.
                </p>
                <a className="xlink" href={PRODUCTS.sonorch.url}>Visit sonorch.ai <ArrowOut /></a>
              </div>
            </article>

            <article className="prod p-sx rv">
              <div className="prod-top">
                <div className="pname">
                  <span className="mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--v-restaurant)" }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2 1.5-3 4.5-3 8h3" />
                    </svg>
                  </span>
                  <div><h3>SeasonX</h3><small>seasonx.ai · restaurants</small></div>
                </div>
                <span className="status live"><i aria-hidden="true" />Live</span>
              </div>
              <p className="d">
                <b>The dinner rush answers its own phone.</b> AI receptionist and point of sale for restaurants. Takes reservations and
                phone orders with party size, allergies and notes like birthdays, and only offers times you can seat.
              </p>
              <ul className="feats" aria-label="SeasonX capabilities"><li>Live floor view</li><li>Kitchen display</li><li>Split checks</li><li>Offline mode</li></ul>
              <div className="kt" role="img" aria-label="Example kitchen ticket: table 12, two short rib medium, charred broccolini with no peanuts, pappardelle">
                <div className="h"><span>Kitchen · Table 12</span><span>Course 2 · 08:42</span></div>
                <span>2× Short rib, medium</span>
                <span>1× Charred broccolini</span>
                <span className="mod">no peanuts</span>
                <span>1× Pappardelle</span>
              </div>
              <div className="prod-foot">
                <p className="price">Tickets turn red at ten minutes.</p>
                <span className="plinks">
                  <a className="xlink" href={PRODUCTS.seasonx.url}>Visit seasonx.ai <ArrowOut /></a>
                </span>
              </div>
            </article>

            <article className="prod p-ks rv">
              <div className="prod-top">
                <div className="pname">
                  <span className="mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--v-dental)" }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
                    </svg>
                  </span>
                  <div><h3>KitchenSpot</h3><small>kitchenspot.ai · diner discovery</small></div>
                </div>
                <span className="status live"><i aria-hidden="true" />Florida</span>
              </div>
              <p className="d">
                Every restaurant in town, its full menu, dish-by-dish ratings and reviews from verified diners, and pickup ordering in
                a few taps.
              </p>
              <ul className="cities" aria-label="Launch cities"><li>Sarasota</li><li>Tampa</li><li>Orlando</li><li>Miami</li></ul>
              <p className="flow" aria-label="KitchenSpot order flows into SeasonX and the kitchen">
                <span>KitchenSpot order</span>
                <S w={2}><path d="M5 12h14M13 6l6 6-6 6" /></S>
                <span>SeasonX ticket</span>
                <S w={2}><path d="M5 12h14M13 6l6 6-6 6" /></S>
                <span>Kitchen display</span>
              </p>
              <div className="prod-foot">
                <p className="price">Connects to SeasonX.</p>
                <a className="xlink" href={PRODUCTS.kitchenspot.url}>Visit kitchenspot.ai <ArrowOut /></a>
              </div>
            </article>

            <div className="plat rv rv-2">
              <div>
                <h3><S><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h4" /></S>Lumoras POS</h3>
                <p>The same core, configured for clinics, dental, auto, home services, fitness, pet grooming, tutoring and repair. Appointments or tickets, payments, staff, inventory, multi-location.</p>
              </div>
              <div>
                <h3><S><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></S>Lumoras Voice</h3>
                <p>The AI receptionist that plugs into Lumoras POS or the system you already run. Same customers, same calendar, same menu.</p>
              </div>
              <div>
                <h3><S><path d="M6 7h12l1 14H5L6 7z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></S>Lumoras Voice for retail</h3>
                <p>Order support for retail and e-commerce: order status, tracking, cancellations, changes, returns and exchanges, answered by phone.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap" aria-hidden="true"><div className="rule" /></div>

      {/* ============ POS + VOICE SWITCH ============ */}
      <section className="sec" id="switch" data-form="2" aria-labelledby="sw-h">
        <SwitchDemo
          deeper={
            <Deeper
              links={[
                { kind: "help", slug: "which-product-is-right", label: "Which product is right for you?" },
                { kind: "insight", slug: "ai-receptionist-cost", label: "What an AI receptionist costs" },
              ]}
            />
          }
        />
      </section>

      {/* ============ RETAIL ORDERS ============ */}
      <section className="sec sec-flush" id="retail" data-form="3" aria-labelledby="retail-h">
        <div className="wrap">
          <div className="sec-head scrim">
            <p className="eyebrow"><b>05</b> Lumoras Voice · Retail</p>
            <h2 id="retail-h">Every order question, answered on the first ring.</h2>
            <div>
              <p className="lede">
                Where is it? Can I cancel? Can I get a large instead? Shoppers call about orders they already placed. The voice agent
                verifies the caller, checks the order and shipping status in your systems and handles the request by your rules, at
                any hour.
              </p>
              <Deeper
                links={[
                  { kind: "guide", slug: "where-is-my-order-calls", label: "Handling “Where is my order?” calls" },
                  { kind: "insight", slug: "returns-and-exchanges-by-phone", label: "Returns and exchanges by phone" },
                ]}
              />
            </div>
          </div>

          <RetailOrders />

          <ul className="retail-caps scrim">
            {RETAIL_CAPS.map(([h, p]) => (
              <li key={h}>
                <h3>{h}</h3>
                <p>{p}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="wrap" aria-hidden="true"><div className="rule" /></div>

      {/* ============ ENTERPRISE ============ */}
      <section className="sec" id="enterprise" data-form="6" aria-labelledby="ent-h">
        <div className="wrap ent">
          <div className="ent-l scrim">
            <p className="eyebrow"><b>06</b> Enterprise</p>
            <h2 id="ent-h">From the first location to the five-hundredth.</h2>
            <p className="lede">
              Lumoras is built for operators who run many front desks at once: brand standards everywhere, local control where it
              belongs, and the controls your security team will ask about first.
            </p>
            <div className="cta-row">
              <Link className="btn btn-primary" href="#demo">
                Talk to sales <Icon name="arrow" />
              </Link>
            </div>
            <Deeper links={[{ kind: "guide", slug: "ai-call-center", label: "How an AI call center works" }]} />
          </div>
          <dl className="specs scrim">
            {SPECS.map((s) => (
              <div className="spec rv" key={s.title}>
                <dt><S>{s.icon}</S>{s.title}</dt>
                <dd>{s.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="sec sec-flush" id="how" data-form="7" aria-labelledby="how-h">
        <div className="wrap">
          <div className="sec-head scrim">
            <p className="eyebrow"><b>07</b> How it works</p>
            <h2 id="how-h">Live in four movements.</h2>
            <p className="lede">
              Most single-location businesses go live in days. Multi-location rollouts follow a plan your onboarding team builds with
              you.
            </p>
          </div>
          <ol className="steps scrim">
            {STEPS.map((s) => (
              <li className="step rv" key={s.n}>
                <span className="n" aria-hidden="true">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
                <ul>
                  {s.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ============ CLOSING CTA ============ */}
      <section className="close" id="demo" data-form="8" aria-labelledby="demo-h">
        <div className="wrap">
          <div className="close-card rv">
            <div className="close-l">
              <p className="eyebrow"><b>08</b> Book a demo</p>
              <h2 id="demo-h">Give your business one voice.</h2>
              <p className="lede">
                See Lumoras run your calls, your counter and your stores as one system. We&apos;ll tailor the demo to your industry and
                your locations.
              </p>
              <div className="bignum">
                <span>Or hear it now · live demo line, any hour</span>
                <span className="num sel">{DEMO_LINE}</span>
                <a href={DEMO_LINE_TEL}>Call</a>
              </div>
            </div>
            <DemoForm
              headingLevel="h3"
              title="Request a demo"
              sub="A specialist replies within one business day."
              cta="Book my demo"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
