import type { Metadata } from "next";
import Link from "next/link";
import "./home.css";
import { Icon } from "@/components/Icons";
import { CallChip } from "@/components/CallChip";
import { DemoForm } from "@/components/DemoForm";
import { FieldLoader } from "@/components/home/FieldLoader";
import { ChapterRail } from "@/components/home/ChapterRail";
import { VoiceSwitch } from "@/components/home/VoiceSwitch";
import { DaypartPreview } from "@/components/home/DaypartPreview";
import { Verticals } from "@/components/home/Verticals";
import { getGuide } from "@/lib/content";
import { PRODUCTS } from "@/lib/site";

const HOME_TITLE = "Lumoras: AI Receptionist, Voice Agents & POS for Business";
const HOME_DESC =
  "An AI receptionist and AI voice agents for every industry, a POS for any service business, and in-store sound for retail. Call the live demo line.";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESC,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Lumoras", locale: "en_US", title: HOME_TITLE, description: HOME_DESC },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESC },
};

const TICKER = [
  ["06:42 PM", "Sonorch", "booked balayage with Maya · Thu 10:00"],
  ["06:43 PM", "SeasonX", "pickup order · 2 birria tacos, horchata · ready 7:05"],
  ["06:44 PM", "Lumoras Sound", "Zone A to evening set · Store 12"],
  ["06:45 PM", "Lumoras Voice", "no-heat call triaged · tech ETA 7:30 PM"],
  ["06:46 PM", "Lumoras POS", "checkout · tip split across 2 staff"],
  ["06:47 PM", "Sonorch", "waitlist filled a Fri 3:15 cancellation"],
  ["06:48 PM", "Lumoras Voice", "cleaning moved to Tue 9:00 · forms sent"],
  ["06:49 PM", "Lumoras Sound", "curbside announcement · Door 2"],
  ["06:50 PM", "Lumoras Voice", "warm transfer to front desk · Spanish"],
];

function GuideLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  if (!getGuide(slug)) return null;
  return (
    <Link className="deeper" href={`/knowledge-base/${slug}`}>
      {children} <Icon name="arrow" />
    </Link>
  );
}

