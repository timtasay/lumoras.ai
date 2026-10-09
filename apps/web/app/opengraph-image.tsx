import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "Lumoras: sound orchestration for every business";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ eyebrow: "AI receptionist · AI voice agents · POS", title: "Sound orchestration for every business." });
}
