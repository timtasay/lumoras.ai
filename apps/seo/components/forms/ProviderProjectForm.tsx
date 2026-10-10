"use client";

import { useActionState } from "react";
import { ActionFeedback, submitKeepingValues } from "@/components/forms/FormBits";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";

/**
 * The OpenSEO project this site's research runs in (owner decision #3:
 * OpenSEO on the owner's hosted account). Empty: the default project
 * (OPENSEO_PROJECT_ID), else one found or created for the site's domain.
 */
export function ProviderProjectForm({ action, value, readOnly, fallback }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; value: string | null; readOnly: boolean; fallback: string }) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="form-grid" noValidate>
      <ActionFeedback state={state} />
      <TextField
        label="OpenSEO project id (optional)"
        name="projectId"
        defaultValue={value ?? ""}
        placeholder="from list_projects in OpenSEO"
        autoComplete="off"
        spellCheck={false}
        readOnly={readOnly}
        hint={`Empty: ${fallback}.`}
        error={state.fieldErrors?.projectId}
      />
      {readOnly ? null : (
        <div className="form-acts">
          <Button type="submit" variant="secondary" icon="check" loading={pending}>
            Save project
          </Button>
        </div>
      )}
    </form>
  );
}
