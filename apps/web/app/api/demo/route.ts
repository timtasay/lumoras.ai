import { NextResponse } from "next/server";
import { validateDemo } from "@/lib/demo";

/**
 * Demo requests. Validates and logs server-side until an email/CRM provider is
 * configured (TODO(launch): forward to the sales inbox). No external calls.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const fd = await req.formData();
      body = { ...Object.fromEntries(fd.entries()), interests: fd.getAll("interests") };
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Honeypot: bots fill hidden fields. Pretend success, log nothing personal.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const { value, errors } = validateDemo(body);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 });
  }

  console.info(
    "[demo-request]",
    JSON.stringify({ at: new Date().toISOString(), ...value }),
  );

  return NextResponse.json({ ok: true, firstName: value.name.split(/\s+/)[0] });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
