import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

const CALLS_COLLECTION = "calls";
const DEFAULT_SWEEP_LIMIT = 200;

const toMillis = (value: unknown) => {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as {
    toMillis?: () => number;
    _seconds?: number;
    _nanoseconds?: number;
  };
  if (typeof candidate.toMillis === "function") {
    const ms = candidate.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof candidate._seconds === "number") {
    const secondsMs = candidate._seconds * 1_000;
    const nanosMs =
      typeof candidate._nanoseconds === "number"
        ? Math.floor(candidate._nanoseconds / 1_000_000)
        : 0;
    const total = secondsMs + nanosMs;
    return Number.isFinite(total) ? total : 0;
  }
  return 0;
};

export const expireStaleRingingCalls = async ({
  nowMs = Date.now(),
  limit = DEFAULT_SWEEP_LIMIT,
}: {
  nowMs?: number;
  limit?: number;
} = {}) => {
  const effectiveLimit = Math.max(1, Math.min(1_000, Math.floor(limit || DEFAULT_SWEEP_LIMIT)));
  const db = getAdminDb();
  const querySnapshot = await db
    .collection(CALLS_COLLECTION)
    .where("status", "==", "ringing")
    .limit(effectiveLimit)
    .get();

  if (querySnapshot.empty) {
    return {
      scanned: 0,
      expired: 0,
      updatedChatIds: [] as string[],
    };
  }

  const batch = db.batch();
  const updatedChatIds: string[] = [];

  querySnapshot.docs.forEach((entry) => {
    const data = entry.data() as Record<string, unknown>;
    const ringExpiresAtMs = toMillis(data.ringExpiresAt);
    if (!ringExpiresAtMs || ringExpiresAtMs > nowMs) return;

    updatedChatIds.push(entry.id);
    batch.set(
      entry.ref,
      {
        status: "ended",
        endedReason: "no_answer",
        endedBy: "system",
        endedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  if (updatedChatIds.length > 0) {
    await batch.commit();
  }

  return {
    scanned: querySnapshot.size,
    expired: updatedChatIds.length,
    updatedChatIds,
  };
};
