import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/app";
import { pool } from "@/lib/db/pool";
import { listMemberships } from "@/lib/data/workspaces";

/** "/": staff land on the agency home; members on their active (or first) workspace; everyone else starts onboarding. */
export default async function Home() {
  const v = await requireViewer();
  if (v.isPlatformAdmin) redirect("/agency");
  const ms = await listMemberships(pool(), v.user.id);
  const active = ms.find((m) => m.id === v.activeWorkspaceId) ?? ms[0];
  redirect(active ? `/w/${active.slug}` : "/onboarding");
}
