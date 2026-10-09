/**
 * GET /api/w/:slug/usage?month=YYYY-MM: the usage ledger for a month as CSV
 * (any member: budget:read). Money columns are micro-USD integers and US
 * dollars, so a spreadsheet can sum either without rounding surprises.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/app";
import { can } from "@/lib/auth/permissions";
import { pool } from "@/lib/db/pool";
import { withWorkspace } from "@/lib/db/tenant";
import { listLedger } from "@/lib/data/research";
import { membershipBySlug } from "@/lib/data/workspaces";
import { csvField } from "@/lib/research/csv";
import { microsToDecimal } from "@/lib/research/money";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const m = await membershipBySlug(pool(), viewer.user.id, slug);
  if (!m || !can(m.role, "budget:read")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const rows = await withWorkspace(pool(), { workspaceId: m.id, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId }, (tx) => listLedger(tx, { period: `${month}-01`, limit: 5000 }), { readOnly: true });
  const head = ["id", "created_at", "site", "category", "operation", "provider", "status", "cached", "units", "estimate_micros", "cost_micros", "cost_usd", "actor", "detail"];
  const lines = [head.join(",")];
  for (const r of rows.reverse()) {
    lines.push([r.id, r.created_at, r.site_domain ?? "", r.category, r.operation, r.provider, r.status, r.cached, r.units, r.estimate_micros, r.cost_micros, r.category === "social_posts" ? "" : microsToDecimal(r.cost_micros), r.actor, r.detail ?? ""].map(csvField).join(","));
  }
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="usage-${slug}-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
}
