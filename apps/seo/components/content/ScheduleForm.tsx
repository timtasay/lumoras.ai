"use client";

import { useActionState, useMemo, useState } from "react";
import { Icon } from "@/components/Icons";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "@/components/forms/FormBits";
import { Button } from "@/components/ui/Button";
import { Checkbox, SelectField, TextField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";
import { AUTOPILOT_WARNING, BACKDATING_WARNING, describeSchedule, generationWakeAt, isoWeekday, localParts, nextSlots, WEEKDAY_LABEL } from "@/lib/content/schedule";

export type ScheduleDefaults = {
  days: number[];
  time: string;
  active: boolean;
  generationMode: "rolling" | "batch";
  leadDays: number;
  batchSize: number;
  horizonDays: number;
  runwayThreshold: number;
  reviewMode: "approval" | "autopilot";
  allowBackdating: boolean;
  timezone: string;
  autopilotSince: string | null;
};

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The site's publishing rules (site settings, onboarding step 8): the weekly
 * schedule, how far ahead each article is written, the review gate, back-dating
 * and the runway threshold. Autopilot and back-dating each need a ticked
 * acknowledgement next to their warning; the server checks it again.
 */
export function ScheduleForm({ action, defaults, readOnly, submitLabel = "Save schedule" }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; defaults: ScheduleDefaults; readOnly: boolean; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, idle);
  const fe = state.fieldErrors ?? {};
  const [days, setDays] = useState<number[]>(defaults.days);
  const [time, setTime] = useState(defaults.time);
  const [mode, setMode] = useState(defaults.generationMode);
  const [lead, setLead] = useState(String(defaults.leadDays));
  const [review, setReview] = useState(defaults.reviewMode);
  const [backdate, setBackdate] = useState(defaults.allowBackdating);
  const [active, setActive] = useState(defaults.active);
  const tz = defaults.timezone;
  const preview = useMemo(() => {
    if (!days.length || !/^\d{2}:\d{2}$/.test(time)) return [];
    try {
      return nextSlots({ days, time, timezone: tz }, new Date(), 4).map((d) => {
        const l = localParts(d, tz);
        const w = localParts(generationWakeAt(d, Math.max(0, Number(lead) || 0), tz), tz);
        return { at: `${DAY_SHORT[isoWeekday(l.date)]} ${l.date} ${l.time}`, wake: w.date };
      });
    } catch {
      return [];
    }
  }, [days, time, tz, lead]);
  const toggle = (d: number) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort()));
  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="sched-form" noValidate>
      {readOnly ? <ReadOnlyNote>Your role can see the schedule. Editors and owners change it.</ReadOnlyNote> : null}
      <ActionFeedback state={state} />
      <fieldset className="sched-set" disabled={readOnly}>
        <legend className="sub-h">When articles go out</legend>
        <Checkbox name="active" label="Publish on this schedule" hint="Off: no new slots are laid out and nothing new is written." checked={active} onChange={(e) => setActive(e.target.checked)} />
        <div className="fld">
          <span className="fld-label" id="days-l">
            Weekdays
          </span>
          <div className="day-picks" role="group" aria-labelledby="days-l">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="day-pick" data-on={days.includes(d) ? "" : undefined}>
                <input type="checkbox" name="days" value={d} checked={days.includes(d)} onChange={() => toggle(d)} />
                <span aria-hidden="true">{DAY_SHORT[d]}</span>
                <span className="sr-only">{WEEKDAY_LABEL[d]}</span>
              </label>
            ))}
          </div>
          {fe.days ? (
            <p className="fld-err">
              <Icon name="alert" />
              {fe.days}
            </p>
          ) : null}
        </div>
        <div className="form-grid">
          <TextField label={`Time (${tz.replace(/_/g, " ")})`} name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={fe.time} />
          <TextField label="Runway alert below (days)" name="runwayThreshold" type="number" min={1} max={120} defaultValue={defaults.runwayThreshold} hint="Owners and editors are emailed when fewer days are covered." error={fe.runwayThreshold} />
        </div>
        <p className="small muted" aria-live="polite">
          {days.length ? `Publishes ${describeSchedule({ days, time: time || "09:00", timezone: tz })}.` : "Pick at least one weekday."}
        </p>
      </fieldset>

      <fieldset className="sched-set" disabled={readOnly}>
        <legend className="sub-h">When articles are written</legend>
        <div className="form-grid">
          <SelectField
            label="Generation"
            name="generationMode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "rolling" | "batch")}
            options={[
              { value: "rolling", label: "Rolling: each slot a few days ahead (recommended)" },
              { value: "batch", label: "Batch: several slots at once" },
            ]}
            hint={mode === "rolling" ? "The topic is chosen close to the date, from the latest rankings and Search Console data." : "Batch writes further ahead; topics react less to new data."}
          />
          <TextField label="Written this many days before the slot" name="leadDays" type="number" min={0} max={30} value={lead} onChange={(e) => setLead(e.target.value)} error={fe.leadDays} />
          {mode === "batch" ? <TextField label="Articles per batch" name="batchSize" type="number" min={1} max={20} defaultValue={defaults.batchSize} error={fe.batchSize} /> : <input type="hidden" name="batchSize" value={defaults.batchSize} />}
          <TextField label="Plan slots this many days ahead" name="horizonDays" type="number" min={7} max={120} defaultValue={defaults.horizonDays} error={fe.horizonDays} />
        </div>
        {preview.length ? (
          <ol className="slot-preview" aria-label="The next four slots">
            {preview.map((p) => (
              <li key={p.at}>
                <span className="mono">{p.at}</span>
                <span className="small muted">written {p.wake}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </fieldset>

      <fieldset className="sched-set" disabled={readOnly}>
        <legend className="sub-h">Review</legend>
        <div className="radio-cards" role="radiogroup" aria-label="Review mode">
          <label className="radio-card" data-on={review === "approval" ? "" : undefined}>
            <input type="radio" name="reviewMode" value="approval" checked={review === "approval"} onChange={() => setReview("approval")} />
            <span>
              <strong>Approval required</strong>
              <span className="small muted">A reviewer, editor or owner approves each article. Nothing goes live unread. (Default)</span>
            </span>
          </label>
          <label className="radio-card" data-on={review === "autopilot" ? "" : undefined} data-tone="amber">
            <input type="radio" name="reviewMode" value="autopilot" checked={review === "autopilot"} onChange={() => setReview("autopilot")} />
            <span>
              <strong>Autopilot</strong>
              <span className="small muted">Publishes when lint and fact-check pass, without a person.</span>
            </span>
          </label>
        </div>
        {review === "autopilot" ? (
          <div className="warn-box" role="note">
            <p>
              <Icon name="alert" /> {AUTOPILOT_WARNING}
            </p>
            {defaults.autopilotSince ? <p className="small muted">On since {defaults.autopilotSince}.</p> : null}
            <Checkbox name="autopilotAck" label="I understand: articles will publish without anyone reading them." defaultChecked={defaults.reviewMode === "autopilot"} />
            {fe.autopilotAck ? (
              <p className="fld-err">
                <Icon name="alert" />
                {fe.autopilotAck}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="sched-set" disabled={readOnly}>
        <legend className="sub-h">Dates</legend>
        <Checkbox name="allowBackdating" label="Allow back-dating" hint="Off: an article is never dated before the day it was written, and never moved into the past." checked={backdate} onChange={(e) => setBackdate(e.target.checked)} />
        {backdate ? (
          <div className="warn-box" role="note">
            <p>
              <Icon name="alert" /> {BACKDATING_WARNING}
            </p>
            <Checkbox name="backdatingAck" label="I understand the risk to datePublished." defaultChecked={defaults.allowBackdating} />
            {fe.backdatingAck ? (
              <p className="fld-err">
                <Icon name="alert" />
                {fe.backdatingAck}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      {readOnly ? null : (
        <div className="form-acts">
          <Button type="submit" variant="primary" icon="check" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
