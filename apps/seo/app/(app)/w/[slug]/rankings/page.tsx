import { FirstSiteTab } from "@/lib/measure/first-site";

export const metadata = { title: "Rankings" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <FirstSiteTab slug={(await params).slug} tab="rankings" title="Rankings" />;
}
