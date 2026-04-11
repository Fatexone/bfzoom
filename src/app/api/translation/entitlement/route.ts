import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getAuthenticatedUser } from "@/lib/serverAuth";
import { ADMIN_EMAIL } from "@/config/constants";
import {
  buildTranslationCreditsSnapshot,
  buildTranslationLockedReason,
  FREE_TRANSLATION_TRIAL_MINUTES,
} from "@/lib/translationCredits";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const adminDb = getAdminDb();
  const userRef = adminDb.collection("users").doc(user.uid);
  const walletRef = adminDb.doc(`users/${user.uid}/tokens/wallet`);
  const meterRef = adminDb.doc(`users/${user.uid}/translation/meter`);

  const [userSnap, walletSnap, meterSnap] = await Promise.all([
    userRef.get(),
    walletRef.get(),
    meterRef.get(),
  ]);

  const profile = (userSnap.data() ?? {}) as Record<string, unknown>;
  const isAdmin = Boolean(user.email) && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const isPremium = Boolean(profile.isPremium) || profile.plan === "premium";
  const unlimited = isAdmin || isPremium;

  const snapshot = buildTranslationCreditsSnapshot({
    wallet: (walletSnap.data() ?? null) as Record<string, unknown> | null,
    meter: (meterSnap.data() ?? null) as Record<string, unknown> | null,
    unlimited,
  });

  return NextResponse.json(
    {
      ok: true,
      enabled: snapshot.enabled,
      lockReason: snapshot.enabled ? "" : buildTranslationLockedReason(),
      isAdmin,
      isPremium,
      trialType: "one_time",
      freeTrialMinutes: FREE_TRANSLATION_TRIAL_MINUTES,
      freeTrialMinutesOneTime: FREE_TRANSLATION_TRIAL_MINUTES,
      // Backward compatibility for older clients.
      freeMinutesPerMonth: FREE_TRANSLATION_TRIAL_MINUTES,
      periodKey: snapshot.periodKey,
      freeSecondsLimit: snapshot.freeSecondsLimit,
      freeSecondsUsed: snapshot.freeSecondsUsed,
      freeSecondsRemaining: snapshot.freeSecondsRemaining,
      paidSecondsRemaining: snapshot.paidSecondsRemaining,
      totalSecondsRemaining: snapshot.totalSecondsRemaining,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
