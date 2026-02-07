import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getVerifiedUser } from "@/lib/serverAuth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.bfzoom.fr";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
    }

    const user = await getVerifiedUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }

    const ip = getClientIp(req);
    const rate = checkRateLimit(`${user.uid}:${ip}:invite`, 5, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
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

    const inviteUrl = `${APP_URL}/signup?invite=${encodeURIComponent(user.uid)}`;
    const resend = new Resend(apiKey);

    await resend.emails.send({
      from: "BFZoom <noreply@bfzoom.fr>",
      to: [email],
      subject: "Invitation à rejoindre BFZoom",
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Rejoins BFZoom</h2>
          <p>${user.email} t’a invité à rejoindre BFZoom.</p>
          <p>Crée ton compte ici :</p>
          <p><a href="${inviteUrl}" target="_blank">${inviteUrl}</a></p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}