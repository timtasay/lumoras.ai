"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Status";
import { PipelineRun } from "@/components/pipeline/PipelineRun";
import { Buttons, Cards, Empty, Forms, Kpis, Loading, Overlays, StatusSet, Table, TabsDemo } from "./ComponentSections";
import { Calendar, Charts } from "./DataSections";
import { MorphDemo } from "./MorphDemo";
import { SignInMock } from "./SignInMock";
import { MotionDemo, SpaceRadiiElevation, Swatches, TypeScale } from "./TokenSections";

export const SECTIONS = [
  ["color", "Colour"],
  ["type", "Type"],
  ["space", "Space and depth"],
  ["motion", "Motion"],
  ["buttons", "Buttons"],
  ["forms", "Forms"],
  ["status", "Status"],
  ["kpis", "KPI tiles"],
  ["cards", "Cards"],
  ["loading", "Loading"],
  ["empty", "Empty states"],
  ["table", "Table"],
  ["tabs", "Tabs"],
  ["overlays", "Toasts and dialogs"],
  ["charts", "Charts"],
  ["calendar", "Calendar"],
  ["pipeline", "Pipeline run"],
  ["morph", "List to detail"],
  ["signin", "Sign-in"],
] as const;

function Section({ id, n, title, text, children, action }: { id: string; n: number; title: string; text: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="ds-sec" aria-labelledby={`${id}-h`}>
      <header className="ds-head">
        <span className="ds-n mono" aria-hidden="true">
          {String(n).padStart(2, "0")}
        </span>
        <div className="ds-htext">
          <h2 id={`${id}-h`}>{title}</h2>
          <p>{text}</p>
        </div>
        {action}
      </header>
      <div className="ds-body">{children}</div>
    </section>
  );
}

export function DesignSystem() {
  const [replay, setReplay] = useState(0);
  const again = (
    <Button size="sm" variant="ghost" icon="refresh" onClick={() => setReplay((r) => r + 1)}>
      Replay
    </Button>
  );
  let n = 0;
  return (
    <div className="ds">
      <header className="ds-hero grid-bg">
        <p className="eyebrow">
          <b>Voice Core</b> · design system · Phase 0
        </p>
        <h1>Control room, clean room.</h1>
        <p className="lede">
          Every token, component and motion pattern Lumoras Growth is built from, in both themes. Tokens come from{" "}
          <code>@lumoras/ui-tokens</code>, shared with lumoras.ai, so the two products stay one brand. Switch the theme in the
          top bar; contrast ratios below recompute live.
        </p>
        <div className="ds-badges">
          <Badge tone="ion" icon="check">WCAG 2.2 AA text contrast</Badge>
          <Badge tone="info">Reduced-motion equivalents</Badge>
          <Badge>Sample data only</Badge>
        </div>
      </header>

      <nav className="ds-toc" aria-label="Design system sections">
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="color" n={++n} title="Colour" text="Named tokens, the job each may do, and contrast against panels in the current theme.">
        <Swatches />
      </Section>
      <Section id="type" n={++n} title="Type" text="Sora for display, Geist for reading, Geist Mono for labels and data. Tabular numerals for every metric.">
        <TypeScale />
      </Section>
      <Section id="space" n={++n} title="Space, radii and depth" text="A 4px spacing scale, soft radii, and elevation that reads in both themes. Glows only on live and focused things.">
        <SpaceRadiiElevation />
      </Section>
      <Section id="motion" n={++n} title="Motion" text="Feedback 120–200ms, panels and routes 250–400ms, ambient visuals slow and continuous.">
        <MotionDemo />
      </Section>
      <Section id="buttons" n={++n} title="Buttons" text="One primary action per view, in ion. Secondary, ghost and danger for the rest.">
        <Buttons />
      </Section>
      <Section id="forms" n={++n} title="Forms" text="Labels above, hints below, errors that say how to fix it. Focus rings in ion.">
        <Forms />
      </Section>
      <Section id="status" n={++n} title="Badges, chips and status lights" text="Record states, filters, and connection health.">
        <StatusSet />
      </Section>
      <Section id="kpis" n={++n} title="KPI tiles" text="Numbers count up on load; deltas say whether the movement is good." action={again}>
        <Kpis replay={replay} />
      </Section>
      <Section id="cards" n={++n} title="Cards" text="Cards rise in on first load, 40ms apart." action={again}>
        <Cards replay={replay} />
      </Section>
      <Section id="loading" n={++n} title="Loading" text="Shimmer skeletons in the shape of what is coming. Never a blank panel, never a spinner alone.">
        <Loading />
      </Section>
      <Section id="empty" n={++n} title="Empty states" text="Say what is missing and why it matters, with the next action as the primary button.">
        <Empty />
      </Section>
      <Section id="table" n={++n} title="Data table" text="Sortable, sticky header, numbers right-aligned. Scrolls inside its frame on phones.">
        <Table />
      </Section>
      <Section id="tabs" n={++n} title="Tabs" text="Arrow keys move between tabs; the indicator slides on transform.">
        <TabsDemo />
      </Section>
      <Section id="overlays" n={++n} title="Toasts, dialogs and ⌘K" text="Toasts announce politely; dialogs trap focus and close on Esc; the palette jumps anywhere.">
        <Overlays />
      </Section>
      <Section id="charts" n={++n} title="Charts" text="Hand-written SVG that draws in along its path. Each has a hidden data table and keyboard readout." action={again}>
        <Charts replay={replay} />
      </Section>
      <Section id="calendar" n={++n} title="Content calendar" text="The runway band: ion while healthy, amber below the threshold, red where nothing is scheduled.">
        <Calendar />
      </Section>
      <Section id="pipeline" n={++n} title="Pipeline run" text="The signature screen. A pulse travels the path as each step completes; the run waits at the review gate.">
        <PipelineRun />
      </Section>
      <Section id="morph" n={++n} title="List to detail" text="View Transitions: the card you press becomes the page.">
        <MorphDemo />
      </Section>
      <Section id="signin" n={++n} title="Sign-in" text="The Spectrum particle field behind glass, shared with lumoras.ai through @lumoras/ui-field.">
        <SignInMock />
      </Section>
    </div>
  );
}
