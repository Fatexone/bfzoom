import { NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebaseAdmin";

const BATCH_DELETE_SIZE = 400;

const deleteCollectionInBatches = async (collectionPath: string) => {
  const db = getAdminDb();
  while (true) {
    const snapshot = await db.collection(collectionPath).limit(BATCH_DELETE_SIZE).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();

    if (snapshot.size < BATCH_DELETE_SIZE) break;
  }
};

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

    const chatData = (chatDoc.data() ?? {}) as {
      participants?: unknown;
      createdBy?: unknown;
      type?: unknown;
      admins?: unknown;
    };
    const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
    if (!Array.isArray(participants) || !participants.includes(uid)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const createdBy =
      typeof chatData.createdBy === "string" ? chatData.createdBy.trim() : "";
    const admins = Array.isArray(chatData.admins)
      ? chatData.admins.filter((entry): entry is string => typeof entry === "string")
      : [];
    const isOwner = createdBy === uid;
    const isGroupAdmin = chatData.type === "group" && admins.includes(uid);
    if (!isOwner && !isGroupAdmin) {
      return NextResponse.json(
        { error: "Only the owner or a group admin can delete this chat" },
        { status: 403 }
      );
    }

    await deleteCollectionInBatches(`chats/${chatId}/messages`);
    await deleteCollectionInBatches(`chats/${chatId}/reads`);

    const batch = getAdminDb().batch();
    batch.delete(getAdminDb().collection("calls").doc(chatId));
    batch.delete(chatDoc.ref);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}