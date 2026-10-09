"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import type { ActionState } from "@/lib/actions-state";

/** Danger zone: deleting a site removes its brand profile, authors, routes and connections (the audit trail stays). */
export function DeleteSite({ domain, action }: { domain: string; action: (confirm: string) => Promise<ActionState> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="panel pad danger-zone" aria-labelledby="danger-h">
      <div>
        <h2 id="danger-h" className="sub-h">
          Delete this site
        </h2>
        <p className="muted small">Removes its brand profile, authors, route inventory and connections. The audit log keeps the record.</p>
      </div>
      <Button variant="danger" icon="trash" onClick={() => setOpen(true)}>
        Delete site…
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Delete ${domain}?`}
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={typed.trim().toLowerCase() !== domain}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await action(typed);
                  if (r && !r.ok) setError(r.error ?? "Could not delete.");
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <TextField label={`Type ${domain} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} error={error ?? undefined} />
      </Modal>
    </section>
  );
}
