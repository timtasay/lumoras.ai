"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { respondToInvitation } from "./actions";

export function InvitationActions({ id, workspace }: { id: string; workspace: string }) {
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<"accept" | "decline" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (accept: boolean) => {
    setChoice(accept ? "accept" : "decline");
    start(async () => {
      const r = await respondToInvitation(id, accept);
      if (r) setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Something went wrong.") });
    });
  };
  if (msg?.ok) return <p role="status">{msg.text}</p>;
  return (
    <div className="inv-acts">
      {msg ? (
        <p className="form-alert" role="alert">
          {msg.text}
        </p>
      ) : null}
      <Button variant="primary" size="lg" icon="check" loading={pending && choice === "accept"} disabled={pending} onClick={() => run(true)}>
        Accept and open {workspace}
      </Button>
      <Button variant="ghost" loading={pending && choice === "decline"} disabled={pending} onClick={() => run(false)}>
        Decline
      </Button>
    </div>
  );
}
