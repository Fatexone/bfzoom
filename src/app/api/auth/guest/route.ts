import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const buildGuestUid = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `guest_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

export async function POST() {
  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminDb();
    const uid = buildGuestUid();

    await adminAuth.createUser({
      uid,
      displayName: "BFZoom Guest",
    });

    await adminDb.collection("users").doc(uid).set(
      {
        id: uid,
        guest: true,
        name: "BFZoom Guest",
        createdAt: new Date(),
      },
      { merge: true }
    );

    const token = await adminAuth.createCustomToken(uid);

    return NextResponse.json(
      {
        ok: true,
        uid,
        token,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create guest session.",
      },
      { status: 500 }
    );
  }
}
