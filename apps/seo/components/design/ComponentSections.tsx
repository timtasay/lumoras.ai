"use client";

import { useState } from "react";
import { Icon } from "@/components/Icons";
import { Button, IconButton } from "@/components/ui/Button";
import { useCommandPalette } from "@/components/ui/CommandPalette";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Segmented, SelectField, Switch, TextareaField, TextField } from "@/components/ui/Fields";
import { KpiTile } from "@/components/ui/Kpi";
import { Modal } from "@/components/ui/Modal";
import { RevealGroup } from "@/components/ui/Reveal";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { Badge, Chip, StatusLight } from "@/components/ui/Status";
import { Tabs } from "@/components/ui/Tabs";
import { SiteCard, type SiteCardData } from "@/components/sites/SiteCard";
import { useToast } from "@/components/ui/Toast";

export function Buttons() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <div className="row-demo">
        <Button variant="primary" icon="bolt">Start run</Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger" icon="close">Unpublish</Button>
      </div>
      <div className="row-demo">
        <Button variant="primary" size="sm">Small</Button>
        <Button variant="primary">Medium</Button>
        <Button variant="primary" size="lg" iconRight="arrow">Large</Button>
        <Button variant="secondary" disabled>Disabled</Button>
        <IconButton icon="refresh" label="Refresh" />
      </div>
      <div className="row-demo">
        <Button
          variant="primary"
          loading={busy}
          icon="send"
          onClick={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 1800);
          }}
        >
          Publish now
        </Button>
        <Button variant="secondary" loading>
          Testing connection
        </Button>
        <p className="muted small">Loading keeps the width; the label stays for screen readers.</p>
      </div>
    </div>
  );
}

export function Forms() {
  const [auto, setAuto] = useState(false);
  const [backdate, setBackdate] = useState(false);
  const [mode, setMode] = useState<"rolling" | "batch">("rolling");
  const [view, setView] = useState<"month" | "list">("month");
  return (
    <div className="form-demo">
      <div className="form-col">
        <TextField label="Site domain" placeholder="example.com" defaultValue="lumoras.ai" hint="We crawl its sitemap to build the route inventory." />
        <TextField label="Runway threshold (days)" type="number" defaultValue={3} min={1} error="Below 5 days leaves no time to review. Use 5 or more." />
        <SelectField
          label="Review mode"
          defaultValue="approval"
          options={[
            { value: "approval", label: "Approval required (default)" },
            { value: "autopilot", label: "Autopilot" },
          ]}
        />
        <TextareaField label="What we do not sell" rows={3} defaultValue={"HVAC\nDental clinics"} hint="Topic selection never writes about these." />
      </div>
      <div className="form-col">
        <Switch
          label="Autopilot"
          hint="Publishes when lint and fact-check pass. Unreviewed claims go live under the client’s name."
          checked={auto}
          onChange={setAuto}
        />
        <Switch label="Allow back-dating" hint="Off by default: a false datePublished can be compared with the date Google first saw the URL." checked={backdate} onChange={setBackdate} />
        <Checkbox label="Email reviewers when an article is ready" hint="Plus an in-app notification." defaultChecked />
        <Checkbox label="Add the target keyword to rank tracking" defaultChecked />
        <div className="seg-demo">
          <span className="label">Generation</span>
          <Segmented label="Generation mode" value={mode} onChange={setMode} options={[{ value: "rolling", label: "Rolling" }, { value: "batch", label: "Batch" }]} />
        </div>
        <div className="seg-demo">
          <span className="label">Calendar view</span>
          <Segmented size="sm" label="Calendar view" value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "list", label: "List" }]} />
        </div>
      </div>
    </div>
  );
}

export function StatusSet() {
  const [f, setF] = useState({ idea: true, targeted: true, published: false, ranking: false });
  const toggle = (k: keyof typeof f) => setF((x) => ({ ...x, [k]: !x[k] }));
  return (
    <div className="stack">
      <div className="row-demo">
        <Badge>Draft</Badge>
        <Badge tone="info">Scheduled</Badge>
        <Badge tone="amber" icon="alert">Awaiting review</Badge>
        <Badge tone="ion" icon="check">Published</Badge>
        <Badge tone="warn">Over budget</Badge>
        <Badge tone="danger" icon="alert">Fact-check failed</Badge>
      </div>
      <div className="row-demo" role="group" aria-label="Filter keywords by status">
        <Chip pressed={f.idea} onToggle={() => toggle("idea")} count={214}>Idea</Chip>
        <Chip pressed={f.targeted} onToggle={() => toggle("targeted")} count={18}>Targeted</Chip>
        <Chip pressed={f.published} onToggle={() => toggle("published")} count={42}>Published</Chip>
        <Chip pressed={f.ranking} onToggle={() => toggle("ranking")} count={31}>Ranking</Chip>
      </div>
      <div className="row-demo lights">
        <StatusLight state="live">Pipeline running</StatusLight>
        <StatusLight state="ok">Search Console connected</StatusLight>
        <StatusLight state="idle">Not scheduled</StatusLight>
        <StatusLight state="warn">Token expires in 3 days</StatusLight>
        <StatusLight state="error">Webhook failing</StatusLight>
      </div>
      <p className="muted small">Only “live” pulses. Every light carries a text label, so colour is never the only signal.</p>
    </div>
  );
}

