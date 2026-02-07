import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createOtp } from "@/lib/otpStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email missing" }, { status: 400 });
  }

  const { code, expiresAt } = await createOtp(email);
  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from: "BFZoom <noreply@bfzoom.fr>",
      to: [email],
      subject: "Votre code de vérification BFZoom",
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Vérifiez votre identité</h2>
          <p>Code: <strong style="font-size:20px">${code}</strong></p>
          <p>Valable 10 minutes.</p>
        </div>
      `,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resend error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expiresAt });
}