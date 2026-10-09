"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";
import type { ActionState } from "@/lib/actions-state";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/Icons";

/** Announces an action's outcome: a toast on success, an inline alert (focused) on failure. */
export function ActionFeedback({ state }: { state: ActionState }) {
  const toast = useToast();
  const ref = useRef<HTMLParagraphElement>(null);
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.at || state.at === seen.current) return;
    seen.current = state.at;
    if (state.ok && state.message) toast.push({ tone: "ok", title: state.message });
    if (!state.ok && state.error) ref.current?.focus();
  }, [state, toast]);
  if (state.ok || !state.error) return null;
  return (
    <p className="form-alert" role="alert" tabIndex={-1} ref={ref}>
      <Icon name="alert" />
      {state.error}
    </p>
  );
}

/** A read-only notice for roles that cannot change this section. */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="ro-note">
      <Icon name="lock" />
      {children}
    </p>
  );
}

/**
 * Submits a form to a useActionState action WITHOUT React's automatic form
 * reset, so a validation error keeps what the person typed. (The form keeps its
 * `action` too, for submits before hydration.) Forms that should clear after a
 * success remount with key={state.at}.
 */
export function submitKeepingValues(formAction: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
}
