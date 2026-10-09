"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Popover } from "@/components/ui/Popover";
import { Badge } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import type { ActionState } from "@/lib/actions-state";

type Target = { userId: string; name: string; email: string; role: string; isAdmin: boolean };

/** "Enter as…": lists a workspace's members (an audited platform read) and impersonates the one chosen. */
export function ImpersonateMenu({
  workspaceId,
  workspaceName,
  load,
  impersonate,
}: {
  workspaceId: string;
  workspaceName: string;
  load: (workspaceId: string) => Promise<Target[]>;
  impersonate: (workspaceId: string, userId: string) => Promise<ActionState>;
}) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Popover
      label={`Enter ${workspaceName} as a member`}
      align="end"
      buttonClassName="btn btn-secondary btn-sm"
      onOpen={() => {
        if (!targets) start(async () => setTargets(await load(workspaceId)));
      }}
      button={
        <span className="btn-label">
          <Icon name="eye" /> Enter as…
        </span>
      }
    >
      <div className="menu imp-menu">
        <p className="label menu-label">Impersonate a member of {workspaceName}</p>
        {!targets ? (
          <p className="menu-empty">Loading members…</p>
        ) : targets.length ? (
          targets.map((t) => (
            <button
              key={t.userId}
              type="button"
              className="menu-item"
              disabled={t.isAdmin || pending}
              onClick={() =>
                start(async () => {
                  const r = await impersonate(workspaceId, t.userId);
                  if (r && !r.ok) toast.push({ tone: "danger", title: r.error ?? "Could not impersonate." });
                })
              }
            >
              <span className="person-dot" aria-hidden="true">
                {(t.name || t.email)[0]?.toUpperCase()}
              </span>
              <span className="menu-text">
                {t.name || t.email}
                <small>{t.email}</small>
              </span>
              <Badge tone={t.role === "owner" ? "ion" : t.role === "editor" ? "info" : "neutral"}>{t.isAdmin ? "staff" : t.role}</Badge>
            </button>
          ))
        ) : (
          <p className="menu-empty">This workspace has no members.</p>
        )}
        <p className="menu-fine">
          <Icon name="history" /> Recorded in the audit log with your name. Ends after 30 minutes.
        </p>
      </div>
    </Popover>
  );
}
