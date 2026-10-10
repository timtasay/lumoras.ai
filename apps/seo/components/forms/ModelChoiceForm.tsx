"use client";

import { useActionState } from "react";
import { ActionFeedback, submitKeepingValues } from "@/components/forms/FormBits";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";

export type ModelOption = { id: string; label: string };
export type StepRow = { key: string; label: string; hint: string; current: string; defaultModel: string };


/**
 * One select per pipeline step. "Default" keeps the env model for that step
 * (LLM_MODEL_DRAFT or LLM_MODEL_REVIEW); a choice applies from the next step.
 */
export function ModelChoiceForm({ action, steps, options }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; steps: StepRow[]; options: ModelOption[] }) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="form-grid" noValidate>
      <ActionFeedback state={state} />
      {steps.map((s) => (
        <SelectField
          key={s.key}
          label={s.label}
          name={s.key}
          defaultValue={s.current}
          hint={s.hint}
          error={state.fieldErrors?.[s.key]}
          options={[{ value: "", label: `Default (${s.defaultModel})` }, ...options.map((o) => ({ value: o.id, label: o.label }))]}
        />
      ))}
      <div className="form-acts span-2">
        <Button type="submit" variant="primary" icon="check" loading={pending}>
          Save models
        </Button>
      </div>
    </form>
  );
}
