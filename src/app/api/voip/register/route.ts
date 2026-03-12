import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getVerifiedUser } from "@/lib/serverAuth";
import { getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

type RegisterVoipTokenBody = {
  token?: string;
  platform?: string;
};

const VOIP_TOKEN_COLLECTION = "voip_tokens";

const isLikelyApnsToken = (value: string) => /^[a-f0-9]{32,}$/i.test(value);

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  let body: RegisterVoipTokenBody;
  try {
    body = (await req.json()) as RegisterVoipTokenBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = (body.token || "").trim().toLowerCase();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  if (!isLikelyApnsToken(token)) {
    return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
  }

  const platform = (body.platform || "ios").trim().toLowerCase() || "ios";
  const email = (user.email || "").trim();
  const emailLower = email.toLowerCase();
  try {
    const db = getAdminDb();
    const docRef = db.collection(VOIP_TOKEN_COLLECTION).doc(user.uid);
    await docRef.set(
      {
        uid: user.uid,
        email,
        emailLower,
        platform,
        updatedAt: FieldValue.serverTimestamp(),
        tokens: FieldValue.arrayUnion(token),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to register VoIP token",
      },
      { status: 500 }
    );
  }
}
