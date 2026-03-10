import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getVerifiedUser } from "@/lib/serverAuth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

type DirectChatBody = {
  otherUserId?: string;
};

const sanitizeUid = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 128) : "";

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(`${user.uid}:${ip}:chat-direct`, 40, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Rate limit" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    const otherBody = (await req.json()) as DirectChatBody;
    const otherUserId = sanitizeUid(otherBody.otherUserId);
    if (!otherUserId) {
      return NextResponse.json({ error: "otherUserId required" }, { status: 400 });
    }
    if (otherUserId === user.uid) {
      return NextResponse.json({ error: "Cannot create a chat with yourself" }, { status: 400 });
    }

    const db = getAdminDb();
    const targetUserSnap = await db.collection("users").doc(otherUserId).get();
    if (!targetUserSnap.exists) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    }

    const participants = [user.uid, otherUserId].sort();
    const chatId = participants.join("__");
    const chatRef = db.collection("chats").doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      await chatRef.set({
        type: "direct",
        participants,
        createdBy: user.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessage: null,
      });
    }

    return NextResponse.json({ chatId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}