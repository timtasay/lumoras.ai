import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { buttonClass } from "@/components/ui/Button";
import { readWorkspace } from "@/lib/actions";
import { listRuns } from "@/lib/data/content";
import { STEP_META } from "@/lib/pipeline/steps";
import { formatMicros } from "@/lib/research/money";
import { dateTimeLabel } from "@/lib/ui/time";

export const metadata: Metadata = { title: "Pipeline runs" };

const LIGHT: Record<string, [LightState, string]> = {
  queued: ["live", "Queued"],
  running: ["live", "Running"],
  waiting: ["warn", "Waiting"],
  succeeded: ["ok", "Done"],
  failed: ["error", "Failed"],
  canceled: ["idle", "Canceled"],
};

export default async function RunsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const runs = await readWorkspace(slug, (tx) => listRuns(tx, { limit: 100 }));
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <h1>Pipeline runs</h1>
          <p className="lede muted">Every article the pipeline wrote or is writing, newest first.</p>
        </div>
      </header>
      {runs.length ? (
        <div className="tbl-frame" role="region" aria-label="Pipeline runs" tabIndex={0}>
          <table className="tbl runs-tbl">
            <caption className="sr-only">Pipeline runs</caption>
            <thead>
              <tr>
                <th scope="col">Article</th>
                <th scope="col">Site</th>
                <th scope="col">State</th>
                <th scope="col">Step</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const [l, t] = LIGHT[r.status] ?? ["idle", r.status];
                return (
                  <tr key={r.id}>
                    <td>
                      <Link className="tlink" href={`/w/${slug}/runs/${r.id}`}>
                        {r.title || r.primary_keyword || "Choosing a topic"}
                      </Link>
                      {r.trigger !== "schedule" ? <Badge>{r.trigger}</Badge> : null}
                    </td>
                    <td className="mono small">{r.domain}</td>
                    <td>
                      <StatusLight state={l}>{t}</StatusLight>
                    </td>
                    <td className="small">{r.current_step ? STEP_META[r.current_step].label : "–"}</td>
                    <td className="num mono">{formatMicros(Number(r.cost_micros))}</td>
                    <td className="small muted">{dateTimeLabel(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="flow" title="No runs yet" text="Runs start by themselves a few days before each scheduled slot, or when someone presses Run now on the calendar." primary={<Link href={`/w/${slug}/content`} className={buttonClass("primary")}><span className="btn-label">Open the calendar</span></Link>} />
      )}
    </div>
  );
}
