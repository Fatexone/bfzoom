import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_EMAIL } from "@/config/constants";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getUserTranslationEntitlement } from "@/lib/translationEntitlement";

const LIVEKIT_ROOM_REGISTRY_COLLECTION = "livekit_room_registry";
const ROOM_MAX_LEN = 96;
const ROOM_SESSION_HEARTBEAT_TTL_MS = 180_000;

const normalizeRoomId = (room: string) => room.trim().slice(0, ROOM_MAX_LEN);
const timestampToDate = (value: unknown) =>
  value instanceof Timestamp ? value.toDate() : null;
const isRecent = (value: Date | null, windowMs: number) =>
  Boolean(value && Date.now() - value.getTime() <= windowMs);

export type LivekitRoomHostRecord = {
  hostUid: string;
  hostEmail: string;
  hostIdentity: string;
  updatedAt: Date | null;
  lastHeartbeatAt: Date | null;
  endedAt: Date | null;
};

export class LivekitRoomOwnershipError extends Error {
  constructor(message = "Room already belongs to another host.") {
    super(message);
    this.name = "LivekitRoomOwnershipError";
  }
}

export async function upsertLivekitRoomHost({
  room,
  hostUid,
  hostEmail,
  hostIdentity,
  allowOverride = false,
}: {
  room: string;
  hostUid: string;
  hostEmail: string;
  hostIdentity: string;
  allowOverride?: boolean;
}) {
  const normalizedRoom = normalizeRoomId(room);
  const normalizedHostUid = hostUid.trim();
  const normalizedHostEmail = hostEmail.trim().toLowerCase();
  const normalizedHostIdentity = hostIdentity.trim();
  if (!normalizedRoom || !normalizedHostUid || !normalizedHostEmail) {
    throw new Error("Invalid room host payload");
  }
  const roomRef = getAdminDb()
    .collection(LIVEKIT_ROOM_REGISTRY_COLLECTION)
    .doc(normalizedRoom);

  await getAdminDb().runTransaction(async (tx) => {
    const existingSnap = await tx.get(roomRef);
    if (existingSnap.exists && !allowOverride) {
      const current = (existingSnap.data() ?? {}) as Record<string, unknown>;
      const currentHostUid =
        typeof current.hostUid === "string" ? current.hostUid.trim() : "";
      if (currentHostUid && currentHostUid !== normalizedHostUid) {
        throw new LivekitRoomOwnershipError();
      }
    }

    tx.set(
      roomRef,
      {
        room: normalizedRoom,
        hostUid: normalizedHostUid,
        hostEmail: normalizedHostEmail,
        hostIdentity: normalizedHostIdentity,
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        endedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

export async function getLivekitRoomHost(
  room: string
): Promise<LivekitRoomHostRecord | null> {
  const normalizedRoom = normalizeRoomId(room);
  if (!normalizedRoom) return null;
  const snap = await getAdminDb()
    .collection(LIVEKIT_ROOM_REGISTRY_COLLECTION)
    .doc(normalizedRoom)
    .get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const hostUid =
    typeof data.hostUid === "string" ? data.hostUid.trim() : "";
  const hostEmail =
    typeof data.hostEmail === "string" ? data.hostEmail.trim().toLowerCase() : "";
  const hostIdentity =
    typeof data.hostIdentity === "string" ? data.hostIdentity.trim() : "";
  if (!hostUid || !hostEmail) return null;
  return {
    hostUid,
    hostEmail,
    hostIdentity,
    updatedAt: timestampToDate(data.updatedAt),
    lastHeartbeatAt: timestampToDate(data.lastHeartbeatAt),
    endedAt: timestampToDate(data.endedAt),
  };
}

export async function touchLivekitRoomHeartbeat(
  room: string
): Promise<"updated" | "missing" | "ended"> {
  const normalizedRoom = normalizeRoomId(room);
  if (!normalizedRoom) {
    throw new Error("Invalid room");
  }
  const roomRef = getAdminDb()
    .collection(LIVEKIT_ROOM_REGISTRY_COLLECTION)
    .doc(normalizedRoom);

  return getAdminDb().runTransaction(async (tx) => {
    const existingSnap = await tx.get(roomRef);
    if (!existingSnap.exists) {
      return "missing";
    }
    const current = (existingSnap.data() ?? {}) as Record<string, unknown>;
    if (timestampToDate(current.endedAt)) {
      return "ended";
    }
    tx.set(
      roomRef,
      {
        room: normalizedRoom,
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return "updated";
  });
}

export async function markLivekitRoomEnded(room: string) {
  const normalizedRoom = normalizeRoomId(room);
  if (!normalizedRoom) {
    throw new Error("Invalid room");
  }
  await getAdminDb()
    .collection(LIVEKIT_ROOM_REGISTRY_COLLECTION)
    .doc(normalizedRoom)
    .set(
      {
        room: normalizedRoom,
        endedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export async function hasActiveLivekitRoomSession(room: string): Promise<boolean> {
  const host = await getLivekitRoomHost(room);
  if (!host) return false;
  if (host.endedAt) return false;
  return isRecent(host.lastHeartbeatAt || host.updatedAt, ROOM_SESSION_HEARTBEAT_TTL_MS);
}

export async function canManageLivekitRoom({
  room,
  uid,
  email,
}: {
  room: string;
  uid: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
    return { ok: true };
  }
  const host = await getLivekitRoomHost(room);
  if (!host) {
    return { ok: false, reason: "Room host ownership not found." };
  }
  if (host.hostUid === uid.trim()) {
    return { ok: true };
  }
  return { ok: false, reason: "Only the room host can perform this action." };
}

export async function hasRoomHostTranslationAccess(room: string): Promise<boolean> {
  const host = await getLivekitRoomHost(room);
  if (!host) return false;
  const entitlement = await getUserTranslationEntitlement({
    uid: host.hostUid,
    email: host.hostEmail,
  });
  return entitlement.enabled || entitlement.isAdmin || entitlement.isPremium;
}
