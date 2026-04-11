import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { ADMIN_EMAIL } from "@/config/constants";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { getVerifiedUser } from "@/lib/serverAuth";
import {
  buildTranslationCreditsSnapshot,
  buildTranslationLockedReason,
  planTranslationConsumption,
  secondsToWalletMinutes,
} from "@/lib/translationCredits";
import {
  buildAuthenticatedTranslationGrantFields,
  buildAuthenticatedPocketTtsGrantFields,
} from "@/lib/translationRuntimeGuard";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "cdg1";

const POCKET_PROCESS_RATE_LIMIT = 18;
const TRANSLATION_TEMPERATURE = 0.1;
const TTS_MAX_CHARS = 650;
const TRANSLATION_SHORT_MAX_TOKENS = 96;
const TRANSLATION_MEDIUM_MAX_TOKENS = 140;
const TRANSLATION_LONG_MAX_TOKENS = 180;
const COMPACT_SCRIPT_REGEX =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff]/;

const normalizeVoice = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);

const normalizeFormat = (value: unknown): "mp3" | "wav" => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "wav" ? "wav" : "mp3";
};

const normalizeLanguageCode = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z-]/g, "")
    .slice(0, 16);

const normalizeLocale = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z-]/g, "")
    .slice(0, 16);

const normalizeLabel = (value: unknown, fallback: string) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48) || fallback;

const normalizeInstructions = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 320);

const getContentTypeForFormat = (format: "mp3" | "wav") =>
  format === "wav" ? "audio/wav" : "audio/mpeg";

const clampSeconds = (value: unknown) =>
  Math.max(1, Math.min(300, Math.floor(Number(value ?? 1) || 1)));