export default function HomePage() {
  return (
    <div className="home">
      <FieldLoader />
      <div className="vignette" aria-hidden="true" />
      <ChapterRail />

      {/* 00 HERO */}
      <section className="hero" id="top" data-form="0" data-ch="0" aria-labelledby="h-hero">
        <div className="wrap hero-core">
          <h1 id="h-hero">
            <span className="eyebrow mono">
              <span className="pulse" aria-hidden="true" />
              AI receptionist · AI voice agents · POS · In-store sound
            </span>
            <span className="sr-only">. </span>
            <span className="brandword">Lumoras.</span> Sound orchestration for every business.
          </h1>
          <p className="hero-sub">
            One conductor for every sound your business makes. An AI receptionist on the phone, AI voice agents that know your
            trade, the checkout, the music on the floor and the announcements overhead, orchestrated as one system.
          </p>
          <div className="hero-ctas">
            <Link className="btn btn-primary" href="/demo">
              Book a demo <Icon name="arrow" />
            </Link>
            <CallChip />
          </div>
        </div>
        <div className="wrap">
          <div className="ticker" role="region" aria-label="Simulated live events" tabIndex={0}>
            <div className="ticker-track">
              {[0, 1].map((copy) => (
                <ul className="mono" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                  {TICKER.map(([time, prod, what]) => (
                    <li key={time}>
                      <span className="sim">SIM</span> · {time} · <span className="pr">{prod}</span> · {what}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
          <div className="ticker-label mono">
            <span>Simulated event stream · not live data</span>
            <span>Scroll to hear the system unfold</span>
          </div>
        </div>
      </section>

      {/* 01 VOICE */}
      <section className="chapter" id="voice" data-form="1" data-ch="1" aria-labelledby="h-voice">
        <div className="wrap voice-grid">
          <div className="panel glass">
            <div className="idx mono"><b>01</b><i />Lumoras Voice</div>
            <h2 id="h-voice">AI voice agents that know your trade.</h2>
            <p className="lede">
              An AI receptionist built for your industry, already fluent in its vocabulary. A balayage versus a gloss. A 4-top at
              7:30. A 60k-mile service. Your callers hear someone who gets it, on the first ring.
            </p>
            <ul className="caps">
              <li><span className="ico-w"><Icon name="phone" /></span><div><strong>Answers on the first ring, 24/7</strong><span>Nights, weekends, the Saturday rush. No hold music, no voicemail.</span></div></li>
              <li><span className="ico-w"><Icon name="user" /></span><div><strong>Recognizes regulars by number</strong><span>Greets them by name and remembers the usual.</span></div></li>
              <li><span className="ico-w"><Icon name="cal" /></span><div><strong>Books into your live calendar</strong><span>Checks real availability and confirms before the caller hangs up.</span></div></li>
              <li><span className="ico-w"><Icon name="bag" /></span><div><strong>Takes orders and deposits</strong><span>Pickup orders, reservations, deposits and no-show policies, handled on the call.</span></div></li>
              <li><span className="ico-w"><Icon name="lang" /></span><div><strong>Multilingual</strong><span>Follows the caller into their language, mid-sentence if needed.</span></div></li>
              <li><span className="ico-w"><Icon name="transfer" /></span><div><strong>Warm transfer to staff</strong><span>Hands the call to a person with the context already said.</span></div></li>
              <li><span className="ico-w"><Icon name="msg" /></span><div><strong>Follow-ups you approve</strong><span>Drafts win-back texts for callers who didn&apos;t book. Nothing sends until you approve it.</span></div></li>
            </ul>
            <div className="deeper-row">
              <GuideLink slug="what-is-an-ai-receptionist">What is an AI receptionist?</GuideLink>
              <GuideLink slug="how-voice-ai-works">How voice AI works</GuideLink>
            </div>
          </div>
          <figure className="glass transcript" aria-label="Simulated call transcript">
            <figcaption className="tx-head mono">
              <span>SIM · Inbound · 06:41 PM</span>
              <span className="tag"><span className="pulse" aria-hidden="true" />Sonorch</span>
            </figcaption>
            <ol className="tx">
              <li><span className="who">Caller</span><p>Hi, it&apos;s Dana. Can Maya fit me in this week?</p></li>
              <li className="agent"><span className="who">Voice agent</span><p>Hi Dana. Maya has Thursday at 10:00 for your usual balayage, about 90 minutes. Want it?</p></li>
              <li><span className="who">Caller</span><p>Perfect. Book it.</p></li>
              <li className="agent"><span className="who">Voice agent</span><p>Done. I&apos;ve taken the $25 deposit and texted your confirmation. See you Thursday.</p></li>
            </ol>
            <div className="tx-foot mono"><span>Regular · matched by number</span><span className="okk">Booked · Thu 10:00</span><span>1m 12s</span></div>
          </figure>
        </div>
      </section>

      {/* 02 POS */}
      <section className="chapter right" id="pos" data-form="2" data-ch="2" aria-labelledby="h-pos">
        <div className="wrap">
          <div className="panel glass">
            <div className="idx mono"><b>02</b><i />Lumoras POS</div>
            <h2 id="h-pos">A POS for any service business.</h2>
            <p className="lede">
              <strong className="ink">Start with the POS. Add voice whenever you&apos;re ready.</strong> The same core that runs salons on
              Sonorch and restaurants on SeasonX, configured as a POS system for small businesses and multi-location brands alike:
              clinics, shops, studios and service crews. Voice is a switch, not a migration.
            </p>
            <div className="feat">
              <div><Icon name="ticket" /><strong>Appointments or tickets</strong><span>Calendars for chair time, tickets for the counter, waitlists that refill cancellations.</span></div>
              <div><Icon name="card" /><strong>Payments</strong><span>Check out at the chair, the table or the counter. Split checks, tips, deposits.</span></div>
              <div><Icon name="team" /><strong>Staff &amp; commissions</strong><span>Personal staff apps, no shared logins. Payroll-ready commission and tip splits.</span></div>
              <div><Icon name="box" /><strong>Inventory</strong><span>Retail and back-bar stock, low-stock alerts, top sellers by staff member.</span></div>
              <div><Icon name="pin" /><strong>Multi-location</strong><span>One customer record across every location you run.</span></div>
              <div><Icon name="chart" /><strong>Reporting</strong><span>Revenue, utilization, no-shows and top sellers by day, week, month or staff.</span></div>
            </div>
            <div className="price">
              <div><div className="k mono">Free tier</div><div className="v">$0</div><div className="d">Cash and gift cards.</div></div>
              <div><div className="k mono">Sonorch POS plans</div><div className="v">$99<small>/mo and up</small></div><div className="d">Up to 5 staff. Month to month, setup included, AI receptionist with unlimited calls.</div></div>
            </div>
            <VoiceSwitch />
          </div>
        </div>
      </section>

      {/* 03 SOUND */}
      <section className="chapter" id="sound" data-form="3" data-ch="3" aria-labelledby="h-sound">
        <div className="wrap">
          <div className="panel glass">
            <div className="idx mono"><b>03</b><i />Lumoras Sound</div>
            <h2 id="h-sound">Custom sound orchestration for retail.</h2>
            <p className="lede">
              Every zone, every daypart, every location. Music that follows traffic and the time of day, a sonic identity that sounds
              like your brand, and announcements that run themselves.
            </p>
            <DaypartPreview />
            <ul className="capgrid">
              <li><Icon name="zones" /><div><strong>Zones</strong><span>Floor, fitting rooms, entrance and checkout, each with its own mix and level.</span></div></li>
              <li><Icon name="clock" /><div><strong>Dayparts</strong><span>Playlists that follow traffic and the time of day.</span></div></li>
              <li><Icon name="wave" /><div><strong>Brand sonic identity</strong><span>A signature sound, voice and tempo that is unmistakably yours.</span></div></li>
              <li><Icon name="mega" /><div><strong>Automated announcements</strong><span>Store closing, curbside ready, promos, scheduled or triggered.</span></div></li>
              <li><Icon name="mic" /><div><strong>Voice paging</strong><span>Page a zone or the whole store from the console or a phone.</span></div></li>
              <li><Icon name="sliders" /><div><strong>One console</strong><span>Every location synchronized and adjusted from one place.</span></div></li>
            </ul>
            <div className="deeper-row">
              <GuideLink slug="overhead-paging-and-store-announcements">Overhead paging and store announcements</GuideLink>
            </div>
          </div>
        </div>
      </section>

      {/* 04 VERTICALS */}
      <section className="chapter" id="verticals" data-form="4" data-ch="4" aria-labelledby="h-vert">
        <Verticals />
      </section>

      {/* 05 PRODUCTS */}
      <section className="chapter" id="products" data-form="5" data-ch="5" aria-labelledby="h-prod">
        <div className="wrap">
          <div className="prod-head">
            <div className="idx mono"><b>05</b><i />Product family</div>
            <h2 id="h-prod">One platform. A family of voices.</h2>
            <p className="lede">Lumoras runs the platform. Our vertical products put it to work in the industries that live on the phone.</p>
          </div>
          <div className="prods" role="list">
            <article className="prod glass" role="listitem" style={{ ["--tone" as string]: "var(--s1)", ["--tone-ink" as string]: "var(--s1-ink)" }}>
              <div className="prod-status mono"><span className="dot" />Live · sonorch.ai</div>
              <h3>Sonorch</h3>
              <p className="what">POS and AI receptionist for salons, barbers, spas, nail and lash studios and med spas.</p>
              <blockquote>Every call answered. Every chair filled. Every table sat.</blockquote>
              <div className="stats">
                <div><b>98%+</b><span>of calls answered</span></div>
                <div><b>70%</b><span>fewer missed calls</span></div>
                <div><b>100%</b><span>of bookings on the live calendar</span></div>
                <div><b>10+ hrs</b><span>returned to the owner each week</span></div>
              </div>
              <p className="attrib">Results published by Sonorch.</p>
              <a className="plink" href={PRODUCTS.sonorch.url}>Visit sonorch.ai <Icon name="arrow" /></a>
            </article>
            <article className="prod glass" role="listitem" style={{ ["--tone" as string]: "var(--s3)", ["--tone-ink" as string]: "var(--s3-ink)" }}>
              <div className="prod-status mono"><span className="dot" />Live · seasonx.ai</div>
              <h3>SeasonX</h3>
              <p className="what">
                AI receptionist and point of sale for restaurants: full-service dining, quick service, cafés, bars and taprooms, takeout
                kitchens, pizzerias and family restaurants.
              </p>
              <blockquote>The dinner rush answers its own phone.</blockquote>
              <ul className="plist">
                <li><Icon name="check" />Reservations and phone orders with party size, allergies and notes like birthdays</li>
                <li><Icon name="check" />Live floor view by section: tap to seat or reopen a check</li>
                <li><Icon name="check" />Kitchen display with modifiers like &ldquo;no peanuts&rdquo;; tickets turn red at ten minutes</li>
                <li><Icon name="check" />Split checks by item or evenly, with on-screen tips</li>
              </ul>
              <p className="note">Offline mode: orders and cash keep working without internet, and card payments sync when it&apos;s back.</p>
              <div className="plinks">
                <a className="plink" href={PRODUCTS.seasonx.url}>Visit seasonx.ai <Icon name="arrow" /></a>
                <a className="plink plink-2" href={PRODUCTS.seasonx.demo}>Book a walkthrough <Icon name="arrow" /></a>
              </div>
            </article>
            <article className="prod glass" role="listitem" style={{ ["--tone" as string]: "var(--s4)", ["--tone-ink" as string]: "var(--s4-ink)" }}>
              <div className="prod-status mono"><span className="dot" />Florida launch · kitchenspot.ai</div>
              <h3>KitchenSpot</h3>
              <p className="what">
                Restaurant discovery, dish by dish. Every restaurant in town, its full menu, ratings and reviews from verified diners,
                and pickup ordering in a tap.
              </p>
              <div className="chips" aria-label="Launch cities"><span>Sarasota</span><span>Tampa</span><span>Orlando</span><span>Miami</span></div>
              <p className="note">Connects with SeasonX: menus, availability and pickup orders flow straight to the kitchen.</p>
              <a className="plink" href={PRODUCTS.kitchenspot.url}>Visit kitchenspot.ai <Icon name="arrow" /></a>
            </article>
          </div>
          <div className="platform">
            <div><Icon name="card" /><div><strong>Lumoras POS</strong><span>The same core, configured for any service business.</span></div></div>
            <div><Icon name="phone" /><div><strong>Lumoras Voice</strong><span>Plugs into Lumoras POS or the system you already run.</span></div></div>
            <div><Icon name="wave" /><div><strong>Lumoras Sound</strong><span>Zoned, dayparted, on-brand audio for retail.</span></div></div>
          </div>
        </div>
      </section>

      {/* 06 ENTERPRISE */}
      <section className="chapter" id="enterprise" data-form="6" data-ch="6" aria-labelledby="h-ent">
        <div className="wrap">
          <div className="panel glass">
            <div className="idx mono"><b>06</b><i />Enterprise</div>
            <h2 id="h-ent">Built for the enterprise.</h2>
            <p className="lede">
              From one chair to hundreds of locations. The governance, security and rollups IT signs off on, with onboarding that never
              stalls the floor.
            </p>
            <ul className="ent">
              <li><Icon name="key" /><div><strong>SSO &amp; SCIM</strong><span>Sign in with your identity provider. Provision and remove staff automatically.</span></div></li>
              <li><Icon name="shield" /><div><strong>Role-based access</strong><span>Owners, managers, front desk and staff see exactly what their role allows.</span></div></li>
              <li><Icon name="list" /><div><strong>Audit logs</strong><span>Every refund, schedule change, price edit and permission change, recorded.</span></div></li>
              <li><Icon name="code" /><div><strong>Open API &amp; webhooks</strong><span>Sync customers, bookings, tickets and sales with the systems you already run.</span></div></li>
              <li><Icon name="layers" /><div><strong>Multi-location rollups</strong><span>Compare revenue, utilization and call outcomes across sites, or drill into one.</span></div></li>
              <li><Icon name="lock" /><div><strong>Card data stays with the processor</strong><span>Payments are handled by the processor. Lumoras never stores card numbers.</span></div></li>
              <li><Icon name="onboard" /><div><strong>Dedicated onboarding</strong><span>A named team maps your services, menus, policies and soundscapes, then trains your staff.</span></div></li>
              <li><Icon name="clock" /><div><strong>24/7 answering</strong><span>Every location covered around the clock, with escalation rules you control.</span></div></li>
            </ul>
            <div className="ent-tags" aria-label="Integrations and controls">
              <span>SSO</span><span>SCIM</span><span>RBAC</span><span>Audit trail</span><span>REST API</span><span>Webhooks</span><span>Rollups</span>
            </div>
            <div className="deeper-row">
              <GuideLink slug="ai-call-center">How an AI call center works</GuideLink>
            </div>
          </div>
        </div>
      </section>

      {/* 07 HOW */}
      <section className="chapter" id="how" data-form="7" data-ch="7" aria-labelledby="h-how">
        <div className="wrap">
          <div className="how-head">
            <div className="idx mono"><b>07</b><i />How it works</div>
            <h2 id="h-how">Live in four movements.</h2>
            <p className="lede">No rip and replace. Bring what you run today, tune it to how you work, and go live without closing for a day.</p>
          </div>
          <ol className="steps">
            <li className="step glass"><div className="n mono"><b>1</b>Connect</div><h3>Bring your data</h3><p>Connect your POS data, calendar, menu or service list. Or start fresh on Lumoras POS.</p><span className="bar" aria-hidden="true" /></li>
            <li className="step glass"><div className="n mono"><b>2</b>Tune</div><h3>Make it yours</h3><p>Voice, greeting, policies, hours and escalation rules. For stores, the soundscape for every zone.</p><span className="bar" aria-hidden="true" /></li>
            <li className="step glass"><div className="n mono"><b>3</b>Go live</div><h3>Flip the switch</h3><p>Forward your number and pair your store speakers. Your team keeps working while it happens.</p><span className="bar" aria-hidden="true" /></li>
            <li className="step glass"><div className="n mono"><b>4</b>Orchestrate</div><h3>Run it as one</h3><p>Every call, sale and sound in one console, with live analytics across every location.</p><span className="bar" aria-hidden="true" /></li>
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="chapter" id="cta" data-form="8" data-ch="7" aria-labelledby="h-cta">
        <div className="wrap cta-grid">
          <div className="cta-copy">
            <div className="scrim">
              <div className="idx mono"><b>08</b><i />Hear it for yourself</div>
              <h2 id="h-cta">Every sound your business makes. One conductor.</h2>
              <p className="lede">
                Call the live demo line and talk to the AI receptionist yourself. Or book a walkthrough of voice, POS and sound for your
                locations.
              </p>
              <CallChip />
            </div>
          </div>
          <DemoForm headingLevel="h3" />
        </div>
      </section>
    </div>
  );
}
