import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getVerifiedUser } from "@/lib/serverAuth";

type TokenUseBody = {
  tokens?: number;
  type?: string;
  context?: string;
};

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const body: TokenUseBody = await req.json().catch(() => ({}));
  const tokensToUse = Math.max(1, Math.floor(body.tokens ?? 1));
  const adminDb = getAdminDb();
  const userRef = adminDb.collection("users").doc(user.uid);
  const userSnap = await userRef.get();
  if (userSnap.exists && userSnap.data()?.isPremium) {
    return NextResponse.json({ ok: true, premium: true });
  }

  const tokensRef = adminDb.doc(`users/${user.uid}/tokens/wallet`);

  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const docSnap = await tx.get(tokensRef);
      const currentBalance = Number(docSnap.data()?.balance ?? 0);
      if (currentBalance < tokensToUse) {
        throw new Error("insufficient_tokens");
      }

      const newBalance = currentBalance - tokensToUse;
      tx.set(
        tokensRef,
        {
          balance: FieldValue.increment(-tokensToUse),
          tier: "free",
        },
        { merge: true }
      );

      const logRef = userRef.collection("usage_logs").doc();
      tx.set(logRef, {
        type: body.type ?? "ai",
        tokens: tokensToUse,
        context: body.context ?? "",
        createdAt: FieldValue.serverTimestamp(),
      });

      return { remaining: newBalance };
    });

    return NextResponse.json({ ok: true, remaining: result.remaining });
  } catch (error) {
    const isInsufficient =
      error instanceof Error && error.message === "insufficient_tokens";
    return NextResponse.json(
      { error: isInsufficient ? "Tokens insuffisants" : "Impossible d’utiliser les tokens" },
      { status: isInsufficient ? 402 : 500 }
    );
  }
}