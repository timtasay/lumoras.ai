import { NextResponse } from "next/server";
import { validateDemo } from "@/lib/demo";
import { sendEmail } from "@/lib/email";

const DEFAULT_DEMO_EMAIL = "info@lumoras.ai";

/**
 * Demo requests. Validated, logged (so none is lost if email fails) and emailed
 * to DEMO_REQUEST_EMAIL through Resend.
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

  try {
    await sendEmail({
      to: process.env.DEMO_REQUEST_EMAIL?.trim() || DEFAULT_DEMO_EMAIL,
      replyTo: value.email,
      subject: `Demo request from ${value.company}`,
      text: [
        `Name: ${value.name}`,
        `Email: ${value.email}`,
        `Company: ${value.company}`,
        `Locations: ${value.locations}`,
        `Industry: ${value.industry}`,
        `Interested in: ${value.interests.length ? value.interests.join(", ") : "Not specified"}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[demo-request] email failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: "We couldn't send your request just now. Please try again in a minute." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, firstName: value.name.split(/\s+/)[0] });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