export function Kpis({ replay }: { replay: number }) {
  return (
    <RevealGroup className="kpi-grid" replay={replay}>
      {[
        <KpiTile key="c" label="Organic clicks" value={12480} format="compact" delta={18.2} trend={[620, 640, 700, 690, 760, 810, 790, 880, 920, 980, 1040, 1120]} replay={replay} />,
        <KpiTile key="i" label="Impressions" value={412300} format="compact" delta={9.4} trend={[21, 22, 22, 24, 23, 26, 27, 29, 30, 31, 33, 34].map((x) => x * 1000)} replay={replay} />,
        <KpiTile key="p" label="Average position" value={14.2} format="dec1" delta={-6.1} goodWhen="down" deltaLabel="lower is better" replay={replay} />,
        <KpiTile key="x" label="Indexed pages" value={186} delta={4.5} replay={replay} />,
        <KpiTile key="a" label="Articles live" value={42} note="3 this month" replay={replay} />,
        <KpiTile key="r" label="Runway" value={6} suffix=" days" tone="amber" note="Below the 10-day threshold" replay={replay} />,
        <KpiTile key="u" label="Credits used" value={1284} note="of 5,000 · reserve 500" replay={replay} />,
      ]}
    </RevealGroup>
  );
}

export function Cards({ replay }: { replay: number }) {
  // the real site card (components/sites/SiteCard), with sample numbers
  const sites: SiteCardData[] = [
    { id: "d1", domain: "sonorch.ai", name: "Sonorch", industry: "Salons", routes: 214, authors: 2, brandFilled: 5, lastCrawl: "2 min ago", crawlStatus: "ok", failingConnections: 0 },
    { id: "d2", domain: "seasonx.ai", name: "SeasonX", industry: "Restaurants", routes: 96, authors: 1, brandFilled: 3, lastCrawl: "Yesterday", crawlStatus: "partial", failingConnections: 0 },
    { id: "d3", domain: "lumoras.ai", name: "Lumoras", industry: "Company", routes: 41, authors: 0, brandFilled: 4, lastCrawl: "3 h ago", crawlStatus: "ok", failingConnections: 1 },
    { id: "d4", domain: "kitchenspot.ai", name: "KitchenSpot", industry: "Restaurant discovery", routes: 0, authors: 0, brandFilled: 0, lastCrawl: null, crawlStatus: null, failingConnections: 0 },
  ];
  return (
    <RevealGroup className="site-grid" replay={replay}>
      {sites.map((s) => (
        <SiteCard key={s.id} site={s} />
      ))}
    </RevealGroup>
  );
}

