import { requireWorkspace } from "@/lib/auth/app";

/** Everything under /w/:slug requires membership; non-members get the same 404 as a missing workspace. */
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  await requireWorkspace((await params).slug);
  return children;
}
