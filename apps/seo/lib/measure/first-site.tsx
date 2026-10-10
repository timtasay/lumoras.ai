import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { readWorkspace } from "@/lib/actions";
import { can } from "@/lib/auth/permissions";
import { listSites } from "@/lib/data/sites";

/** Workspace-level measurement links open the first site's tab (the site tabs switch between sites' sections). */
export async function FirstSiteTab({ slug, tab, title }: { slug: string; tab: string; title: string }) {
  const { sites, canAdd } = await readWorkspace(slug, async (tx, a) => ({ sites: await listSites(tx), canAdd: can(a.role, "site:create") }));
  if (sites.length) redirect(`/w/${slug}/sites/${sites[0].id}/${tab}`);
  return (
    <div className="page">
      <header className="pg-head">
        <h1>{title}</h1>
      </header>
      <EmptyState
        icon="globe"
        title="No sites yet"
        text="Measurement is per site: add a website and connect its Search Console to see clicks, rankings, audits and backlinks."
        primary={canAdd ? <Link href={`/w/${slug}/sites/new`} className={buttonClass("primary")}><Icon name="plus" /> Add a site</Link> : <span className="muted">An editor or owner adds the first site.</span>}
      />
    </div>
  );
}
