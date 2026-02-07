import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { verifyOtp } from "@/lib/otpStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: string; code?: string };
  try {
    body = (await req.json()) as { email?: string; code?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();
  if (!email || !code) {
    return NextResponse.json({ error: "Missing email/code" }, { status: 400 });
  }

  const result = await verifyOtp(email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 401 });
  }

  try {
    const adminAuth = getAdminAuth();
    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch {
      user = await adminAuth.createUser({ email });
    }

    const token = await adminAuth.createCustomToken(user.uid);
    return NextResponse.json({ token, uid: user.uid, email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}