"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";
import { ActionFeedback, submitKeepingValues } from "@/components/forms/FormBits";
import { idle } from "@/lib/actions-state";
import { slugify } from "@/lib/validation-client";
import { createWorkspaceAction } from "./actions";

export function WorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, idle);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="form-grid" noValidate>
      <ActionFeedback state={state} />
      <TextField
        className="span-2"
        label="Workspace name"
        name="name"
        required
        autoFocus
        placeholder="Northwind Dental"
        hint="Usually the client's business name. You can rename it later."
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!touched) setSlug(slugify(e.target.value));
        }}
        error={fe.name}
      />
      <TextField
        className="span-2 slug-field"
        label="Address"
        name="slug"
        required
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value.toLowerCase());
          setTouched(true);
        }}
        hint={`Lowercase letters, numbers and dashes. The workspace lives at /w/${slug || "your-name"}.`}
        error={fe.slug}
        spellCheck={false}
      />
      <div className="form-acts span-2">
        <Button type="submit" variant="primary" size="lg" iconRight="arrow" loading={pending}>
          Create the workspace
        </Button>
      </div>
    </form>
  );
}
