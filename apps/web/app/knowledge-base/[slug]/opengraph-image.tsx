import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { getGuides, getGuide } from "@/lib/content";

export const alt = "Lumoras knowledge base guide";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return getGuides().map((x) => ({ slug: x.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getGuide(slug);
  return ogImage({ eyebrow: "Knowledge base", title: doc?.title ?? "Lumoras" });
}
