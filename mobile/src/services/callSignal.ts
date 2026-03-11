import {
  Timestamp,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export type SignalCallStatus = "idle" | "ringing" | "in_call" | "ended";

export type SignalCallState = {
  chatId: string;
  roomId: string;
  fromUserId: string;
  callMode: "audio" | "video";
  callUUID: string;
  status: SignalCallStatus;
  ringExpiresAtMs: number;
  updatedAtMs: number;
};

const CALL_COLLECTION = "calls";

const toMs = (value: unknown) => {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as { toMillis?: () => number; toDate?: () => Date };
  if (typeof candidate.toMillis === "function") {
    const ms = candidate.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof candidate.toDate === "function") {
    const ms = candidate.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
};

const parseState = (chatId: string, data?: DocumentData): SignalCallState | null => {
  if (!data) return null;
  const roomId = (typeof data.roomId === "string" ? data.roomId : "").trim();
  const fromUserId = (typeof data.from === "string" ? data.from : "").trim();
  if (!roomId || !fromUserId) return null;

  const statusRaw = (typeof data.status === "string" ? data.status : "").trim().toLowerCase();
  const status: SignalCallStatus =
    statusRaw === "ringing" || statusRaw === "in_call" || statusRaw === "ended"
      ? statusRaw
      : "idle";

  return {
    chatId,
    roomId,
    fromUserId,
    callMode: data.callMode === "video" ? "video" : "audio",
    callUUID: (typeof data.callUUID === "string" ? data.callUUID : "").trim(),
    status,
    ringExpiresAtMs: toMs(data.ringExpiresAt),
    updatedAtMs: Math.max(toMs(data.updatedAt), toMs(data.createdAt), toMs(data.acceptedAt)),
  };
};

const getRef = (chatId: string) => doc(db!, CALL_COLLECTION, chatId);

export const subscribeSignalCall = ({
  chatId,
  onUpdate,
}: {
  chatId: string;
  onUpdate: (state: SignalCallState | null) => void;
}): Unsubscribe => {
  if (!db || !chatId.trim()) {
    onUpdate(null);
    return () => {};
  }

  const ref = getRef(chatId.trim());
  return onSnapshot(
    ref,
    (snapshot) => {
      onUpdate(parseState(chatId.trim(), snapshot.data() as DocumentData | undefined));
    },
    () => {
      onUpdate(null);
    }
  );
};

export const startSignalCall = async ({
  chatId,
  roomId,
  fromUserId,
  targetUserId,
  callMode,
  callUUID,
}: {
  chatId: string;
  roomId: string;
  fromUserId: string;
  targetUserId: string;
  callMode: "audio" | "video";
  callUUID: string;
}) => {
  if (!db) return;
  const cleanChatId = chatId.trim();
  const cleanRoomId = roomId.trim();
  const cleanFrom = fromUserId.trim();
  const cleanTarget = targetUserId.trim();
  if (!cleanChatId || !cleanRoomId || !cleanFrom || !cleanTarget) {
    throw new Error("Signal d'appel invalide.");
  }

  const ref = getRef(cleanChatId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const current = parseState(cleanChatId, existing.data() as DocumentData);
    if (current && current.status === "ringing" && current.ringExpiresAtMs > Date.now()) {
      throw new Error("Un appel est déjà en cours pour ce chat.");
    }
  }

  await setDoc(ref, {
    chatId: cleanChatId,
    roomId: cleanRoomId,
    from: cleanFrom,
    to: cleanTarget,
    callMode: callMode === "video" ? "video" : "audio",
    callUUID: callUUID.trim() || null,
    status: "ringing",
    ringExpiresAt: Timestamp.fromMillis(Date.now() + 35_000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    acceptedAt: null,
    endedAt: null,
    endedBy: null,
    endedReason: null,
  });
};

export const subscribeIncomingSignalCalls = ({
  userId,
  onIncoming,
}: {
  userId: string;
  onIncoming: (state: SignalCallState | null) => void;
}): Unsubscribe => {
  if (!db || !userId.trim()) {
    onIncoming(null);
    return () => {};
  }

  const incomingQuery = query(
    collection(db, CALL_COLLECTION),
    where("to", "==", userId.trim()),
    limit(20)
  );

  return onSnapshot(
    incomingQuery,
    (snapshot) => {
      const now = Date.now();
      const incoming = snapshot.docs
        .map((entry) => parseState(entry.id, entry.data() as DocumentData))
        .filter((state): state is SignalCallState => Boolean(state))
        .filter(
          (state) =>
            state.status === "ringing" &&
            state.fromUserId !== userId.trim() &&
            (!state.ringExpiresAtMs || state.ringExpiresAtMs > now)
        )
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs);

      onIncoming(incoming[0] || null);
    },
    () => {
      onIncoming(null);
    }
  );
};

export const acceptSignalCall = async (chatId: string, userId: string) => {
  if (!db) return;
  const cleanChatId = chatId.trim();
  const cleanUserId = userId.trim();
  if (!cleanChatId || !cleanUserId) return;

  const ref = getRef(cleanChatId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error("Appel introuvable.");
  }

  const state = parseState(cleanChatId, snapshot.data() as DocumentData);
  if (!state || state.status !== "ringing") {
    throw new Error("Aucun appel entrant actif.");
  }
  if (state.ringExpiresAtMs > 0 && state.ringExpiresAtMs <= Date.now()) {
    await updateDoc(ref, {
      status: "ended",
      endedReason: "no_answer",
      endedBy: "system",
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    throw new Error("Appel expiré.");
  }

  await updateDoc(ref, {
    status: "in_call",
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    endedReason: null,
    endedBy: null,
    endedAt: null,
  });
};

export const endSignalCall = async ({
  chatId,
  endedBy,
  reason,
}: {
  chatId: string;
  endedBy: string;
  reason?: string;
}) => {
  if (!db) return;
  const cleanChatId = chatId.trim();
  if (!cleanChatId) return;

  await updateDoc(getRef(cleanChatId), {
    status: "ended",
    endedReason: (reason || "ended").trim() || "ended",
    endedBy: endedBy.trim() || null,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
};
