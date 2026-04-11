import { getAdminDb } from "@/lib/firebaseAdmin";
import { ADMIN_EMAIL } from "@/config/constants";
import { buildTranslationCreditsSnapshot } from "@/lib/translationCredits";

export type TranslationEntitlement = {
  enabled: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
};

export async function getUserTranslationEntitlement({
  uid,
  email,
}: {
  uid: string;
  email: string;
}): Promise<TranslationEntitlement> {
  const db = getAdminDb();
  const [userSnap, walletSnap, meterSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.doc(`users/${uid}/tokens/wallet`).get(),
    db.doc(`users/${uid}/translation/meter`).get(),
  ]);

  const profile = (userSnap.data() ?? {}) as Record<string, unknown>;
  const isAdmin = email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const isPremium = Boolean(profile.isPremium) || profile.plan === "premium";
  const snapshot = buildTranslationCreditsSnapshot({
    wallet: (walletSnap.data() ?? null) as Record<string, unknown> | null,
    meter: (meterSnap.data() ?? null) as Record<string, unknown> | null,
    unlimited: isAdmin || isPremium,
  });

  return {
    enabled: snapshot.enabled,
    isAdmin,
    isPremium,
    totalSecondsRemaining: snapshot.totalSecondsRemaining,
    freeSecondsRemaining: snapshot.freeSecondsRemaining,
    paidSecondsRemaining: snapshot.paidSecondsRemaining,
  };
}
