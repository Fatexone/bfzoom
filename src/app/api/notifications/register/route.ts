import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getVerifiedUser } from "@/lib/serverAuth";
import { getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

type RegisterNotificationBody = {
  token?: string;
};

const EXPO_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  let body: RegisterNotificationBody;
  try {
    body = (await req.json()) as RegisterNotificationBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || !EXPO_TOKEN_REGEX.test(token)) {
    return NextResponse.json({ error: "Invalid Expo push token" }, { status: 400 });
  }

  const db = getAdminDb();
  const usersSnap = await db.collection("users").where("mobilePushTokens", "array-contains", token).get();

  const cleanupWrites = usersSnap.docs
    .filter((docSnap) => docSnap.id !== user.uid)
    .map((docSnap) =>
      docSnap.ref.set(
        {
          mobilePushTokens: FieldValue.arrayRemove(token),
          lastPushTokenPrunedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    );

  if (cleanupWrites.length > 0) {
    await Promise.all(cleanupWrites);
  }

  await db.collection("users").doc(user.uid).set(
    {
      mobilePushTokens: FieldValue.arrayUnion(token),
      lastPushTokenAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}