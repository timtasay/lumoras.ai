import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, Icon } from "@/components/Icons";
import { FieldBackdrop } from "@/components/FieldBackdrop";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { PRODUCT_NAME } from "@/components/shell/nav";
import { STEPS, stepIndex, type StepKey } from "@/lib/onboarding";

/**
 * Onboarding: the particle field behind a glass panel, with the step rail on
 * top. Steps already reached are links (to go back and correct); "coming
 * next" steps are marked with their phase.
 */
export function OnboardingFrame({
  step,
  reached,
  slug,
  workspaceName,
  title,
  lede,
  children,
  wide = false,
}: {
  step: StepKey;
  /** furthest step reached so far */
  reached: StepKey;
  slug?: string;
  workspaceName?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const cur = stepIndex(step);
  const far = Math.max(stepIndex(reached), cur);
  return (
    <div className="onb">
      <div className="onb-field" aria-hidden="true">
        <FieldBackdrop form={cur % 4} />
      </div>
      <header className="onb-top">
        <Link href="/" className="side-brand">
          <BrandMark size={26} />
          <span>{PRODUCT_NAME}</span>
        </Link>
        <span className="onb-ws">{workspaceName ? `Setting up ${workspaceName}` : "New workspace"}</span>
        <ThemeToggle />
        {slug ? (
          <Link href={`/w/${slug}`} className="btn btn-ghost btn-sm">
            <span className="btn-label">Finish later</span>
          </Link>
        ) : null}
      </header>
      <nav className="onb-rail" aria-label="Onboarding steps">
        <ol>
          {STEPS.map((s, i) => {
            const state = i === cur ? "current" : i < far ? "done" : "todo";
            const href = s.key === "workspace" ? null : slug && i <= far && i !== cur ? `/w/${slug}/onboarding/${s.key}` : null;
            const inner = (
              <>
                <span className="onb-dot" aria-hidden="true">
                  {state === "done" ? <Icon name="check" /> : i + 1}
                </span>
                <span className="onb-label">
                  {s.label}
                  {s.later ? <small>Phase {s.later}</small> : null}
                </span>
              </>
            );
            return (
              <li key={s.key} data-state={state} data-later={s.later ? "" : undefined}>
                {href ? (
                  <Link href={href} className="onb-step">
                    {inner}
                  </Link>
                ) : (
                  <span className="onb-step" aria-current={state === "current" ? "step" : undefined}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="sr-only">
          Step {cur + 1} of {STEPS.length}: {STEPS[cur].label}
        </p>
      </nav>
      <main id="main" tabIndex={-1} className="onb-main">
        <div className={wide ? "onb-glass glass wide" : "onb-glass glass"}>
          <p className="eyebrow">
            <b>Step {cur + 1}</b> of {STEPS.length}
          </p>
          <h1 className="onb-title">{title}</h1>
          {lede ? <p className="onb-lede">{lede}</p> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
