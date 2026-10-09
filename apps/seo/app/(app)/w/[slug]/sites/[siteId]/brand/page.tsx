import type { Metadata } from "next";
import { BrandForm } from "@/components/forms/BrandForm";
import { can } from "@/lib/auth/permissions";
import { getBrand } from "@/lib/data/sites";
import { loadSite } from "@/lib/site-page";
import { saveBrandAction } from "../../../actions";

export const metadata: Metadata = { title: "Brand profile" };

export default async function BrandPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const { site, a, brand } = await loadSite(slug, siteId, async (tx, s) => ({ brand: await getBrand(tx, s.id) }));
  return (
    <BrandForm
      action={saveBrandAction.bind(null, slug, site.id, false)}
      readOnly={!can(a.role, "brand:update")}
      values={{ ...brand, prefilled_at: brand.prefilled_at?.toISOString() ?? null, seo_rules: brand.seo_rules as unknown as Record<string, number> }}
    />
  );
}
