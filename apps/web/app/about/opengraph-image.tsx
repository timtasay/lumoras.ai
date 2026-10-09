import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "About Lumoras";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ eyebrow: "About us", title: "Voice and point of sale, working as one system." });
}
