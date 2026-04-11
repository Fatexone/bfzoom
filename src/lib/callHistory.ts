import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";

export type CallDirection = "incoming" | "outgoing";
export type CallStatus = "started" | "answered" | "missed" | "ended" | "failed";
export type CallMode = "audio" | "video";

export type MissedCallEntry = {
  id: string;
  peerUserId: string;
  peerLabel: string;
  mode: CallMode;
  chatId: string;
  roomId: string;
  createdAtMs: number;
  read: boolean;
};

type CallHistoryWriteInput = {
  ownerUid: string;
  peerUserId?: string;
  peerLabel?: string;
  direction: CallDirection;
  status: CallStatus;
  mode: CallMode;
  chatId?: string;
  roomId?: string;
  callUUID?: string;
};

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

export const appendCallHistory = async ({
  ownerUid,
  peerUserId,
  peerLabel,
  direction,
  status,
  mode,
  chatId,
  roomId,
  callUUID,
}: CallHistoryWriteInput) => {
  const uid = ownerUid.trim();
  if (!uid) return;
  const isMissedIncoming = direction === "incoming" && status === "missed";

  await addDoc(collection(db, "users", uid, "call_history"), {
    ownerUid: uid,
    peerUserId: (peerUserId || "").trim(),
    peerLabel: (peerLabel || "").trim() || "Contact",
    direction,
    status,
    mode,
    chatId: (chatId || "").trim(),
    roomId: (roomId || "").trim(),
    callUUID: (callUUID || "").trim(),
    read: !isMissedIncoming,
    readAt: isMissedIncoming ? null : serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

const parseMissedCall = (id: string, data: DocumentData | undefined): MissedCallEntry | null => {
  const direction = (typeof data?.direction === "string" ? data.direction.trim() : "") as
    | CallDirection
    | "";
  const status = (typeof data?.status === "string" ? data.status.trim() : "") as
    | CallStatus
    | "";
  if (direction !== "incoming" || status !== "missed") return null;

  const modeRaw = (typeof data?.mode === "string" ? data.mode.trim().toLowerCase() : "") as
    | CallMode
    | "";
  const mode: CallMode = modeRaw === "video" ? "video" : "audio";

  return {
    id,
    peerUserId: (typeof data?.peerUserId === "string" ? data.peerUserId.trim() : "") || "",
    peerLabel: (typeof data?.peerLabel === "string" ? data.peerLabel.trim() : "") || "Contact",
    mode,
    chatId: (typeof data?.chatId === "string" ? data.chatId.trim() : "") || "",
    roomId: (typeof data?.roomId === "string" ? data.roomId.trim() : "") || "",
    createdAtMs: toMs(data?.createdAt),
    read: Boolean(data?.read),
  };
};

export const subscribeMissedCalls = ({
  ownerUid,
  onUpdate,
}: {
  ownerUid: string;
  onUpdate: (entries: MissedCallEntry[]) => void;
}) => {
  const uid = ownerUid.trim();
  if (!uid) {
    onUpdate([]);
    return () => {};
  }

  const q = query(
    collection(db, "users", uid, "call_history"),
    orderBy("createdAt", "desc"),
    limit(40)
  );

  return onSnapshot(
    q,
    (snap) => {
      const entries: MissedCallEntry[] = [];
      snap.docs.forEach((docSnap) => {
        const parsed = parseMissedCall(docSnap.id, docSnap.data());
        if (!parsed) return;
        entries.push(parsed);
      });
      onUpdate(entries);
    },
    () => {
      onUpdate([]);
    }
  );
};

export const subscribeUnreadMissedCallsCount = ({
  ownerUid,
  onUpdate,
}: {
  ownerUid: string;
  onUpdate: (count: number) => void;
}) =>
  subscribeMissedCalls({
    ownerUid,
    onUpdate: (entries) => {
      onUpdate(entries.reduce((total, entry) => (entry.read ? total : total + 1), 0));
    },
  });

export const markMissedCallsAsRead = async ({
  ownerUid,
  callIds,
}: {
  ownerUid: string;
  callIds: string[];
}) => {
  const uid = ownerUid.trim();
  if (!uid) return;
  const ids = Array.from(
    new Set(
      callIds
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
  if (ids.length === 0) return;

  const batch = writeBatch(db);
  ids.forEach((callId) => {
    batch.update(doc(db, "users", uid, "call_history", callId), {
      read: true,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
};
