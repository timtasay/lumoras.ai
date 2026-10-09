import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { readWorkspace } from "@/lib/actions";

export const metadata: Metadata = { title: "Keywords" };

/** Keywords live per site: go to the first site's keywords, or say there is no site yet. */
export default async function WorkspaceKeywords({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const first = await readWorkspace(slug, (tx) => tx.maybe<{ id: string }>("SELECT id FROM sites ORDER BY created_at, domain LIMIT 1"));
  if (first) redirect(`/w/${slug}/sites/${first.id}/keywords`);
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <h1>Keywords</h1>
        </div>
      </header>
      <EmptyState icon="key" title="Add a site first" text="Keywords, research and the seed backlog belong to a site." primary={<Link href={`/w/${slug}/sites/new`} className="btn btn-primary btn-md"><span className="btn-label">Add a site</span></Link>} />
    </div>
  );
}
