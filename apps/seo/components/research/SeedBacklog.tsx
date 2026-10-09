"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "@/components/forms/FormBits";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { SelectField, TextareaField } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { addSeedsAction, deleteSeedAction, updateSeedAction } from "@/app/(app)/w/[slug]/research-actions";
import { idle } from "@/lib/actions-state";

export type SeedItem = { id: string; seed: string; priority: number; status: "queued" | "researched" | "skipped"; lastResearchedAt: string | null; count: number; next: boolean; freshUntil: string | null };

const PRIORITY = ["Normal", "Raised", "High", "Urgent"];
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The seed backlog (rule 4): seeds waiting to be researched. The rotation
 * puts never-researched and higher-priority seeds first, then the stalest;
 * a seed researched within the site's maximum age is not offered again.
 */
export function SeedBacklog({ slug, siteId, seeds, canEdit, maxAgeDays }: { slug: string; siteId: string; seeds: SeedItem[]; canEdit: boolean; maxAgeDays: number }) {
  const [state, action, pending] = useActionState(addSeedsAction.bind(null, slug, siteId), idle);
  const [busy, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const fe = state.fieldErrors ?? {};
  const act = (p: Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await p;
      toast.push(r.ok ? { tone: "ok", title: r.message ?? "Done." } : { tone: "danger", title: r.error ?? "Could not change it." });
      if (r.ok) router.refresh();
    });

  return (
    <div className="seeds">
      <div>
        {canEdit ? (
          <form action={action} onSubmit={submitKeepingValues(action)} className="panel pad form-grid" noValidate key={state.ok ? state.at : "seed-form"}>
            <ActionFeedback state={state} />
            <TextareaField className="span-2" label="Seeds to research" name="seeds" rows={5} placeholder={"salon deposit policy\nbarbershop booking app"} hint="One per line. Seeds are broad topics; research turns each into up to 150 keyword ideas." error={fe.seeds} />
            <SelectField label="Priority" name="priority" defaultValue="0" options={PRIORITY.map((l, i) => ({ value: String(i), label: l }))} />
            <div className="form-acts">
              <Button type="submit" variant="secondary" icon="plus" loading={pending}>
                Add to the backlog
              </Button>
            </div>
          </form>
        ) : (
          <ReadOnlyNote>Your role can see the backlog. Editors and owners manage it.</ReadOnlyNote>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          A researched seed is not bought again for {maxAgeDays} days (Site settings → research data max age).
        </p>
      </div>
      {seeds.length ? (
        <ul className="seed-list" aria-label="Seed backlog">
          {seeds.map((s) => (
            <li key={s.id} className="seed" data-next={s.next ? "" : undefined} data-status={s.status}>
              <p className="seed-name">
                {s.seed}
                {s.next ? <Badge tone="ion">Up next</Badge> : null}
                {s.status === "researched" ? <Badge tone="info">Researched</Badge> : s.status === "skipped" ? <Badge>Skipped</Badge> : null}
                {s.priority ? <Badge tone="amber">{PRIORITY[s.priority]}</Badge> : null}
              </p>
              <p className="seed-meta">
                {s.lastResearchedAt ? `Last researched ${date(s.lastResearchedAt)} · ${s.count}×${s.freshUntil ? ` · fresh until ${date(s.freshUntil)}` : " · stale: may be researched again"}` : "Never researched"}
              </p>
              {canEdit ? (
                <div className="seed-acts">
                  {s.status !== "skipped" && (!s.freshUntil || s.next) ? (
                    <Link className="btn btn-ghost btn-sm" href={`?seed=${encodeURIComponent(s.seed)}#research`}>
                      <span className="btn-label">
                        <Icon name="search" /> Research
                      </span>
                    </Link>
                  ) : null}
                  <select className="inp sel inp-sm" aria-label={`Priority of ${s.seed}`} value={String(s.priority)} disabled={busy} onChange={(e) => act(updateSeedAction(slug, siteId, s.id, { priority: Number(e.target.value) }))}>
                    {PRIORITY.map((l, i) => (
                      <option key={l} value={i}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(updateSeedAction(slug, siteId, s.id, { status: s.status === "skipped" ? "queued" : "skipped" }))}>
                    {s.status === "skipped" ? "Requeue" : "Skip"}
                  </Button>
                  <Button size="sm" variant="ghost" icon="trash" disabled={busy} aria-label={`Remove ${s.seed}`} onClick={() => act(deleteSeedAction(slug, siteId, s.id))} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rp-idle">
          <Icon name="key" />
          <p>The backlog is empty. Add the broad topics this site should own; research rotates through them.</p>
        </div>
      )}
    </div>
  );
}
