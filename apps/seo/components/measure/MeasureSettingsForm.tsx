"use client";

import { useActionState } from "react";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "@/components/forms/FormBits";
import { Button } from "@/components/ui/Button";
import { Checkbox, SelectField, TextField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";

export type MeasureDefaults = {
  rankCadence: string;
  rankDevice: string;
  rankDepth: number;
  rankMaxKeywords: number;
  auditCadence: string;
  auditMaxPages: number;
  backlinksCadence: string;
  searchSync: boolean;
  inspectDailyCap: number;
};

/**
 * How often measurement runs for this site. Paid work (rank checks, audits,
 * backlinks) is priced first and refused below the workspace's reserve on
 * every run; Search Console and GA4 are free and sync daily while connected.
 */
export function MeasureSettingsForm({ action, defaults, readOnly, estimate }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; defaults: MeasureDefaults; readOnly: boolean; estimate: string | null }) {
  const [state, formAction, pending] = useActionState(action, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="measure-form" noValidate>
      {readOnly ? <ReadOnlyNote>Your role can see the measurement settings. Editors and owners change them.</ReadOnlyNote> : null}
      <ActionFeedback state={state} />
      <fieldset className="form-grid" disabled={readOnly} aria-label="Measurement cadences">
        <h3 className="sub-h span-2 mset-h">Rank tracking (paid)</h3>
        <SelectField label="How often" name="rankCadence" defaultValue={defaults.rankCadence} error={fe.rankCadence} hint={estimate ? `A check now would cost about ${estimate} at list prices.` : "Every published article's keyword, plus saved keywords marked targeted."} options={[{ value: "weekly", label: "Weekly (default)" }, { value: "fortnightly", label: "Every two weeks" }, { value: "monthly", label: "Monthly" }, { value: "daily", label: "Daily" }, { value: "off", label: "Off" }]} />
        <SelectField label="Device" name="rankDevice" defaultValue={defaults.rankDevice} options={[{ value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }]} />
        <SelectField label="Depth" name="rankDepth" defaultValue={String(defaults.rankDepth)} error={fe.rankDepth} hint="How deep in the results to look; deeper costs more." options={[10, 20, 30, 50, 100].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
        <TextField label="Most keywords per check" name="rankMaxKeywords" type="number" inputMode="numeric" min={1} max={1000} defaultValue={defaults.rankMaxKeywords} error={fe.rankMaxKeywords} hint="Published keywords first, then saved ones by volume." />
        <h3 className="sub-h span-2 mset-h">Site audit and backlinks (paid)</h3>
        <SelectField label="Site audit" name="auditCadence" defaultValue={defaults.auditCadence} options={[{ value: "monthly", label: "Monthly (default)" }, { value: "quarterly", label: "Quarterly" }, { value: "off", label: "Off" }]} />
        <TextField label="Pages per audit" name="auditMaxPages" type="number" inputMode="numeric" min={10} max={10000} defaultValue={defaults.auditMaxPages} error={fe.auditMaxPages} />
        <SelectField label="Backlinks snapshot" name="backlinksCadence" defaultValue={defaults.backlinksCadence} hint="The site and up to five brand-profile competitors." options={[{ value: "quarterly", label: "Quarterly (default)" }, { value: "monthly", label: "Monthly" }, { value: "off", label: "Off" }]} />
        <span aria-hidden="true" />
        <h3 className="sub-h span-2 mset-h">Search Console and GA4 (free)</h3>
        <div className="span-2">
          <Checkbox name="searchSync" label="Sync Search Console and GA4 daily, and inspect new URLs" hint="Read-only. Turning this off stops the daily syncs; the stored data stays." defaultChecked={defaults.searchSync} />
        </div>
        <TextField label="URL inspections per day" name="inspectDailyCap" type="number" inputMode="numeric" min={0} max={200} defaultValue={defaults.inspectDailyCap} error={fe.inspectDailyCap} hint="Google allows 2,000 a day per property; new articles go first." />
      </fieldset>
      {readOnly ? null : (
        <div className="form-acts">
          <Button type="submit" variant="primary" loading={pending}>
            Save measurement settings
          </Button>
        </div>
      )}
    </form>
  );
}
