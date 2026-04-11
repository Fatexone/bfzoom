import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { ADMIN_EMAIL } from "@/config/constants";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { findIosIapPackByProductId } from "@/lib/iapIosConfig";
import { verifyIosIapReceipt } from "@/lib/iosIapReceipt";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { getAuthenticatedUser } from "@/lib/serverAuth";
import {
  buildTranslationCreditsSnapshot,
  secondsToWalletMinutes,
} from "@/lib/translationCredits";

type ConfirmBody = {
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  receiptData?: string;
};

type ConfirmResult =
  | {
      ok: true;
      alreadyProcessed: boolean;
      minutesAdded: number;
      totalSecondsRemaining: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export const runtime = "nodejs";

const normalizeString = (value: unknown, maxLength = 256) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const normalizeReceiptData = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const encodeDocId = (value: string) => encodeURIComponent(value.trim());

export async function POST(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(`${user.uid}:${ip}:ios-iap-confirm`, 20, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Rate limit" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ConfirmBody;
  const productId = normalizeString(body.productId, 180);
  const transactionId = normalizeString(body.transactionId, 220);
  const originalTransactionId = normalizeString(
    body.originalTransactionId,
    220
  );
  const receiptData = normalizeReceiptData(body.receiptData);

  if (!productId || !transactionId || !receiptData) {
    return NextResponse.json(
      { error: "Missing iOS purchase confirmation payload." },
      { status: 400 }
    );
  }

  const pack = findIosIapPackByProductId(productId);
  if (!pack) {
    return NextResponse.json(
      { error: "Unknown iOS translation pack." },
      { status: 400 }
    );
  }

  const verifiedReceipt = await verifyIosIapReceipt({
    receiptData,
    productId,
    transactionId,
    originalTransactionId,
  });
  if (!verifiedReceipt.ok) {
    return NextResponse.json(
      { error: verifiedReceipt.error },
      { status: verifiedReceipt.status }
    );
  }

  const verified = verifiedReceipt.receipt;
  const adminDb = getAdminDb();
  const userRef = adminDb.collection("users").doc(user.uid);
  const walletRef = adminDb.doc(`users/${user.uid}/tokens/wallet`);
  const meterRef = adminDb.doc(`users/${user.uid}/translation/meter`);
  const purchaseRef = adminDb
    .collection("iap_ios_transactions")
    .doc(encodeDocId(verified.transactionId));
  const refillLogRef = userRef
    .collection("translation_refills")
    .doc(encodeDocId(verified.transactionId));

  let result: ConfirmResult;
  try {
    result = await adminDb.runTransaction(async (tx) => {
      const [userSnap, walletSnap, meterSnap, purchaseSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(walletRef),
        tx.get(meterRef),
        tx.get(purchaseRef),
      ]);

      const profile = (userSnap.data() ?? {}) as Record<string, unknown>;
      const walletData = (walletSnap.data() ?? null) as Record<string, unknown> | null;
      const meterData = (meterSnap.data() ?? null) as Record<string, unknown> | null;
      const isAdmin =
        Boolean(user.email) &&
        user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      const isPremium = Boolean(profile.isPremium) || profile.plan === "premium";
      const unlimited = isAdmin || isPremium;

      const currentSnapshot = buildTranslationCreditsSnapshot({
        wallet: walletData,
        meter: meterData,
        unlimited,
      });

      if (purchaseSnap.exists) {
        const purchaseData = (purchaseSnap.data() ?? {}) as Record<string, unknown>;
        const existingUid = normalizeString(purchaseData.uid, 220);
        if (existingUid && existingUid !== user.uid) {
          return {
            ok: false,
            status: 409,
            error: "This App Store transaction is already linked to another BFZoom account.",
          } satisfies ConfirmResult;
        }

        return {
          ok: true,
          alreadyProcessed: true,
          minutesAdded: 0,
          totalSecondsRemaining:
            currentSnapshot.freeSecondsRemaining + currentSnapshot.paidSecondsRemaining,
        } satisfies ConfirmResult;
      }

      const nextPaidSeconds = currentSnapshot.paidSecondsRemaining + pack.seconds;
      const nextWalletData = {
        ...(walletData ?? {}),
        balanceSeconds: nextPaidSeconds,
        balance: secondsToWalletMinutes(nextPaidSeconds),
      };
      const nextSnapshot = buildTranslationCreditsSnapshot({
        wallet: nextWalletData,
        meter: meterData,
        unlimited,
      });

      tx.set(
        walletRef,
        {
          balanceSeconds: nextPaidSeconds,
          balance: secondsToWalletMinutes(nextPaidSeconds),
          tier: "credits",
          lastRefillAt: FieldValue.serverTimestamp(),
          lastIosIapRefillAt: FieldValue.serverTimestamp(),
          lastIosIapProductId: pack.productId,
          lastIosIapTransactionId: verified.transactionId,
        },
        { merge: true }
      );

      tx.set(
        purchaseRef,
        {
          uid: user.uid,
          productId: pack.productId,
          packMinutes: pack.minutes,
          packSeconds: pack.seconds,
          transactionId: verified.transactionId,
          originalTransactionId: verified.originalTransactionId,
          appleEnvironment: verified.environment,
          appleBundleId: verified.bundleId,
          receiptDigest: verified.receiptDigest,
          purchaseDateMs: verified.purchaseDateMs || null,
          processedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        refillLogRef,
        {
          source: "ios_iap",
          productId: pack.productId,
          transactionId: verified.transactionId,
          originalTransactionId: verified.originalTransactionId,
          minutesAdded: pack.minutes,
          secondsAdded: pack.seconds,
          appleEnvironment: verified.environment,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        ok: true,
        alreadyProcessed: false,
        minutesAdded: pack.minutes,
        totalSecondsRemaining:
          nextSnapshot.freeSecondsRemaining + nextPaidSeconds,
      } satisfies ConfirmResult;
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to confirm iOS purchase.",
      },
      { status: 500 }
    );
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      ok: true,
      alreadyProcessed: result.alreadyProcessed,
      minutesAdded: result.minutesAdded,
      totalSecondsRemaining: result.totalSecondsRemaining,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
