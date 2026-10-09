import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRun } from "@/components/pipeline/LiveRun";
import { Icon } from "@/components/Icons";
import { readWorkspace } from "@/lib/actions";
import { can } from "@/lib/auth/permissions";
import { webEnv } from "@/lib/config";
import { isUuid, NotFoundError } from "@/lib/db/tenant";
import { runView } from "@/lib/pipeline/view";
import { retryStepAction } from "../../content-actions";

export const metadata: Metadata = { title: "Pipeline run" };

export default async function RunPage({ params }: { params: Promise<{ slug: string; runId: string }> }) {
  const { slug, runId } = await params;
  if (!isUuid(runId)) notFound();
  let data;
  try {
    data = await readWorkspace(slug, async (tx, a) => ({ run: await runView(tx, runId), role: a.role }));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <Link href={`/w/${slug}/runs`} className="crumb">
              <Icon name="back" className="inline-ico" /> Pipeline runs
            </Link>
          </p>
          <h1>Pipeline run</h1>
          <p className="lede muted">Ten steps, each persisted with its input, output, model, tokens, cost and duration. Retry or resume from any step.</p>
        </div>
      </header>
      <LiveRun slug={slug} initial={data.run} canRun={can(data.role, "pipeline:run")} retry={retryStepAction.bind(null, slug, runId)} demo={webEnv().llm.provider === "fake"} />
    </div>
  );
}
