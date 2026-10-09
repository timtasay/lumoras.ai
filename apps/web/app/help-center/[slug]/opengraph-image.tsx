import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { getHelpArticles, getHelpArticle } from "@/lib/content";

export const alt = "Lumoras help center article";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return getHelpArticles().map((x) => ({ slug: x.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getHelpArticle(slug);
  return ogImage({ eyebrow: "Help center", title: doc?.title ?? "Lumoras" });
}
