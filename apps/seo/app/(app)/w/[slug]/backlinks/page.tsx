import { FirstSiteTab } from "@/lib/measure/first-site";

export const metadata = { title: "Backlinks" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <FirstSiteTab slug={(await params).slug} tab="backlinks" title="Backlinks" />;
}
