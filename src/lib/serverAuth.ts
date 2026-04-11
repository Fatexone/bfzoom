import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { isAppReviewEmail } from "@/lib/reviewAccess";

const ALLOWLIST_COLLECTION = "allowed_emails";

type AuthenticatedUser =
  | { ok: true; uid: string; email: string; hasEmail: boolean }
  | { ok: false; status: number; error: string };

type VerifiedUser =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string };

function docIdForEmail(email: string) {
  return encodeURIComponent(email.toLowerCase());
}

export async function getAuthenticatedUser(req: Request): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const email = (decoded.email || "").trim().toLowerCase();
    return { ok: true, uid: decoded.uid, email, hasEmail: Boolean(email) };
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
}

export async function getVerifiedUser(req: Request): Promise<VerifiedUser> {
  const authenticated = await getAuthenticatedUser(req);
  if (!authenticated.ok) {
    return authenticated;
  }
  if (!authenticated.hasEmail) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, uid: authenticated.uid, email: authenticated.email };
}

export async function isEmailAllowlisted(email: string): Promise<boolean> {
  if (isAppReviewEmail(email)) {
    return true;
  }
  const db = getAdminDb();
  const snap = await db
    .collection(ALLOWLIST_COLLECTION)
    .doc(docIdForEmail(email))
    .get();
  return snap.exists;
}
