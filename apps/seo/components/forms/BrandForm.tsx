"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/Icons";
import { Button, IconButton } from "@/components/ui/Button";
import { TextareaField, TextField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "./FormBits";

export type BrandValues = {
  overview: string;
  current_goal: string;
  positioning: string;
  audience: string;
  sells: string[];
  does_not_sell: string[];
  competitors: string[];
  key_pages: { url: string; title: string; description: string }[];
  product_facts: string[];
  forbidden_claims: string[];
  voice_rules: string[];
  seo_rules: Record<string, number>;
  banned_words: string[];
  example_articles: string[];
  prefilled_at: string | null;
};

const SEO_FIELDS: [string, string, string][] = [
  ["titleMax", "Title, max characters", ""],
  ["descriptionMin", "Description, min characters", ""],
  ["descriptionMax", "Description, max characters", ""],
  ["bodyMinWords", "Body, min words", ""],
  ["bodyMaxWords", "Body, max words", ""],
  ["internalLinksMin", "Internal links, min", ""],
  ["internalLinksMax", "Internal links, max", ""],
];

function Section({ n, title, text, children }: { n: number; title: string; text: string; children: React.ReactNode }) {
  const id = `bf-${n}`;
  return (
    <fieldset className="bf-sec panel" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <div className="bf-head">
        <span className="mono bf-n" aria-hidden="true">
          {String(n).padStart(2, "0")}
        </span>
        <div>
          <h3 className="bf-title" id={`${id}-t`}>
            {title}
          </h3>
          <p className="bf-text" id={`${id}-d`}>
            {text}
          </p>
        </div>
      </div>
      <div className="bf-body">{children}</div>
    </fieldset>
  );
}

/**
 * The brand profile (build prompt section 6): what the pipeline writes from.
 * List fields are one item per line. Everything here is data the client owns:
 * the crawl only pre-fills empty fields.
 */
export function BrandForm({
  action,
  values,
  readOnly,
  submitLabel = "Save brand profile",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  values: BrandValues;
  readOnly: boolean;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const [pages, setPages] = useState(() =>
    (values.key_pages.length ? values.key_pages : [{ url: "", title: "", description: "" }]).map((p, i) => ({ ...p, id: i })),
  );
  const [nextId, setNextId] = useState(values.key_pages.length + 1);
  const fe = state.fieldErrors ?? {};
  const err = (k: string) => fe[k] ?? Object.entries(fe).find(([key]) => key.startsWith(`${k}.`))?.[1];
  const lines = (xs: string[]) => xs.join("\n");
  const dis = readOnly;

  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="bf" noValidate>
      {readOnly ? <ReadOnlyNote>Your role can read the brand profile. Editors and owners can change it.</ReadOnlyNote> : null}
      {values.prefilled_at ? (
        <p className="prefill-note">
          <Icon name="sparkle" />
          <span>
            Pre-filled from the site&apos;s own pages (titles and descriptions only, no AI). Correct anything that is not how you would say it.
          </span>
        </p>
      ) : null}
      <ActionFeedback state={state} />

      <Section n={1} title="The business" text="What the company is, what it is trying to achieve now, and who it serves.">
        <TextareaField label="Business overview" name="overview" rows={4} defaultValue={values.overview} error={err("overview")} disabled={dis} />
        <TextareaField label="Current goal" name="currentGoal" rows={2} defaultValue={values.current_goal} placeholder="Fill evening appointment slots in Q4" error={err("currentGoal")} disabled={dis} />
        <TextareaField label="Positioning" name="positioning" rows={2} defaultValue={values.positioning} error={err("positioning")} disabled={dis} />
        <TextareaField label="Audience" name="audience" rows={2} defaultValue={values.audience} error={err("audience")} disabled={dis} />
      </Section>

      <Section n={2} title="What we sell, and what we do not" text="Topic selection only writes about the first list and never about the second.">
        <div className="bf-two">
          <TextareaField label="What we sell" name="sells" rows={5} defaultValue={lines(values.sells)} hint="One per line." error={err("sells")} disabled={dis} />
          <TextareaField label="What we do not sell" name="doesNotSell" rows={5} defaultValue={lines(values.does_not_sell)} hint="One per line. Never written about, however good the keyword looks." error={err("doesNotSell")} disabled={dis} />
        </div>
      </Section>

      <Section n={3} title="Claims" text="Facts the writer may state, and claims it must never make. Every claim is still fact-checked against a primary source.">
        <div className="bf-two">
          <TextareaField label="Product facts that may be stated" name="productFacts" rows={5} defaultValue={lines(values.product_facts)} hint="One per line." error={err("productFacts")} disabled={dis} />
          <TextareaField label="Forbidden claims" name="forbiddenClaims" rows={5} defaultValue={lines(values.forbidden_claims)} hint="One per line." error={err("forbiddenClaims")} disabled={dis} />
        </div>
      </Section>

      <Section n={4} title="Market" text="Competitors to watch, the pages that matter most, and articles whose style to follow.">
        <TextareaField label="Competitors" name="competitors" rows={3} defaultValue={lines(values.competitors)} hint="Domains, one per line." error={err("competitors")} disabled={dis} />
        <div className="kp">
          <p className="fld-label" id="kp-label">
            Key pages
          </p>
          <ul className="kp-list" aria-labelledby="kp-label">
            {pages.map((p, i) => (
              <li key={p.id} className="kp-row">
                <TextField label={`Page ${i + 1} address`} name="keyPageUrl" defaultValue={p.url} placeholder="https://example.com/pricing" error={fe[`keyPages.${i}.url`]} disabled={dis} />
                <TextField label="Title" name="keyPageTitle" defaultValue={p.title} disabled={dis} />
                <TextField label="Description" name="keyPageDescription" defaultValue={p.description} disabled={dis} />
                {dis ? null : <IconButton icon="trash" label={`Remove page ${i + 1}`} onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))} />}
              </li>
            ))}
          </ul>
          {dis || pages.length >= 30 ? null : (
            <Button size="sm" variant="ghost" icon="plus" onClick={() => {
                setPages((ps) => [...ps, { url: "", title: "", description: "", id: nextId }]);
                setNextId((n) => n + 1);
              }}>
              Add a key page
            </Button>
          )}
        </div>
        <TextareaField label="Example articles" name="exampleArticles" rows={3} defaultValue={lines(values.example_articles)} hint="Full https:// addresses, one per line." error={err("exampleArticles")} disabled={dis} />
      </Section>

      <Section n={5} title="Voice" text="Writing rules are data, not code: the lint step enforces them on every draft.">
        <TextareaField label="Voice rules" name="voiceRules" rows={5} defaultValue={lines(values.voice_rules)} placeholder={"Plain, direct, second person\nNo em-dash asides\nNo emoji"} hint="One per line." error={err("voiceRules")} disabled={dis} />
        <TextareaField label="Banned words" name="bannedWords" rows={2} defaultValue={values.banned_words.join(", ")} placeholder="revolutionary, seamless, cutting-edge" hint="Comma or line separated." error={err("bannedWords")} disabled={dis} />
      </Section>

      <Section n={6} title="SEO rules" text="Length and link limits every article must meet.">
        <div className="bf-seo">
          {SEO_FIELDS.map(([k, label, hint]) => (
            <TextField key={k} label={label} name={`seo.${k}`} type="number" inputMode="numeric" defaultValue={values.seo_rules[k]} hint={hint || undefined} error={fe[`seoRules.${k}`]} disabled={dis} />
          ))}
        </div>
      </Section>

      {readOnly ? null : (
        <div className="form-acts sticky-acts">
          <Button type="submit" variant="primary" size="lg" loading={pending} icon="check">
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
