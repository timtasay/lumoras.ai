"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { IconName } from "@/components/Icons";
import { runMeasurementNowAction } from "@/app/(app)/w/[slug]/measure-actions";

/**
 * "Run now": queues one measurement for the worker. Paid kinds are priced
 * first there and refused below the reserve, exactly like a scheduled run;
 * the button says so before anyone clicks (`note`).
 */
export function RunNow({ slug, siteId, kind, label, icon = "play", variant = "secondary", note }: { slug: string; siteId: string; kind: "rank" | "audit" | "backlinks" | "gsc" | "ga4" | "inspect"; label: string; icon?: IconName; variant?: ButtonVariant; note?: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <span className="run-now">
      <Button
        variant={variant}
        size="sm"
        icon={icon}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await runMeasurementNowAction(slug, siteId, kind);
            toast.push(r.ok ? { tone: "ok", title: r.message ?? "Queued." } : { tone: "danger", title: r.error ?? "Could not queue it." });
            if (r.ok) router.refresh();
          })
        }
      >
        {label}
      </Button>
      {note ? <span className="run-note">{note}</span> : null}
    </span>
  );
}