const parseHeaderNumber = (value: string | null) => {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

const isPocketProcessEnabled = () => {
  const normalized = (process.env.BFZOOM_POCKET_PROCESS_ENABLED || "1").trim().toLowerCase();
  return !["0", "false", "off", "disabled"].includes(normalized);
};

type TranslationTokenPlan = {
  bucket: "short" | "medium" | "long";
  maxTokens: number;
  sourceChars: number;
  sourceWords: number;
  compactScript: boolean;
  estimatedBudget: number;
};

const getServerTranslationPlan = (text: string): TranslationTokenPlan => {
  const normalized = text.trim();
  if (!normalized) {
    return {
      bucket: "medium",
      maxTokens: TRANSLATION_MEDIUM_MAX_TOKENS,
      sourceChars: 0,
      sourceWords: 0,
      compactScript: false,
      estimatedBudget: TRANSLATION_MEDIUM_MAX_TOKENS,
    };
  }

  const sourceChars = normalized.length;
  const sourceWords = normalized.split(/\s+/).filter(Boolean).length;
  const punctuationCount = (normalized.match(/[.,;:!?،؛。！？、]/g) || []).length;
  const compactScript = COMPACT_SCRIPT_REGEX.test(normalized) && sourceWords <= 3;
  const contentEstimate = compactScript
    ? Math.ceil(sourceChars * 1.35)
    : Math.ceil(Math.max(sourceWords * 2.6, sourceChars * 0.45));
  const structuralBuffer = 20 + Math.min(12, punctuationCount * 4);
  const estimatedBudget = contentEstimate + structuralBuffer;

  if (estimatedBudget <= TRANSLATION_SHORT_MAX_TOKENS) {
    return {
      bucket: "short",
      maxTokens: TRANSLATION_SHORT_MAX_TOKENS,
      sourceChars,
      sourceWords,
      compactScript,
      estimatedBudget,
    };
  }
  if (estimatedBudget <= TRANSLATION_MEDIUM_MAX_TOKENS) {
    return {
      bucket: "medium",
      maxTokens: TRANSLATION_MEDIUM_MAX_TOKENS,
      sourceChars,
      sourceWords,
      compactScript,
      estimatedBudget,
    };
  }
  return {
    bucket: "long",
    maxTokens: TRANSLATION_LONG_MAX_TOKENS,
    sourceChars,
    sourceWords,
    compactScript,
    estimatedBudget,
  };
};

type PocketEntitlement = {
  enabled: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
};

const getPocketEntitlement = async ({
  uid,
  email,
}: {
  uid: string;
  email: string;
}): Promise<PocketEntitlement> => {
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
};

type PocketConsumeResult = {
  ok: boolean;
  enabled: boolean;
  lockReason: string;
  isAdmin: boolean;
  isPremium: boolean;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
  metrics: {
    mode: "unlimited" | "locked" | "free" | "paid" | "mixed";
    writeMode: "none" | "meter" | "meter+wallet";
    transactionMs: number;
    readMs: number;
    planMs: number;
    attempts: number;
  };
};

const consumePocketTranslationSeconds = async ({
  uid,
  isAdmin,
  isPremium,
  seconds,
  pocketTtsGrantText,
}: {
  uid: string;
  isAdmin: boolean;
  isPremium: boolean;
  seconds: number;
  pocketTtsGrantText: string;
}): Promise<PocketConsumeResult> => {
  const adminDb = getAdminDb();
  const walletRef = adminDb.doc(`users/${uid}/tokens/wallet`);
  const meterRef = adminDb.doc(`users/${uid}/translation/meter`);
  const safeSeconds = clampSeconds(seconds);
  const transactionStartedAt = Date.now();
  let attemptCount = 0;
  let readMs = 0;
  let planMs = 0;
  let mode: PocketConsumeResult["metrics"]["mode"] = "locked";
  let writeMode: PocketConsumeResult["metrics"]["writeMode"] = "none";

  const result = await adminDb.runTransaction(async (tx) => {
    attemptCount += 1;
    const readStartedAt = Date.now();
    const [walletSnap, meterSnap] = await Promise.all([tx.get(walletRef), tx.get(meterRef)]);
    readMs = Date.now() - readStartedAt;
    const unlimited = isAdmin || isPremium;
    const walletData = (walletSnap.data() ?? null) as Record<string, unknown> | null;
    const meterData = (meterSnap.data() ?? null) as Record<string, unknown> | null;
    const planStartedAt = Date.now();
    const snapshot = buildTranslationCreditsSnapshot({
      wallet: walletData,
      meter: meterData,
      unlimited,
    });

    if (unlimited) {
      planMs = Date.now() - planStartedAt;
      mode = "unlimited";
      writeMode = "meter";
      tx.set(
        meterRef,
        {
          ...buildAuthenticatedTranslationGrantFields(),
          ...buildAuthenticatedPocketTtsGrantFields(pocketTtsGrantText),
          updatedAt: FieldValue.serverTimestamp(),
          lastConsumedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return {
        ok: true,
        enabled: true,
        lockReason: "",
        isAdmin,
        isPremium,
        totalSecondsRemaining: snapshot.totalSecondsRemaining,
        freeSecondsRemaining: snapshot.freeSecondsRemaining,
        paidSecondsRemaining: snapshot.paidSecondsRemaining,
        metrics: {
          mode,
          writeMode,
          transactionMs: 0,
          readMs,
          planMs,
          attempts: attemptCount,
        },
      } satisfies PocketConsumeResult;
    }

    const plan = planTranslationConsumption({
      snapshot,
      secondsRequested: safeSeconds,
    });
    planMs = Date.now() - planStartedAt;

    if (!plan.ok) {
      mode = "locked";
      writeMode = "none";
      return {
        ok: false,
        enabled: false,
        lockReason: buildTranslationLockedReason(),
        isAdmin,
        isPremium,
        totalSecondsRemaining: snapshot.totalSecondsRemaining,
        freeSecondsRemaining: snapshot.freeSecondsRemaining,
        paidSecondsRemaining: snapshot.paidSecondsRemaining,
        metrics: {
          mode,
          writeMode,
          transactionMs: 0,
          readMs,
          planMs,
          attempts: attemptCount,
        },
      } satisfies PocketConsumeResult;
    }

    mode =
      plan.consumedFreeSeconds > 0 && plan.consumedPaidSeconds > 0
        ? "mixed"
        : plan.consumedPaidSeconds > 0
          ? "paid"
          : "free";
    writeMode = plan.consumedPaidSeconds > 0 ? "meter+wallet" : "meter";
    tx.set(
      meterRef,
      {
        ...buildAuthenticatedTranslationGrantFields(),
        ...buildAuthenticatedPocketTtsGrantFields(pocketTtsGrantText),
        periodKey: snapshot.periodKey,
        freeTrialUsedSeconds: plan.nextFreeSecondsUsed,
        freeUsedSeconds: plan.nextFreeSecondsUsed,
        consumedSecondsTotal: FieldValue.increment(safeSeconds),
        updatedAt: FieldValue.serverTimestamp(),
        lastConsumedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (plan.consumedPaidSeconds > 0) {
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
    }

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
      ok: true,
      enabled: nextSnapshot.enabled,
      lockReason: nextSnapshot.enabled ? "" : buildTranslationLockedReason(),
      isAdmin,
      isPremium,
      totalSecondsRemaining: nextSnapshot.totalSecondsRemaining,
      freeSecondsRemaining: nextSnapshot.freeSecondsRemaining,
      paidSecondsRemaining: nextSnapshot.paidSecondsRemaining,
      metrics: {
        mode,
        writeMode,
        transactionMs: 0,
        readMs,
        planMs,
        attempts: attemptCount,
      },
    } satisfies PocketConsumeResult;
  });
  const transactionMs = Date.now() - transactionStartedAt;
  return {
    ...result,
    metrics: {
      ...result.metrics,
      transactionMs,
      readMs,
      planMs,
      attempts: attemptCount,
    },
  } satisfies PocketConsumeResult;
};

const buildTranscriptionFile = async ({
  source,
  forceMpeg4,
}: {
  source: File;
  forceMpeg4: boolean;
}) => {
  if (!forceMpeg4) return source;
  const bytes = await source.arrayBuffer();
  return new File([bytes], `${source.name.replace(/\.[^.]+$/, "") || "mobile-recording"}.m4a`, {
    type: "audio/mp4",
  });
};

const isCorruptedAudioError = (message: string) =>
  /corrupt|unsupported|decode|invalid|audio file|audio format|unrecognized/i.test(message);

const transcribePocketAudio = async ({
  openai,
  file,
  language,
}: {
  openai: OpenAI;
  file: File;
  language: string;
}) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const uploadFile = await buildTranscriptionFile({
        source: file,
        forceMpeg4: attempt > 0,
      });
      return await openai.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file: uploadFile,
        ...(language ? { language } : {}),
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error || "");
      if (attempt > 0 || !isCorruptedAudioError(message)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Pocket transcription failed.");
};

const translatePocketText = async ({
  openai,
  sourceText,
  fromLanguage,
  toLanguage,
}: {
  openai: OpenAI;
  sourceText: string;
  fromLanguage: string;
  toLanguage: string;
}) => {
  const plan = getServerTranslationPlan(sourceText);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Translate ${fromLanguage} to ${toLanguage}. Return only the translation.`,
      },
      {
        role: "user",
        content: sourceText,
      },
    ],
    temperature: TRANSLATION_TEMPERATURE,
    max_tokens: plan.maxTokens,
  });

  return {
    text:
      typeof response.choices?.[0]?.message?.content === "string"
        ? response.choices[0].message.content.trim()
        : "",
    plan,
  };
};

const synthesizePocketSpeech = async ({
  openai,
  text,
  voice,
  format,
  instructions,
}: {
  openai: OpenAI;
  text: string;
  voice: string;
  format: "mp3" | "wav";
  instructions: string;
}) => {
  let usedVoice = voice || "alloy";
  try {
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: usedVoice,
      input: text,
      response_format: format,
      ...(instructions ? { instructions } : {}),
    });
    return { response, usedVoice };
  } catch (primaryError) {
    if (usedVoice === "alloy") {
      throw primaryError;
    }
    usedVoice = "alloy";
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: usedVoice,
      input: text,
      response_format: format,
      ...(instructions ? { instructions } : {}),
    });
    return { response, usedVoice };
  }
};

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  let authCompletedAt = requestStartedAt;
  let formDataCompletedAt = requestStartedAt;
  let entitlementCompletedAt = requestStartedAt;
  let sourceText = "";
  let translatedText = "";
  let sourceLanguage = "";
  let targetLanguage = "";
  let usageSeconds = 0;
  let requestId = "";

  const clientRecordingMs = parseHeaderNumber(req.headers.get("x-bfzoom-client-recording-ms"));
  const clientRecorderStopMs = parseHeaderNumber(req.headers.get("x-bfzoom-client-recorder-stop-ms"));
  const clientPostStopSettleMs = parseHeaderNumber(
    req.headers.get("x-bfzoom-client-post-stop-settle-ms")
  );
  const clientResolveUriMs = parseHeaderNumber(req.headers.get("x-bfzoom-client-resolve-uri-ms"));
  const clientStabilizeMs = parseHeaderNumber(req.headers.get("x-bfzoom-client-stabilize-ms"));
  const clientPreUploadMs = parseHeaderNumber(req.headers.get("x-bfzoom-client-pre-upload-ms"));

  if (!isPocketProcessEnabled()) {
    return NextResponse.json(
      { error: "Pocket unified pipeline disabled." },
      {
        status: 503,
        headers: {
          "x-bfzoom-pocket-fallback": "1",
        },
      }
    );
  }

  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY manquante" }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey });

    const user = await getVerifiedUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }
    authCompletedAt = Date.now();

    const ip = getClientIp(req);
    const rate = checkRateLimit(`${user.uid}:${ip}:pocket-process`, POCKET_PROCESS_RATE_LIMIT, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const entitlementStartedAt = Date.now();
    const entitlementPromise = getPocketEntitlement({
      uid: user.uid,
      email: user.email,
    }).catch((error) => ({ error }) as const);

    const formData = (await req.formData()) as unknown as {
      get: (name: string) => unknown;
    };
    formDataCompletedAt = Date.now();

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fichier audio manquant" }, { status: 400 });
    }

    sourceLanguage = normalizeLanguageCode(formData.get("sourceLanguage"));
    targetLanguage = normalizeLanguageCode(formData.get("targetLanguage"));
    const fromLanguage = normalizeLabel(formData.get("fromLanguage"), sourceLanguage || "source");
    const toLanguage = normalizeLabel(formData.get("toLanguage"), targetLanguage || "target");
    usageSeconds = clampSeconds(formData.get("usageSeconds"));
    requestId =
      (req.headers.get("x-bfzoom-pocket-request-id") || "").trim().slice(0, 80) ||
      String(formData.get("requestId") || "").trim().slice(0, 80) ||
      `${Date.now()}`;
    const requestedVoice = normalizeVoice(formData.get("voice")) || "nova";
    const requestedFormat = normalizeFormat(formData.get("format"));
    const requestedLocale = normalizeLocale(formData.get("locale"));
    const requestedInstructions = normalizeInstructions(formData.get("instructions"));

    const entitlementResult = await entitlementPromise;
    entitlementCompletedAt = Date.now();
    if ("error" in entitlementResult) {
      throw entitlementResult.error;
    }
    const entitlement = entitlementResult;

    if (!entitlement.enabled || entitlement.totalSecondsRemaining < usageSeconds) {
      return NextResponse.json(
        {
          ok: false,
          enabled: false,
          isAdmin: entitlement.isAdmin,
          isPremium: entitlement.isPremium,
          lockReason: buildTranslationLockedReason(),
          totalSecondsRemaining: entitlement.totalSecondsRemaining,
          freeSecondsRemaining: entitlement.freeSecondsRemaining,
          paidSecondsRemaining: entitlement.paidSecondsRemaining,
          metrics: {
            totalMs: Date.now() - requestStartedAt,
            authMs: authCompletedAt - requestStartedAt,
            formDataMs: formDataCompletedAt - authCompletedAt,
            entitlementMs: entitlementCompletedAt - entitlementStartedAt,
          },
        },
        { status: 402 }
      );
    }

    const transcribeStartedAt = Date.now();
    const transcription = await transcribePocketAudio({
      openai,
      file,
      language: sourceLanguage,
    });
    const transcribeCompletedAt = Date.now();
    sourceText = (transcription.text || "").trim();
    if (!sourceText) {
      return NextResponse.json({ error: "No speech detected." }, { status: 400 });
    }

    const translateStartedAt = Date.now();
    const translated = await translatePocketText({
      openai,
      sourceText,
      fromLanguage,
      toLanguage,
    });
    const translateCompletedAt = Date.now();
    translatedText = translated.text.trim();
    if (!translatedText) {
      return NextResponse.json({ error: "Empty translation." }, { status: 502 });
    }

    const ttsInput = translatedText.slice(0, TTS_MAX_CHARS);
    let consumeCompletedAt = 0;
    const consumeStartedAt = Date.now();
    const ttsStartedAt = Date.now();
    const [consumeResult, ttsResult] = await Promise.all([
      consumePocketTranslationSeconds({
        uid: user.uid,
        isAdmin: entitlement.isAdmin,
        isPremium: entitlement.isPremium,
        seconds: usageSeconds,
        pocketTtsGrantText: translatedText,
      }).then((result) => {
        consumeCompletedAt = Date.now();
        return result;
      }),
      synthesizePocketSpeech({
        openai,
        text: ttsInput,
        voice: requestedVoice,
        format: requestedFormat,
        instructions: requestedInstructions,
      })
        .then((result) => ({
          ok: true as const,
          ...result,
        }))
        .catch((ttsError) => ({
          ok: false as const,
          error: ttsError instanceof Error ? ttsError.message : "TTS unavailable.",
        })),
    ]);
    const ttsHeadersReadyAt = Date.now();

    if (!consumeResult.ok || !consumeResult.enabled) {
      return NextResponse.json(
        {
          ok: false,
          enabled: false,
          isAdmin: consumeResult.isAdmin,
          isPremium: consumeResult.isPremium,
          lockReason: consumeResult.lockReason || buildTranslationLockedReason(),
          totalSecondsRemaining: consumeResult.totalSecondsRemaining,
          freeSecondsRemaining: consumeResult.freeSecondsRemaining,
          paidSecondsRemaining: consumeResult.paidSecondsRemaining,
          metrics: {
            totalMs: Date.now() - requestStartedAt,
            authMs: authCompletedAt - requestStartedAt,
            formDataMs: formDataCompletedAt - authCompletedAt,
            entitlementMs: entitlementCompletedAt - entitlementStartedAt,
            transcribeMs: transcribeCompletedAt - transcribeStartedAt,
            translateMs: translateCompletedAt - translateStartedAt,
            consumeMs: Date.now() - consumeStartedAt,
            ttsMs: ttsHeadersReadyAt - ttsStartedAt,
          },
        },
        { status: 402 }
      );
    }

    let audioByteLength = 0;
    let audioBase64 = "";
    let audioBase64StartedAt = ttsHeadersReadyAt;
    let audioBase64CompletedAt = ttsHeadersReadyAt;
    const usedVoice = ttsResult.ok ? ttsResult.usedVoice : requestedVoice || "alloy";
    const ttsAvailable = ttsResult.ok;
    const ttsErrorMessage = ttsResult.ok ? "" : ttsResult.error;

    if (ttsResult.ok) {
      const audioArrayBuffer = await ttsResult.response.arrayBuffer();
      const audioBuffer = Buffer.from(audioArrayBuffer);
      audioByteLength = audioBuffer.byteLength;
      audioBase64StartedAt = Date.now();
      audioBase64 = audioBuffer.toString("base64");
      audioBase64CompletedAt = Date.now();
    }

    const totalMs = audioBase64CompletedAt - requestStartedAt;
    const authMs = authCompletedAt - requestStartedAt;
    const formDataMs = formDataCompletedAt - authCompletedAt;
    const entitlementMs = entitlementCompletedAt - entitlementStartedAt;
    const transcribeMs = transcribeCompletedAt - transcribeStartedAt;
    const translateMs = translateCompletedAt - translateStartedAt;
    const consumeMs = Math.max(0, consumeCompletedAt - consumeStartedAt);
    const grantMs = 0;
    const ttsMs = ttsHeadersReadyAt - ttsStartedAt;
    const audioBase64Ms = audioBase64CompletedAt - audioBase64StartedAt;

    console.info(
      `[BFZoom][POCKET_PROCESS] ok totalMs=${totalMs} authMs=${authMs} formDataMs=${formDataMs} entitlementMs=${entitlementMs} transcribeMs=${transcribeMs} translateMs=${translateMs} consumeMs=${consumeMs} consumeTxMs=${consumeResult.metrics.transactionMs} consumeReadMs=${consumeResult.metrics.readMs} consumePlanMs=${consumeResult.metrics.planMs} consumeAttempts=${consumeResult.metrics.attempts} consumeMode=${consumeResult.metrics.mode} consumeWriteMode=${consumeResult.metrics.writeMode} grantMs=${grantMs} ttsMs=${ttsMs} audioBase64Ms=${audioBase64Ms} audioBytes=${audioByteLength} ttsAvailable=${ttsAvailable ? "1" : "0"} requestId=${requestId || "na"} sourceLanguage=${sourceLanguage || "auto"} targetLanguage=${targetLanguage || "auto"} usageSeconds=${usageSeconds} sourceChars=${sourceText.length} translatedChars=${translatedText.length} translationBucket=${translated.plan.bucket} requestedVoice=${requestedVoice || "auto"} usedVoice=${usedVoice} requestedFormat=${requestedFormat} locale=${requestedLocale || "auto"} clientRecordingMs=${clientRecordingMs ?? "na"} clientRecorderStopMs=${clientRecorderStopMs ?? "na"} clientPostStopSettleMs=${clientPostStopSettleMs ?? "na"} clientResolveUriMs=${clientResolveUriMs ?? "na"} clientStabilizeMs=${clientStabilizeMs ?? "na"} clientPreUploadMs=${clientPreUploadMs ?? "na"}${ttsErrorMessage ? ` ttsError=${ttsErrorMessage.replace(/\s+/g, "_").slice(0, 180)}` : ""}`
    );

    return NextResponse.json(
      {
        ok: true,
        sourceText,
        translatedText,
        ttsBase64: audioBase64,
        ttsAvailable,
        ttsError: ttsErrorMessage,
        ttsFormat: requestedFormat,
        ttsMimeType: getContentTypeForFormat(requestedFormat),
        ttsVoice: usedVoice,
        totalSecondsRemaining: consumeResult.totalSecondsRemaining,
        freeSecondsRemaining: consumeResult.freeSecondsRemaining,
        paidSecondsRemaining: consumeResult.paidSecondsRemaining,
        isAdmin: consumeResult.isAdmin,
        isPremium: consumeResult.isPremium,
        metrics: {
          totalMs,
          authMs,
          formDataMs,
          entitlementMs,
          transcribeMs,
          translateMs,
          consumeMs,
          consumeTransactionMs: consumeResult.metrics.transactionMs,
          consumeReadMs: consumeResult.metrics.readMs,
          consumePlanMs: consumeResult.metrics.planMs,
          consumeAttempts: consumeResult.metrics.attempts,
          consumeMode: consumeResult.metrics.mode,
          consumeWriteMode: consumeResult.metrics.writeMode,
          grantMs,
          ttsMs,
          audioBase64Ms,
          audioBytes: audioByteLength,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "x-bfzoom-pocket-total-ms": String(totalMs),
          "x-bfzoom-pocket-transcribe-ms": String(transcribeMs),
          "x-bfzoom-pocket-translate-ms": String(translateMs),
          "x-bfzoom-pocket-consume-ms": String(consumeMs),
          "x-bfzoom-pocket-consume-tx-ms": String(consumeResult.metrics.transactionMs),
          "x-bfzoom-pocket-consume-read-ms": String(consumeResult.metrics.readMs),
          "x-bfzoom-pocket-grant-ms": String(grantMs),
          "x-bfzoom-pocket-tts-ms": String(ttsMs),
          "x-bfzoom-pocket-request-id": requestId,
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pocket processing error.";
    console.warn(
      `[BFZoom][POCKET_PROCESS] error totalMs=${Date.now() - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} formDataMs=${formDataCompletedAt - authCompletedAt} entitlementMs=${entitlementCompletedAt - formDataCompletedAt} requestId=${requestId || "na"} sourceLanguage=${sourceLanguage || "auto"} targetLanguage=${targetLanguage || "auto"} usageSeconds=${usageSeconds || "na"} sourceChars=${sourceText.length} translatedChars=${translatedText.length} clientRecordingMs=${clientRecordingMs ?? "na"} clientRecorderStopMs=${clientRecorderStopMs ?? "na"} clientPostStopSettleMs=${clientPostStopSettleMs ?? "na"} clientResolveUriMs=${clientResolveUriMs ?? "na"} clientStabilizeMs=${clientStabilizeMs ?? "na"} clientPreUploadMs=${clientPreUploadMs ?? "na"} message=${message}`
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