export function Loading() {
  const [loading, setLoading] = useState(true);
  return (
    <div className="stack">
      <div className="row-demo">
        <Segmented label="Loading state" value={loading ? "loading" : "loaded"} onChange={(v) => setLoading(v === "loading")} options={[{ value: "loading", label: "Loading" }, { value: "loaded", label: "Loaded" }]} size="sm" />
      </div>
      <div className="skel-grid">
        {loading ? (
          <>
            <SkeletonCard label="Loading site summary" />
            <div className="panel skel-card" aria-hidden="true">
              <Skeleton w="40%" h={12} />
              <Skeleton h={120} r={12} />
            </div>
          </>
        ) : (
          <>
            <div className="panel loaded-card fade">
              <p className="label">sonorch.ai</p>
              <p className="loaded-big">12,480 clicks</p>
              <p className="muted">+18.2% vs previous 28 days. 6 articles published this month, 14 days of runway.</p>
            </div>
            <div className="panel loaded-card fade">
              <p className="label">Next up</p>
              <ul className="next-list">
                <li><Badge tone="info">Tue 14</Badge> AI receptionist for salons</li>
                <li><Badge tone="info">Fri 17</Badge> Restaurant phone orders</li>
                <li><Badge>Tue 21</Badge> Writing starts Sat 18</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Empty() {
  const toast = useToast();
  return (
    <EmptyState
      icon="calendar"
      title="Nothing scheduled after Friday"
      text="lumoras.ai has 3 days of runway. Set a publishing schedule and the pipeline writes each article three days before its slot."
      primary={
        <Button variant="primary" icon="calendar" onClick={() => toast.push({ tone: "info", title: "Schedules arrive in Phase 3" })}>
          Set a schedule
        </Button>
      }
      secondary={<Button variant="ghost">Write one now</Button>}
    />
  );
}

type Kw = { kw: string; vol: number; kd: number; cpc: number; pos: number | null; intent: string; status: "Idea" | "Targeted" | "Published" | "Ranking" };
const KW: Kw[] = [
  { kw: "ai receptionist for salons", vol: 880, kd: 23, cpc: 6.1, pos: 14, intent: "Commercial", status: "Targeted" },
  { kw: "salon no show policy", vol: 1300, kd: 18, cpc: 2.4, pos: 6, intent: "Informational", status: "Ranking" },
  { kw: "restaurant phone ordering system", vol: 590, kd: 41, cpc: 9.8, pos: null, intent: "Commercial", status: "Idea" },
  { kw: "ai answering service cost", vol: 720, kd: 35, cpc: 11.2, pos: 22, intent: "Commercial", status: "Published" },
  { kw: "how to reduce no shows", vol: 2400, kd: 29, cpc: 3.1, pos: 9, intent: "Informational", status: "Ranking" },
];
const TONE = { Idea: "neutral", Targeted: "info", Published: "ion", Ranking: "ion" } as const;

export function Table() {
  const cols: Column<Kw>[] = [
    { key: "kw", header: "Keyword", sortValue: (r) => r.kw, render: (r) => r.kw },
    { key: "vol", header: "Volume", numeric: true, sortValue: (r) => r.vol, render: (r) => r.vol.toLocaleString("en-US") },
    { key: "kd", header: "KD", numeric: true, sortValue: (r) => r.kd, render: (r) => r.kd },
    { key: "cpc", header: "CPC", numeric: true, sortValue: (r) => r.cpc, render: (r) => `$${r.cpc.toFixed(2)}`, hideOnPhone: true },
    { key: "pos", header: "Position", numeric: true, sortValue: (r) => r.pos ?? 999, render: (r) => (r.pos === null ? <span className="muted">—</span> : r.pos) },
    { key: "intent", header: "Intent", render: (r) => r.intent, hideOnPhone: true },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
  ];
  return <DataTable caption="Saved keywords for sonorch.ai (sample)" columns={cols} rows={KW} rowKey={(r) => r.kw} initialSort={{ key: "vol", dir: "desc" }} />;
}

export function TabsDemo() {
  return (
    <Tabs
      label="Article panels"
      tabs={[
        {
          id: "seo",
          label: "SEO checklist",
          count: 14,
          content: (
            <ul className="check-list">
              <li><Icon name="check" /> Title 58 of 60 characters</li>
              <li><Icon name="check" /> Description 149 characters (140–155)</li>
              <li><Icon name="check" /> Direct answer in the first 3 sentences</li>
              <li data-warn=""><Icon name="alert" /> 2 internal links; the brand asks for 3–6</li>
            </ul>
          ),
        },
        { id: "facts", label: "Fact-check", count: 9, content: <p className="muted">7 claims sourced, 1 rewritten, 1 removed. Evidence opens beside each claim.</p> },
        { id: "links", label: "Links", count: 4, content: <p className="muted">4 internal links resolve on the publish date. 6 external links return 200.</p> },
        { id: "history", label: "History", content: <p className="muted">Version 3 · edited by an editor 12 minutes ago.</p> },
      ]}
    />
  );
}

export function Overlays() {
  const toast = useToast();
  const palette = useCommandPalette();
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <div className="row-demo">
        <Button onClick={() => toast.push({ tone: "ok", title: "Article approved", body: "It publishes Tue 14 Oct at 09:00 site time.", action: { label: "Undo", onClick: () => toast.push({ tone: "info", title: "Approval undone" }) } })}>
          Success toast
        </Button>
        <Button onClick={() => toast.push({ tone: "warn", title: "Runway below threshold", body: "seasonx.ai has 6 days of content left." })}>Warning toast</Button>
        <Button onClick={() => toast.push({ tone: "danger", title: "Publish failed", body: "The Git connector returned 401. Reconnect it in site settings.", duration: 0 })}>Error toast</Button>
      </div>
      <div className="row-demo">
        <Button variant="danger" onClick={() => setOpen(true)}>
          Unpublish article…
        </Button>
        <Button icon="cmd" onClick={palette.open}>
          Open command palette
        </Button>
        <span className="muted small">
          or press <kbd>⌘</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere
        </span>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Unpublish this article?"
        description="It is removed from lumoras.ai with a pull request. Rank tracking keeps its history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it live
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setOpen(false);
                toast.push({ tone: "info", title: "Unpublish requested", body: "Pull request opened." });
              }}
            >
              Unpublish
            </Button>
          </>
        }
      >
        <ul className="check-list">
          <li><Icon name="info" /> 3 internal links point to it; they will be listed in the pull request.</li>
          <li><Icon name="info" /> The social posts already sent stay where they are.</li>
        </ul>
      </Modal>
    </div>
  );
}
