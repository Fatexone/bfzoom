import { createHash, randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

const LIVEKIT_INVITES_COLLECTION = "livekit_invites";
const ROOM_MAX_LEN = 96;
const INVITE_ID_MAX_LEN = 128;
const DEFAULT_INVITE_TTL_MS = 1000 * 60 * 60 * 24;
const DEFAULT_INVITE_MAX_USES = 256;
const INVITE_PREFIX = "inv_";

const normalizeRoomId = (room: string) => room.trim().slice(0, ROOM_MAX_LEN);
const normalizeInviteId = (inviteId: string) =>
  inviteId.trim().slice(0, INVITE_ID_MAX_LEN);
const normalizeIdentity = (identity: string) => identity.trim().slice(0, INVITE_ID_MAX_LEN);
const createRedeemerKey = (identity: string) =>
  createHash("sha256").update(normalizeIdentity(identity)).digest("base64url");
const normalizeRedeemerKeys = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
    : [];

const timestampToDate = (value: unknown) =>
  value instanceof Timestamp ? value.toDate() : null;

export type LivekitInviteRecord = {
  inviteId: string;
  room: string;
  hostUid: string;
  hostEmail: string;
  hostIdentity: string;
  uses: number;
  maxUses: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastUsedAt: Date | null;
};

export class LivekitInviteNotFoundError extends Error {
  constructor(message = "Invite not found.") {
    super(message);
    this.name = "LivekitInviteNotFoundError";
  }
}

export class LivekitInviteExpiredError extends Error {
  constructor(message = "Invite expired.") {
    super(message);
    this.name = "LivekitInviteExpiredError";
  }
}

export class LivekitInviteRevokedError extends Error {
  constructor(message = "Invite revoked.") {
    super(message);
    this.name = "LivekitInviteRevokedError";
  }
}

export class LivekitInviteUsageExceededError extends Error {
  constructor(message = "Invite usage limit reached.") {
    super(message);
    this.name = "LivekitInviteUsageExceededError";
  }
}

export const isLegacyLivekitRoomId = (value: string) =>
  /^room-[a-z0-9-]+$/i.test(value.trim());

export const isLivekitInviteId = (value: string) =>
  normalizeInviteId(value).startsWith(INVITE_PREFIX);

const createInviteId = () =>
  `${INVITE_PREFIX}${randomBytes(18).toString("base64url")}`;

const normalizeInviteRecord = (
  inviteId: string,
  raw: Record<string, unknown>
): LivekitInviteRecord => ({
  inviteId,
  room: typeof raw.room === "string" ? normalizeRoomId(raw.room) : "",
  hostUid: typeof raw.hostUid === "string" ? raw.hostUid.trim() : "",
  hostEmail:
    typeof raw.hostEmail === "string" ? raw.hostEmail.trim().toLowerCase() : "",
  hostIdentity:
    typeof raw.hostIdentity === "string" ? normalizeIdentity(raw.hostIdentity) : "",
  uses:
    typeof raw.uses === "number" && Number.isFinite(raw.uses)
      ? Math.max(0, Math.floor(raw.uses))
      : 0,
  maxUses:
    typeof raw.maxUses === "number" && Number.isFinite(raw.maxUses)
      ? Math.max(1, Math.floor(raw.maxUses))
      : DEFAULT_INVITE_MAX_USES,
  expiresAt: timestampToDate(raw.expiresAt),
  revokedAt: timestampToDate(raw.revokedAt),
  createdAt: timestampToDate(raw.createdAt),
  updatedAt: timestampToDate(raw.updatedAt),
  lastUsedAt: timestampToDate(raw.lastUsedAt),
});

export async function createLivekitInvite({
  room,
  hostUid,
  hostEmail,
  hostIdentity = "",
  ttlMs = DEFAULT_INVITE_TTL_MS,
  maxUses = DEFAULT_INVITE_MAX_USES,
}: {
  room: string;
  hostUid: string;
  hostEmail: string;
  hostIdentity?: string;
  ttlMs?: number;
  maxUses?: number;
}): Promise<LivekitInviteRecord> {
  const normalizedRoom = normalizeRoomId(room);
  const normalizedHostUid = hostUid.trim();
  const normalizedHostEmail = hostEmail.trim().toLowerCase();
  const normalizedHostIdentity = normalizeIdentity(hostIdentity);
  if (!normalizedRoom || !normalizedHostUid || !normalizedHostEmail) {
    throw new Error("Invalid invite payload");
  }

  const safeTtlMs = Math.max(60_000, Math.min(Math.floor(ttlMs), 1000 * 60 * 60 * 24 * 14));
  const safeMaxUses = Math.max(1, Math.min(Math.floor(maxUses), 1000));
  const inviteId = createInviteId();
  const expiresAt = Timestamp.fromMillis(Date.now() + safeTtlMs);

  await getAdminDb()
    .collection(LIVEKIT_INVITES_COLLECTION)
    .doc(inviteId)
    .set({
      inviteId,
      room: normalizedRoom,
      hostUid: normalizedHostUid,
      hostEmail: normalizedHostEmail,
      hostIdentity: normalizedHostIdentity,
      uses: 0,
      redeemerKeys: [],
      maxUses: safeMaxUses,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  return {
    inviteId,
    room: normalizedRoom,
    hostUid: normalizedHostUid,
    hostEmail: normalizedHostEmail,
    hostIdentity: normalizedHostIdentity,
    uses: 0,
    maxUses: safeMaxUses,
    expiresAt: expiresAt.toDate(),
    revokedAt: null,
    createdAt: null,
    updatedAt: null,
    lastUsedAt: null,
  };
}

export async function getLivekitInvite(inviteId: string): Promise<LivekitInviteRecord | null> {
  const normalizedInviteId = normalizeInviteId(inviteId);
  if (!normalizedInviteId) return null;
  const snap = await getAdminDb()
    .collection(LIVEKIT_INVITES_COLLECTION)
    .doc(normalizedInviteId)
    .get();
  if (!snap.exists) return null;
  return normalizeInviteRecord(
    normalizedInviteId,
    (snap.data() ?? {}) as Record<string, unknown>
  );
}

export async function revokeLivekitInvitesForRoom(room: string): Promise<number> {
  const normalizedRoom = normalizeRoomId(room);
  if (!normalizedRoom) return 0;

  const invitesSnap = await getAdminDb()
    .collection(LIVEKIT_INVITES_COLLECTION)
    .where("room", "==", normalizedRoom)
    .get();

  if (invitesSnap.empty) return 0;

  const batch = getAdminDb().batch();
  let revokedCount = 0;

  for (const inviteDoc of invitesSnap.docs) {
    const data = (inviteDoc.data() ?? {}) as Record<string, unknown>;
    if (timestampToDate(data.revokedAt)) continue;
    revokedCount += 1;
    batch.set(
      inviteDoc.ref,
      {
        revokedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  if (revokedCount > 0) {
    await batch.commit();
  }

  return revokedCount;
}

export async function redeemLivekitInvite(
  inviteId: string,
  identity: string
): Promise<LivekitInviteRecord> {
  const normalizedInviteId = normalizeInviteId(inviteId);
  const normalizedIdentity = normalizeIdentity(identity);
  if (!normalizedInviteId) {
    throw new LivekitInviteNotFoundError();
  }
  if (!normalizedIdentity) {
    throw new Error("Missing invite identity.");
  }

  const inviteRef = getAdminDb()
    .collection(LIVEKIT_INVITES_COLLECTION)
    .doc(normalizedInviteId);

  return getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists) {
      throw new LivekitInviteNotFoundError();
    }

    const invite = normalizeInviteRecord(
      normalizedInviteId,
      (snap.data() ?? {}) as Record<string, unknown>
    );
    if (!invite.room || !invite.hostUid || !invite.hostEmail) {
      throw new LivekitInviteNotFoundError();
    }
    if (invite.revokedAt) {
      throw new LivekitInviteRevokedError();
    }
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw new LivekitInviteExpiredError();
    }
    const redeemerKeys = normalizeRedeemerKeys((snap.data() ?? {}).redeemerKeys);
    const redeemerKey = createRedeemerKey(normalizedIdentity);
    const alreadyRedeemedByIdentity = redeemerKeys.includes(redeemerKey);
    if (!alreadyRedeemedByIdentity && invite.uses >= invite.maxUses) {
      throw new LivekitInviteUsageExceededError();
    }

    const nextUses = alreadyRedeemedByIdentity ? invite.uses : invite.uses + 1;
    tx.set(
      inviteRef,
      {
        uses: nextUses,
        ...(alreadyRedeemedByIdentity
          ? {}
          : {
              redeemerKeys: FieldValue.arrayUnion(redeemerKey),
            }),
        lastUsedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ...invite,
      uses: nextUses,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    };
  });
}
