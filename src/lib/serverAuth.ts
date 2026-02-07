import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

const ALLOWLIST_COLLECTION = "allowed_emails";

type VerifiedUser =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string };

function docIdForEmail(email: string) {
  return encodeURIComponent(email.toLowerCase());
}

export async function getVerifiedUser(req: Request): Promise<VerifiedUser> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const email = decoded.email || "";
    if (!email) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    return { ok: true, uid: decoded.uid, email };
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
}

export async function isEmailAllowlisted(email: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db
    .collection(ALLOWLIST_COLLECTION)
    .doc(docIdForEmail(email))
    .get();
  return snap.exists;
}