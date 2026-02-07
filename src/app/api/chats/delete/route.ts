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
    const uid = decoded.uid;

    const { chatId } = (await req.json()) as { chatId?: string };
    if (!chatId) {
      return NextResponse.json({ error: "chatId required" }, { status: 400 });
    }

    const chatDoc = await getAdminDb().collection("chats").doc(chatId).get();
    if (!chatDoc.exists) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const participants = chatDoc.data()?.participants ?? [];
    if (!Array.isArray(participants) || !participants.includes(uid)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const batch = getAdminDb().batch();
    batch.delete(chatDoc.ref);

    const messages =
      await getAdminDb().collection(`chats/${chatId}/messages`).get();
    messages.docs.forEach((doc) => batch.delete(doc.ref));

    const reads = await getAdminDb().collection(`chats/${chatId}/reads`).get();
    reads.docs.forEach((doc) => batch.delete(doc.ref));

    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}