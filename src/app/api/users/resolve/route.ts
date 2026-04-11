import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getVerifiedUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

type ResolveUserBody = {
  email?: string;
  phoneE164?: string;
};

const normalizePhoneE164 = (value: string) => {
  const raw = value.trim();
  if (!raw) return "";
  const withPlus = raw.startsWith("00") ? `+${raw.slice(2)}` : raw;
  const compact = withPlus.replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) {
    const digits = compact.slice(1).replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";
    return `+${digits}`;
  }
  const digitsOnly = compact.replace(/\D/g, "");
  if (digitsOnly.length === 10 && digitsOnly.startsWith("0")) {
    return `+33${digitsOnly.slice(1)}`;
  }
  if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }
  return "";
};

export async function POST(req: Request) {
  const requester = await getVerifiedUser(req);
  if (!requester.ok) {
    return NextResponse.json({ error: requester.error }, { status: requester.status });
  }

  let body: ResolveUserBody;
  try {
    body = (await req.json()) as ResolveUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const phoneE164 = normalizePhoneE164(body.phoneE164 || "");
  if (!email && !phoneE164) {
    return NextResponse.json({ error: "email or phoneE164 required" }, { status: 400 });
  }

  const adminAuth = getAdminAuth();
  let userRecord = null as Awaited<ReturnType<typeof adminAuth.getUserByEmail>> | null;
  try {
    if (email) {
      userRecord = await adminAuth.getUserByEmail(email);
    } else if (phoneE164) {
      userRecord = await adminAuth.getUserByPhoneNumber(phoneE164);
    }
  } catch {
    userRecord = null;
  }

  if (!userRecord) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const resolvedEmail = (userRecord.email || email || "").trim().toLowerCase();
  const resolvedPhone = normalizePhoneE164(userRecord.phoneNumber || phoneE164 || "");
  const resolvedName = (userRecord.displayName || "").trim() || "Utilisateur";

  await getAdminDb()
    .collection("users")
    .doc(userRecord.uid)
    .set(
      {
        id: userRecord.uid,
        email: resolvedEmail,
        emailLower: resolvedEmail,
        name: resolvedName,
        phoneE164: resolvedPhone || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return NextResponse.json(
    {
      user: {
        id: userRecord.uid,
        name: resolvedName,
        email: resolvedEmail,
        phoneE164: resolvedPhone || undefined,
      },
    },
    { status: 200 }
  );
}

