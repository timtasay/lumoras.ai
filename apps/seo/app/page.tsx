import Link from "next/link";
import { Icon, type IconName } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Status";
import { isDesignRouteEnabled } from "@/lib/env";

const READY: { icon: IconName; title: string; text: string }[] = [
  { icon: "swatch", title: "Shared Voice Core tokens", text: "@lumoras/ui-tokens and @lumoras/ui-field, shared with lumoras.ai so the brand stays identical." },
  { icon: "db", title: "Migrations runner", text: "Numbered SQL files, one transaction each, advisory lock, checksum guard, owner role only." },
  { icon: "bolt", title: "Worker process", text: "Same image, different command. Validates its environment and stops cleanly on SIGTERM." },
  { icon: "shield", title: "Deploy files", text: "Dockerfile, compose for web and worker, Caddy route and database init. Not deployed." },
];

const PHASES: { n: number; title: string; text: string }[] = [
  { n: 1, title: "Tenancy", text: "Sign-in, workspaces, roles, row-level security, sites, brand profiles, onboarding." },
  { n: 2, title: "Research", text: "SEO data provider, budget and reserve, research log, keywords." },
  { n: 3, title: "Content pipeline", text: "Calendar, rolling generation, the ten steps, review gate, publishing." },
  { n: 4, title: "Measurement", text: "Rank tracking, Search Console, GA4, audits, dashboards." },
];

export default function Home() {
  const design = isDesignRouteEnabled();
  return (
    <div className="page">
      <section className="hero-p0">
        <p className="eyebrow">
          <b>Phase 0</b> · foundations
        </p>
        <h1>Lumoras Growth is being built.</h1>
        <p className="lede">
          One place to plan, write, publish and measure SEO content for every client site. This is the foundation: the
          design system, the database runner, the worker and the deploy files. Nothing here talks to real data yet.
        </p>
        <div className="hero-acts">
          {design ? (
            <Link href="/design" className={buttonClass("primary", "lg")}>
              Review the design system
              <Icon name="arrow" />
            </Link>
          ) : null}
          <Badge tone="amber" icon="alert">
            Product and host name pending owner decision
          </Badge>
        </div>
      </section>

      <section className="sec" aria-labelledby="ready-h">
        <div className="sec-head">
          <h2 id="ready-h">Ready in this phase</h2>
        </div>
        <RevealGroup className="card-grid" as="ul">
          {READY.map((r) => (
            <div key={r.title} className="panel feat">
              <span className="feat-ico" aria-hidden="true">
                <Icon name={r.icon} />
              </span>
              <h3>{r.title}</h3>
              <p>{r.text}</p>
            </div>
          ))}
        </RevealGroup>
      </section>

      <section className="sec" aria-labelledby="sites-h">
        <div className="sec-head">
          <h2 id="sites-h">Sites</h2>
        </div>
        <EmptyState
          icon="globe"
          title="No sites connected yet"
          text="sonorch.ai, seasonx.ai and lumoras.ai will be the first three, onboarded in Phase 1. Each gets its own runway, calendar and dashboard."
          primary={
            <button type="button" className={buttonClass("primary")} disabled aria-describedby="sites-soon">
              <Icon name="plus" /> Add your first site
            </button>
          }
          secondary={
            <span id="sites-soon" className="muted">
              Arrives in Phase 1
            </span>
          }
        />
      </section>

      <section className="sec" aria-labelledby="next-h">
        <div className="sec-head">
          <h2 id="next-h">Next phases</h2>
          <p className="muted">Each starts when the owner approves the one before.</p>
        </div>
        <ol className="phases">
          {PHASES.map((p) => (
            <li key={p.n} className="panel">
              <span className="phase-n mono">P{p.n}</span>
              <div>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
