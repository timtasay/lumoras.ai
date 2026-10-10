import type { Metadata } from "next";
import { AuthorsEditor } from "@/components/forms/AuthorsEditor";
import { can } from "@/lib/auth/permissions";
import { listAuthors } from "@/lib/data/sites";
import { loadSite } from "@/lib/site-page";
import { deleteAuthorAction, saveAuthorAction } from "../../../actions";

export const metadata: Metadata = { title: "Authors" };

export default async function AuthorsPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const { site, a, authors } = await loadSite(slug, siteId, async (tx, s) => ({ authors: await listAuthors(tx, s.id) }));
  return (
    <AuthorsEditor
      authors={authors.map((x) => ({ id: x.id, kind: x.kind, name: x.name, role: x.role, bio: x.bio, avatar_url: x.avatar_url, is_demo: x.is_demo }))}
      canEdit={can(a.role, "author:manage")}
      save={saveAuthorAction.bind(null, slug, site.id)}
      remove={deleteAuthorAction.bind(null, slug)}
    />
  );
}
