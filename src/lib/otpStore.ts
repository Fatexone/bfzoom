import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

type OtpEntry = {
  email: string;
  code: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
};

const COLLECTION = "otp_codes";
const MAX_ATTEMPTS = 5;
const TTL_MS = 10 * 60 * 1000;

function docIdForEmail(email: string) {
  return encodeURIComponent(email.toLowerCase());
}

export async function createOtp(email: string) {
  const code = `${Math.floor(100000 + Math.random() * 900000)}`;
  const entry: OtpEntry = {
    email,
    code,
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
    createdAt: Date.now(),
  };
  const db = getAdminDb();
  await db.collection(COLLECTION).doc(docIdForEmail(email)).set(entry);
  return { code, expiresAt: entry.expiresAt };
}

export async function verifyOtp(email: string, code: string) {
  const db = getAdminDb();
  const ref = db.collection(COLLECTION).doc(docIdForEmail(email));
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false, reason: "not_found" } as const;
    }

    const entry = snap.data() as OtpEntry;
    if (entry.expiresAt <= now) {
      tx.delete(ref);
      return { ok: false, reason: "expired" } as const;
    }

    if (entry.attempts >= MAX_ATTEMPTS) {
      tx.delete(ref);
      return { ok: false, reason: "locked" } as const;
    }

    if (entry.code !== code) {
      tx.update(ref, { attempts: FieldValue.increment(1) });
      return { ok: false, reason: "invalid" } as const;
    }

    tx.delete(ref);
    return { ok: true } as const;
  });
}