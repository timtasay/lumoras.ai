"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, submitKeepingValues } from "./FormBits";

export const LOCALES = ["en-US", "en-GB", "en-CA", "en-AU", "es-US", "es-ES", "fr-FR", "fr-CA", "de-DE", "it-IT", "nl-NL", "pt-BR"];
export const COUNTRIES: [string, string][] = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["IE", "Ireland"], ["NZ", "New Zealand"],
  ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"], ["BR", "Brazil"], ["MX", "Mexico"],
];
export const INDUSTRIES = ["Salons and spas", "Restaurants", "Dental and medical", "Home services", "Retail", "Professional services", "Software", "Hospitality", "Fitness", "Automotive"];

export type SiteDefaults = { domain?: string; name?: string; industry?: string; locale?: string; country?: string; serpLocation?: string; timezone?: string };

/**
 * Site details. Creating: domain (normalised server-side: scheme, www and paths
 * are stripped) plus the market settings. Editing: everything but the domain.
 */
export function SiteForm({
  action,
  timezones,
  defaults = {},
  mode,
  readOnly = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  timezones: string[];
  defaults?: SiteDefaults;
  mode: "create" | "onboarding" | "edit";
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const [name, setName] = useState(defaults.name ?? "");
  const [touchedName, setTouchedName] = useState(!!defaults.name);
  const fe = state.fieldErrors ?? {};
  const guessName = (d: string) => {
    const host = d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/:?#]/)[0] ?? "";
    const label = host.split(".")[0] ?? "";
    return label ? label.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  };
  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="form-grid" noValidate>
      <ActionFeedback state={state} />
      {mode !== "edit" ? (
        <TextField
          className="span-2"
          label="Domain"
          name="domain"
          placeholder="example.com"
          autoComplete="url"
          inputMode="url"
          required
          defaultValue={defaults.domain}
          hint="The site's address. We read its robots.txt and sitemaps to build the route inventory."
          error={fe.domain}
          onChange={(e) => {
            if (!touchedName) setName(guessName(e.target.value));
          }}
        />
      ) : null}
      <TextField
        label="Site name"
        name="name"
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setTouchedName(true);
        }}
        placeholder="Northwind Dental"
        error={fe.name}
        disabled={readOnly}
      />
      <TextField label="Industry" name="industry" list="industries" defaultValue={defaults.industry} placeholder="Dental and medical" error={fe.industry} disabled={readOnly} />
      <datalist id="industries">
        {INDUSTRIES.map((i) => (
          <option key={i} value={i} />
        ))}
      </datalist>
      <SelectField label="Language" name="locale" defaultValue={defaults.locale ?? "en-US"} options={LOCALES.map((l) => ({ value: l, label: l }))} error={fe.locale} disabled={readOnly} />
      <SelectField label="Country" name="country" defaultValue={defaults.country ?? "US"} options={COUNTRIES.map(([v, l]) => ({ value: v, label: l }))} error={fe.country} disabled={readOnly} />
      <TextField
        label="Search location"
        name="serpLocation"
        defaultValue={defaults.serpLocation ?? "United States"}
        hint="Where rankings are measured (Phase 2 uses it for keyword data)."
        error={fe.serpLocation}
        disabled={readOnly}
      />
      <SelectField
        label="Time zone"
        name="timezone"
        defaultValue={defaults.timezone ?? "UTC"}
        options={timezones.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
        hint="Publishing slots are scheduled in this time zone."
        error={fe.timezone}
        disabled={readOnly}
      />
      {readOnly ? null : (
        <div className="form-acts span-2">
          <Button type="submit" variant="primary" size={mode === "edit" ? "md" : "lg"} loading={pending} icon={mode === "edit" ? "check" : undefined} iconRight={mode === "edit" ? undefined : "arrow"}>
            {mode === "edit" ? "Save site details" : mode === "onboarding" ? "Add the site and scan it" : "Add the site"}
          </Button>
        </div>
      )}
    </form>
  );
}
