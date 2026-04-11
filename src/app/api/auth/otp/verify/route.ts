import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyOtp } from "@/lib/otpStore";
import { getAppReviewOtpCode, isAppReviewEmail } from "@/lib/reviewAccess";

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

  const reviewOtpCode = getAppReviewOtpCode();
  const isReviewBypass =
    Boolean(reviewOtpCode) && isAppReviewEmail(email) && code === reviewOtpCode;

  if (!isReviewBypass) {
    const result = await verifyOtp(email, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 401 });
    }
  }

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminDb();
    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch {
      user = await adminAuth.createUser({ email });
    }

    const sessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    await adminDb.collection("users").doc(user.uid).set(
      {
        id: user.uid,
        email,
        emailLower: email,
        activeSessionId: sessionId,
        activeSessionUpdatedAt: new Date(),
      },
      { merge: true }
    );

    const token = await adminAuth.createCustomToken(user.uid);
    return NextResponse.json({ token, uid: user.uid, email, sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
