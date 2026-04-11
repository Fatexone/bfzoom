import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getVerifiedUser } from "@/lib/serverAuth";
import { ADMIN_EMAIL } from "@/config/constants";
import {
  buildTranslationCreditsSnapshot,
  buildTranslationLockedReason,
  FREE_TRANSLATION_TRIAL_MINUTES,
  planTranslationConsumption,
  secondsToWalletMinutes,
} from "@/lib/translationCredits";
import {
  buildAuthenticatedPocketTranscribeGrantFields,
  buildAuthenticatedTranslationGrantFields,
} from "@/lib/translationRuntimeGuard";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

type ConsumeBody = {
  seconds?: number;
  origin?: string;
  roomId?: string;
  preview?: boolean;
};

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(`${user.uid}:${ip}:translation-consume`, 180, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Rate limit" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ConsumeBody;
  const requestedSeconds = Math.max(
    1,
    Math.min(300, Math.floor(Number(body.seconds ?? 1) || 1))
  );
  const normalizedOrigin = (body.origin || "").trim().slice(0, 80);
  const normalizedRoomId = (body.roomId || "").trim().slice(0, 80);
  const previewOnly = body.preview === true;
  const isPocketPreview = previewOnly && normalizedOrigin.startsWith("local-pocket");

  const adminDb = getAdminDb();
  const userRef = adminDb.collection("users").doc(user.uid);
  const walletRef = adminDb.doc(`users/${user.uid}/tokens/wallet`);
  const meterRef = adminDb.doc(`users/${user.uid}/translation/meter`);

  type ConsumeResult = {
    enabled: boolean;
    lockReason: string;
    isAdmin: boolean;
    isPremium: boolean;
    periodKey: string;
    freeSecondsLimit: number;
    freeSecondsUsed: number;
    freeSecondsRemaining: number;
    paidSecondsRemaining: number;
    totalSecondsRemaining: number;
    status: number;
  };

  const result = await adminDb.runTransaction(async (tx) => {
    const [userSnap, walletSnap, meterSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(walletRef),
      tx.get(meterRef),
    ]);

    const profile = (userSnap.data() ?? {}) as Record<string, unknown>;
    const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const isPremium = Boolean(profile.isPremium) || profile.plan === "premium";
    const unlimited = isAdmin || isPremium;
    const walletData = (walletSnap.data() ?? null) as Record<string, unknown> | null;
    const meterData = (meterSnap.data() ?? null) as Record<string, unknown> | null;

    const snapshot = buildTranslationCreditsSnapshot({
      wallet: walletData,
      meter: meterData,
      unlimited,
    });
    const previewGrantFields = isPocketPreview
      ? buildAuthenticatedPocketTranscribeGrantFields()
      : {};

    if (unlimited) {
      if (previewOnly) {
        if (Object.keys(previewGrantFields).length > 0) {
          tx.set(
            meterRef,
            {
              ...previewGrantFields,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        return {
          enabled: snapshot.enabled,
          lockReason: "",
          isAdmin,
          isPremium,
          periodKey: snapshot.periodKey,
          freeSecondsLimit: snapshot.freeSecondsLimit,
          freeSecondsUsed: snapshot.freeSecondsUsed,
          freeSecondsRemaining: snapshot.freeSecondsRemaining,
          paidSecondsRemaining: snapshot.paidSecondsRemaining,
          totalSecondsRemaining: snapshot.totalSecondsRemaining,
          status: 200,
        } satisfies ConsumeResult;
      }
      tx.set(
        meterRef,
        {
          ...buildAuthenticatedTranslationGrantFields(),
          updatedAt: FieldValue.serverTimestamp(),
          lastConsumedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return {
        enabled: true,
        lockReason: "",
        isAdmin,
        isPremium,
        periodKey: snapshot.periodKey,
        freeSecondsLimit: snapshot.freeSecondsLimit,
        freeSecondsUsed: snapshot.freeSecondsUsed,
        freeSecondsRemaining: snapshot.freeSecondsRemaining,
        paidSecondsRemaining: snapshot.paidSecondsRemaining,
        totalSecondsRemaining: snapshot.totalSecondsRemaining,
        status: 200,
      } satisfies ConsumeResult;
    }

    const plan = planTranslationConsumption({
      snapshot,
      secondsRequested: requestedSeconds,
    });

    if (!plan.ok) {
      return {
        enabled: false,
        lockReason: buildTranslationLockedReason(),
        isAdmin,
        isPremium,
        periodKey: snapshot.periodKey,
        freeSecondsLimit: snapshot.freeSecondsLimit,
        freeSecondsUsed: snapshot.freeSecondsUsed,
        freeSecondsRemaining: snapshot.freeSecondsRemaining,
        paidSecondsRemaining: snapshot.paidSecondsRemaining,
        totalSecondsRemaining: snapshot.totalSecondsRemaining,
        status: 402,
      } satisfies ConsumeResult;
    }

    if (previewOnly) {
      if (Object.keys(previewGrantFields).length > 0) {
        tx.set(
          meterRef,
          {
            ...previewGrantFields,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      return {
        enabled: snapshot.enabled,
        lockReason: "",
        isAdmin,
        isPremium,
        periodKey: snapshot.periodKey,
        freeSecondsLimit: snapshot.freeSecondsLimit,
        freeSecondsUsed: snapshot.freeSecondsUsed,
        freeSecondsRemaining: snapshot.freeSecondsRemaining,
        paidSecondsRemaining: snapshot.paidSecondsRemaining,
        totalSecondsRemaining: snapshot.totalSecondsRemaining,
        status: 200,
      } satisfies ConsumeResult;
    }

    tx.set(
      meterRef,
      {
        ...buildAuthenticatedTranslationGrantFields(),
        periodKey: snapshot.periodKey,
        freeTrialUsedSeconds: plan.nextFreeSecondsUsed,
        freeUsedSeconds: plan.nextFreeSecondsUsed,
        consumedSecondsTotal: FieldValue.increment(requestedSeconds),
        updatedAt: FieldValue.serverTimestamp(),
        lastConsumedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      walletRef,
      {
        balanceSeconds: plan.nextPaidSecondsRemaining,
        balance: secondsToWalletMinutes(plan.nextPaidSecondsRemaining),
        tier:
          plan.nextPaidSecondsRemaining > 0
            ? typeof walletData?.tier === "string" && walletData.tier.trim()
              ? walletData.tier.trim()
              : "credits"
            : "free",
        lastTranslationDebitAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const usageLogRef = userRef.collection("translation_usage").doc();
    tx.set(usageLogRef, {
      periodKey: snapshot.periodKey,
      requestedSeconds,
      consumedFreeSeconds: plan.consumedFreeSeconds,
      consumedPaidSeconds: plan.consumedPaidSeconds,
      origin: normalizedOrigin,
      roomId: normalizedRoomId,
      createdAt: FieldValue.serverTimestamp(),
    });

    const nextSnapshot = buildTranslationCreditsSnapshot({
      unlimited: false,
      wallet: {
        ...(walletData ?? {}),
        balanceSeconds: plan.nextPaidSecondsRemaining,
        balance: secondsToWalletMinutes(plan.nextPaidSecondsRemaining),
      },
      meter: {
        ...(meterData ?? {}),
        periodKey: snapshot.periodKey,
        freeTrialUsedSeconds: plan.nextFreeSecondsUsed,
        freeUsedSeconds: plan.nextFreeSecondsUsed,
      },
    });

    return {
      enabled: nextSnapshot.enabled,
      lockReason: nextSnapshot.enabled ? "" : buildTranslationLockedReason(),
      isAdmin,
      isPremium,
      periodKey: nextSnapshot.periodKey,
      freeSecondsLimit: nextSnapshot.freeSecondsLimit,
      freeSecondsUsed: nextSnapshot.freeSecondsUsed,
      freeSecondsRemaining: nextSnapshot.freeSecondsRemaining,
      paidSecondsRemaining: nextSnapshot.paidSecondsRemaining,
      totalSecondsRemaining: nextSnapshot.totalSecondsRemaining,
      status: 200,
    } satisfies ConsumeResult;
  });

  return NextResponse.json(
    {
      ok: result.status === 200,
      enabled: result.enabled,
      lockReason: result.lockReason,
      isAdmin: result.isAdmin,
      isPremium: result.isPremium,
      trialType: "one_time",
      freeTrialMinutes: FREE_TRANSLATION_TRIAL_MINUTES,
      freeMinutesPerMonth: FREE_TRANSLATION_TRIAL_MINUTES,
      periodKey: result.periodKey,
      freeSecondsLimit: result.freeSecondsLimit,
      freeSecondsUsed: result.freeSecondsUsed,
      freeSecondsRemaining: result.freeSecondsRemaining,
      paidSecondsRemaining: result.paidSecondsRemaining,
      totalSecondsRemaining: result.totalSecondsRemaining,
    },
    {
      status: result.status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
