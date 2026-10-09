"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, submitKeepingValues } from "./FormBits";

export function RenameWorkspace({ name, canEdit, action }: { name: string; canEdit: boolean; action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, act, pending] = useActionState(action, idle);
  return (
    <form action={act} onSubmit={submitKeepingValues(act)} className="rename" noValidate>
      <ActionFeedback state={state} />
      <TextField label="Workspace name" name="name" defaultValue={name} disabled={!canEdit} error={state.fieldErrors?.name} hint={canEdit ? undefined : "Owners can rename the workspace."} />
      {canEdit ? (
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Rename
        </Button>
      ) : null}
    </form>
  );
}
