"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Status";
import { DomainOverviewLocked, ScanVisual } from "@/components/scan/ScanVisual";
import { continueOnboarding } from "@/app/(app)/w/[slug]/actions";

export function ContinueButton({ slug, from, label = "Continue", variant = "primary" }: { slug: string; from: string; label?: string; variant?: "primary" | "secondary" | "ghost" }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error ? (
        <p className="form-alert" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        variant={variant}
        size="lg"
        iconRight="arrow"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await continueOnboarding(slug, from);
            if (r && !r.ok) setError(r.error ?? "Could not continue.");
          })
        }
      >
        {label}
      </Button>
    </>
  );
}

/** Step 3: the live scan, then the (locked) domain overview, then continue. */
export function ScanStep({ slug, siteId, domain, alreadyScanned }: { slug: string; siteId: string; domain: string; alreadyScanned: boolean }) {
  const [done, setDone] = useState<null | "ok" | "partial" | "failed">(null);
  return (
    <div className="scan-step">
      <ScanVisual slug={slug} siteId={siteId} domain={domain} autoStart={!alreadyScanned} onFinished={(r) => setDone(r.status)} />
      <DomainOverviewLocked domain={domain} />
      <div className="onb-foot">
        <p className="muted small" aria-live="polite">
          {done === "failed"
            ? "No routes were found. Check the domain, or continue and scan again later from site settings."
            : done
              ? "Inventory stored. Next: the brand profile, pre-filled from the pages we read."
              : alreadyScanned
                ? "This site was scanned before. Scan again, or continue."
                : "The scan takes a few seconds for most sites."}
        </p>
        <ContinueButton slug={slug} from="scan" label={done === "failed" ? "Continue anyway" : "Continue to the brand profile"} variant={done || alreadyScanned ? "primary" : "secondary"} />
      </div>
    </div>
  );
}

/** A designed "coming next" step: what it will do, which phase delivers it, and a skip. */
export function LaterStep({ slug, from, phase, cards, note, preview = false }: { slug: string; from: string; phase: number; cards: { icon: IconName; title: string; text: string; phase?: number }[]; note: ReactNode; preview?: boolean }) {
  return (
    <div className="later">
      <ul className="later-cards" data-preview={preview ? "" : undefined}>
        {cards.map((c) => (
          <li key={c.title} className="panel later-card">
            <span className="feat-ico" aria-hidden="true">
              <Icon name={c.icon} />
            </span>
            <div>
              <p className="later-title">
                {c.title} <Badge tone="info">Phase {c.phase ?? phase}</Badge>
              </p>
              <p className="muted small">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="later-note">
        <Icon name="info" />
        <span>{note}</span>
      </p>
      <div className="onb-foot">
        <p className="muted small">Coming next: nothing to set up today.</p>
        <ContinueButton slug={slug} from={from} label="Skip for now" />
      </div>
    </div>
  );
}
