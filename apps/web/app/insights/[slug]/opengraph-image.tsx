import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { getInsights, getInsight } from "@/lib/content";

export const alt = "Lumoras insight";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return getInsights().map((x) => ({ slug: x.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getInsight(slug);
  return ogImage({ eyebrow: "Insights", title: doc?.title ?? "Lumoras" });
}
