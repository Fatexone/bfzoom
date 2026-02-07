import { NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = match[1];
    const decoded = await getAdminAuth().verifyIdToken(token);
    const otherBody = (await req.json()) as { otherUserId?: string };
    const { otherUserId } = otherBody;
    if (!otherUserId) {
      return NextResponse.json({ error: "otherUserId required" }, { status: 400 });
    }

    const participants = [decoded.uid, otherUserId].sort();
    const chatId = participants.join("__");
    const chatRef = getAdminDb().collection("chats").doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      await chatRef.set({
        type: "direct",
        participants,
        createdBy: decoded.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
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