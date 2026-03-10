import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getVerifiedUser } from "@/lib/serverAuth";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;
const CHUNK_SIZE = 100;

type ChatPushBody = {
  chatId?: string;
  messageType?: "text" | "image" | "file" | "voice";
  previewText?: string;
};

type ExpoPushTicket = {
  status?: "ok" | "error";
  details?: { error?: string };
};

type ExpoPushResponse = {
  data?: ExpoPushTicket[];
};

const trimBounded = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const normalizeMessageType = (value: unknown): "text" | "image" | "file" | "voice" => {
  const raw = trimBounded(value, 24).toLowerCase();
  if (raw === "image" || raw === "file" || raw === "voice") return raw;
  return "text";
};

const getBodyPreview = ({
  messageType,
  previewText,
}: {
  messageType: "text" | "image" | "file" | "voice";
  previewText: string;
}) => {
  if (messageType === "voice") return "Note vocale";
  if (messageType === "image") return previewText || "Image";
  if (messageType === "file") return previewText || "Fichier";
  return previewText || "Nouveau message";
};

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(`${user.uid}:${ip}:chat-push`, 120, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Rate limit" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  let body: ChatPushBody;
  try {
    body = (await req.json()) as ChatPushBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chatId = trimBounded(body.chatId, 190);
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const messageType = normalizeMessageType(body.messageType);
  const previewText = trimBounded(body.previewText, 180);

  const db = getAdminDb();
  const senderSnap = await db.collection("users").doc(user.uid).get();
  const senderData = (senderSnap.data() ?? {}) as Record<string, unknown>;
  const senderName =
    trimBounded(senderData.name, 80) ||
    trimBounded(senderData.email, 80) ||
    "BFZoom";
  const notificationBody = getBodyPreview({ messageType, previewText });

  const chatRef = db.collection("chats").doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const participantsRaw = chatSnap.data()?.participants;
  const participants = Array.isArray(participantsRaw)
    ? participantsRaw.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (!participants.includes(user.uid)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const recipientIds = participants.filter((participantId) => participantId !== user.uid);
  if (recipientIds.length === 0) {
    return NextResponse.json({
      ok: true,
      recipients: 0,
      tokens: 0,
      sent: 0,
      failed: 0,
      pruned: 0,
    });
  }

  const recipientSnapshots = await Promise.all(
    recipientIds.map((recipientId) => db.collection("users").doc(recipientId).get())
  );

  const uniqueTokens: string[] = [];
  const seenTokens = new Set<string>();
  const tokenOwners = new Map<string, Set<string>>();

  for (const userSnap of recipientSnapshots) {
    if (!userSnap.exists) continue;
    const data = userSnap.data() || {};
    const rawTokens = Array.isArray(data.mobilePushTokens) ? data.mobilePushTokens : [];

    for (const entry of rawTokens) {
      const token = typeof entry === "string" ? entry.trim() : "";
      if (!token || !EXPO_TOKEN_REGEX.test(token)) continue;

      let owners = tokenOwners.get(token);
      if (!owners) {
        owners = new Set<string>();
        tokenOwners.set(token, owners);
      }
      owners.add(userSnap.id);

      if (seenTokens.has(token)) continue;
      seenTokens.add(token);
      uniqueTokens.push(token);
    }
  }

  if (uniqueTokens.length === 0) {
    return NextResponse.json({
      ok: true,
      recipients: recipientIds.length,
      tokens: 0,
      sent: 0,
      failed: 0,
      pruned: 0,
    });
  }

  let sent = 0;
  let failed = 0;
  const invalidTokens = new Set<string>();

  const tokenChunks = chunkArray(uniqueTokens, CHUNK_SIZE);
  for (const tokenChunk of tokenChunks) {
    const payload = tokenChunk.map((token) => ({
      to: token,
      sound: "default",
      title: senderName,
      body: notificationBody,
      data: {
        type: "chat_message",
        chatId,
        messageType,
      },
    }));

    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      failed += tokenChunk.length;
      continue;
    }

    const raw = await response.text().catch(() => "");
    let expoResponse: ExpoPushResponse | null = null;
    if (raw) {
      try {
        expoResponse = JSON.parse(raw) as ExpoPushResponse;
      } catch {
        expoResponse = null;
      }
    }

    if (!response.ok || !expoResponse || !Array.isArray(expoResponse.data)) {
      failed += tokenChunk.length;
      continue;
    }

    let processedCount = 0;
    expoResponse.data.forEach((ticket, index) => {
      const token = tokenChunk[index];
      if (!token) return;
      processedCount += 1;
      if (ticket?.status === "ok") {
        sent += 1;
        return;
      }
      failed += 1;
      if (token && ticket?.details?.error === "DeviceNotRegistered") {
        invalidTokens.add(token);
      }
    });
    if (processedCount < tokenChunk.length) {
      failed += tokenChunk.length - processedCount;
    }
  }

  if (invalidTokens.size > 0) {
    const tokensByUser = new Map<string, string[]>();
    invalidTokens.forEach((token) => {
      const owners = tokenOwners.get(token);
      if (!owners) return;
      owners.forEach((ownerUid) => {
        const current = tokensByUser.get(ownerUid) || [];
        current.push(token);
        tokensByUser.set(ownerUid, current);
      });
    });

    await Promise.all(
      Array.from(tokensByUser.entries()).map(([ownerUid, tokens]) =>
        db
          .collection("users")
          .doc(ownerUid)
          .set(
            {
              mobilePushTokens: FieldValue.arrayRemove(...tokens),
              lastPushTokenPrunedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
      )
    );
  }

  return NextResponse.json({
    ok: true,
    recipients: recipientIds.length,
    tokens: uniqueTokens.length,
    sent,
    failed,
    pruned: invalidTokens.size,
  });
}
