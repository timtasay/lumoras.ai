import { FirstSiteTab } from "@/lib/measure/first-site";

export const metadata = { title: "Search" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <FirstSiteTab slug={(await params).slug} tab="search" title="Search Console and GA4" />;
}
