import type { Metadata } from "next";
import { SiteForm } from "@/components/forms/SiteForm";
import { requireWorkspace } from "@/lib/auth/app";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { timezones } from "@/lib/ui/timezones";
import { createSiteAction } from "../../actions";

export const metadata: Metadata = { title: "Add a site" };

export default async function NewSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await requireWorkspace(slug);
  if (!can(a.role, "site:create")) redirect(`/w/${slug}`);
  return (
    <div className="page narrow">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>{a.workspace.name}</b> · new site
          </p>
          <h1>Add a site</h1>
          <p className="lede">After it is added we scan its sitemap and read its key pages.</p>
        </div>
      </header>
      <div className="panel pad">
        <SiteForm mode="create" action={createSiteAction.bind(null, slug, false)} timezones={timezones()} />
      </div>
    </div>
  );
}
