"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "./Icons";
import { DEMO_LINE } from "@/lib/site";
import {
  INDUSTRY_OPTIONS,
  INTEREST_OPTIONS,
  LOCATION_OPTIONS,
  validateDemo,
  type DemoErrors,
  type DemoRequest,
} from "@/lib/demo";

const ORDER: (keyof DemoRequest)[] = ["name", "email", "company", "locations", "industry"];

function joinList(xs: string[]) {
  if (xs.length < 2) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function DemoForm({ headingLevel = "h2", title = "Book a demo" }: { headingLevel?: "h2" | "h3"; title?: string }) {
  const H = headingLevel;
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const okRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<DemoErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [summary, setSummary] = useState<{ title: string; text: string } | null>(null);
  const id = (k: string) => `${uid}-${k}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = {
      name: fd.get("name"),
      email: fd.get("email"),
      company: fd.get("company"),
      locations: fd.get("locations"),
      industry: fd.get("industry"),
      interests: fd.getAll("interests"),
    };
    const { value, errors: errs } = validateDemo(raw);
    setErrors(errs);
    const firstBad = ORDER.find((k) => errs[k]);
    if (firstBad) {
      form.querySelector<HTMLElement>(`[name="${firstBad}"]`)?.focus();
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...value, website: fd.get("website") ?? "" }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; errors?: DemoErrors };
      if (!res.ok || !json.ok) {
        if (json.errors) setErrors(json.errors);
        setStatus("error");
        return;
      }
      const first = value.name.split(/\s+/)[0];
      const what = value.interests.length ? ` of ${joinList(value.interests)}` : "";
      setSummary({
        title: `Thanks, ${first}. You're on the schedule.`,
        text: `We'll reach out to ${value.email} to set up a walkthrough${what} for ${value.company} (${value.locations} ${value.locations === "1" ? "location" : "locations"}). Want to hear it now? Call ${DEMO_LINE}.`,
      });
      setStatus("done");
      requestAnimationFrame(() => okRef.current?.focus());
    } catch {
      setStatus("error");
    }
  }

  function reset() {
    formRef.current?.reset();
    setErrors({});
    setSummary(null);
    setStatus("idle");
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  }

  const fieldProps = (k: keyof DemoRequest) => ({
    id: id(k),
    name: k,
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? id(`${k}-err`) : undefined,
    onChange: () => errors[k] && setErrors((e) => ({ ...e, [k]: undefined })),
  });
  const err = (k: keyof DemoRequest) =>
    errors[k] ? (
      <span className="ferr" id={id(`${k}-err`)}>
        {errors[k]}
      </span>
    ) : null;

  return (
    <div className="form glass">
      <form ref={formRef} onSubmit={onSubmit} noValidate hidden={status === "done"} aria-labelledby={id("title")}>
        <H className="form-title" id={id("title")}>{title}</H>
        <p className="sub">Tell us a little about your business. We&apos;ll tailor the walkthrough.</p>
        <div className="fgrid">
          <div className="field">
            <label htmlFor={id("name")}>Full name</label>
            <input {...fieldProps("name")} autoComplete="name" required placeholder="Jordan Avery" />
            {err("name")}
          </div>
          <div className="field">
            <label htmlFor={id("email")}>Work email</label>
            <input {...fieldProps("email")} type="email" autoComplete="email" required placeholder="you@company.com" />
            {err("email")}
          </div>
          <div className="field">
            <label htmlFor={id("company")}>Company</label>
            <input {...fieldProps("company")} autoComplete="organization" required placeholder="Company name" />
            {err("company")}
          </div>
          <div className="field">
            <label htmlFor={id("locations")}>Locations</label>
            <select {...fieldProps("locations")} defaultValue="1" required>
              {LOCATION_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {err("locations")}
          </div>
          <div className="field full">
            <label htmlFor={id("industry")}>Industry</label>
            <select {...fieldProps("industry")} defaultValue="" required>
              <option value="" disabled>Choose your industry</option>
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {err("industry")}
          </div>
          <fieldset className="field full">
            <legend className="legend">Interested in</legend>
            <div className="chkrow">
              {INTEREST_OPTIONS.map((o) => (
                <label className="chk" key={o}>
                  <input type="checkbox" name="interests" value={o} defaultChecked={o === "Voice"} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="hp" aria-hidden="true">
            <label htmlFor={id("website")}>Website</label>
            <input id={id("website")} name="website" tabIndex={-1} autoComplete="off" />
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Request a demo"} <Icon name="arrow" />
        </button>
        <p className="fine" role="alert">
          {status === "error" ? "Something went wrong sending your request. Please try again, or call the live demo line." : ""}
        </p>
      </form>
      <div className="ok-msg" ref={okRef} hidden={status !== "done"} tabIndex={-1} role="status">
        <div className="ok-mark">
          <Icon name="check" />
        </div>
        <p className="ok-title">{summary?.title}</p>
        <p>{summary?.text}</p>
        <button className="btn" type="button" onClick={reset}>
          Send another request
        </button>
      </div>
    </div>
  );
}
