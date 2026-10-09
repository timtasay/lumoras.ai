import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import "./design.css";
import { DesignSystem } from "@/components/design/DesignSystem";
import { isDesignRouteEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Design system" };

/**
 * /design: development only. On when NODE_ENV is not production, or when
 * ENABLE_DESIGN_ROUTE=1 (a review deploy). Otherwise it does not exist (404).
 */
export default async function DesignPage() {
  await connection();
  if (!isDesignRouteEnabled()) notFound();
  return <DesignSystem />;
}
