/**
 * The product-family marks, as supplied by each product (copies in public/brand,
 * never redrawn here): Sonorch's ring, SeasonX's crossed knives and KitchenSpot's
 * pin. Each has a light and a dark file; globals.css swaps them with the theme.
 * Decorative: the product name is always written next to it.
 */
export type BrandKey = "sonorch" | "seasonx" | "kitchenspot";

const BY_NAME: Record<string, BrandKey> = { Sonorch: "sonorch", SeasonX: "seasonx", KitchenSpot: "kitchenspot" };

/** The brand for a product name, if it is one of the family. */
export const brandFor = (name: string): BrandKey | undefined => BY_NAME[name];

export function ProductMark({ brand, className }: { brand: BrandKey; className?: string }) {
  return <span className={`bmark bmark-${brand}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
