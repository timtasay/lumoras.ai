"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { assignIssueAction, fixIssueAction, setTaskStatusAction } from "@/app/(app)/w/[slug]/measure-actions";

type Member = { id: string; label: string };

function useAct() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (p: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await p();
      toast.push(r.ok ? { tone: "ok", title: r.message ?? "Saved." } : { tone: "danger", title: r.error ?? "Could not save it." });
      if (r.ok) router.refresh();
    });
  return { pending, run };
}

/** One audit issue's controls: who owns it, and "Fix" (creates a task once). */
export function IssueActions({ slug, siteId, issueId, title, assignee, members, taskId, canManage }: { slug: string; siteId: string; issueId: string; title: string; assignee: string | null; members: Member[]; taskId: string | null; canManage: boolean }) {
  const { pending, run } = useAct();
  if (!canManage) return null;
  return (
    <div className="issue-acts">
      <label className="sr-only" htmlFor={`as-${issueId}`}>
        Assign “{title}”
      </label>
      <select id={`as-${issueId}`} className="inp sel inp-sm" defaultValue={assignee ?? ""} disabled={pending} onChange={(e) => run(() => assignIssueAction(slug, siteId, issueId, e.target.value))}>
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {taskId ? null : (
        <Button size="sm" variant="secondary" icon="check" loading={pending} onClick={() => run(() => fixIssueAction(slug, siteId, issueId))} aria-label={`Fix: create a task for “${title}”`}>
          Fix
        </Button>
      )}
    </div>
  );
}

/** A task's status (open → in progress → done). */
export function TaskStatus({ slug, siteId, taskId, status, title, canManage }: { slug: string; siteId: string; taskId: string; status: string; title: string; canManage: boolean }) {
  const { pending, run } = useAct();
  if (!canManage) return <span className="muted small">{status === "in_progress" ? "In progress" : status === "done" ? "Done" : "Open"}</span>;
  return (
    <>
      <label className="sr-only" htmlFor={`ts-${taskId}`}>
        Status of “{title}”
      </label>
      <select id={`ts-${taskId}`} className="inp sel inp-sm" defaultValue={status} disabled={pending} onChange={(e) => run(() => setTaskStatusAction(slug, siteId, taskId, e.target.value))}>
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
      </select>
    </>
  );
}
