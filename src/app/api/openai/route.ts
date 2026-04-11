import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { hasRoomHostTranslationAccess } from "@/lib/livekitRoomRegistry";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { verifyGuestTtsToken } from "@/lib/guestTtsToken";
import {
  consumeAuthenticatedTranslationGrant,
  issueAuthenticatedPocketTtsGrant,
  restoreAuthenticatedTranslationGrant,
} from "@/lib/translationRuntimeGuard";

// Important for serverless providers (e.g. Vercel) where default function
// duration can be too short for structured lesson generation requests.
export const maxDuration = 60;

const STREAM_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_TOKENS = 800;
const JSON_MODE_MAX_TOKENS = 700;
const MIN_MAX_TOKENS = 64;
const MAX_MAX_TOKENS = 1_200;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1.2;
const AUTHENTICATED_MAX_TIMEOUT_MS = 45_000;
const AUTHENTICATED_MAX_TOKENS = 700;
const DEFAULT_AUTHENTICATED_RATE_LIMIT = 10;
const AUTHENTICATED_TRANSLATION_RATE_LIMIT = 18;
const AUTHENTICATED_COACH_RATE_LIMIT = 12;
const ALLOWLISTED_RATE_LIMIT = 24;
const TRANSLATION_SHORT_MAX_TOKENS = 96;
const TRANSLATION_MEDIUM_MAX_TOKENS = 140;
const TRANSLATION_LONG_MAX_TOKENS = 180;
const COMPACT_SCRIPT_REGEX =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff]/;

const getAiAccessMode = () =>
  (process.env.BFZOOM_AI_ACCESS_MODE || "authenticated").trim().toLowerCase();

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const parseOptionalNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

type TranslationTokenBucket = "short" | "medium" | "long";

type TranslationTokenPlan = {
  bucket: TranslationTokenBucket;
  maxTokens: number;
  sourceChars: number;
  sourceWords: number;
  compactScript: boolean;
  estimatedBudget: number;
};

const extractLastUserText = (messages: ChatCompletionMessageParam[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content.trim();
  }
  return "";
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

async function streamResponse(
  messages: ChatCompletionMessageParam[],
  options: {
    maxTokens: number;
    temperature: number;
  },
  openai: OpenAI,
  signal: AbortSignal
): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  try {
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      },
      { signal }
    );

    (async () => {
      try {
        for await (const part of completion) {
          const content = part.choices?.[0]?.delta?.content;
          if (content) {
            await writer.write(encoder.encode(content));
          }
        }
      } catch (streamError) {
        console.error("Erreur de stream OpenAI :", streamError);
        writer.abort(streamError);
        return;
      }
      writer.close();
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    writer.abort(error);
    throw error;
  }
}

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  let authCompletedAt = requestStartedAt;
  let bodyCompletedAt = requestStartedAt;
  let authMode: "guest" | "user" | "unknown" = "unknown";
  let intent = "default";
  let messageCount = 0;
  let wantsStream = false;
  let wantsJsonMode = false;
  let maxTokens = DEFAULT_MAX_TOKENS;
  let temperature = 0.7;
  let translationBucket = "na";
  let sourceChars = "na";
  let sourceWords = "na";
  let compactScript = "na";
  let estimatedBudget = "na";
  let authenticatedUserUid = "";
  let translationGrantConsumed = false;
  const pocketFlow = (req.headers.get("x-bfzoom-pocket-flow") || "").trim() === "1";
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY manquante" },
      { status: 500 }
    );
  }
  const openai = new OpenAI({ apiKey });

  try {
    const body = (await req.json()) as {
      intent?: unknown;
      messages?: unknown;
      stream?: unknown;
      jsonMode?: unknown;
      timeoutMs?: unknown;
      maxTokens?: unknown;
      temperature?: unknown;
    };
    bodyCompletedAt = Date.now();
    intent =
      typeof body.intent === "string" && body.intent.trim()
        ? body.intent.trim().toLowerCase()
        : "default";
    const guestIntentAllowed = intent === "translation" || intent === "phonetic";
    let rateKeyOwner = "";
    let allowlisted = false;
    const guestToken = (req.headers.get("x-bfzoom-guest-tts-token") || "").trim();
    if (guestToken && guestIntentAllowed) {
      const guestVerification = verifyGuestTtsToken(guestToken);
      if (!guestVerification.ok) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const hostTranslationEnabled = await hasRoomHostTranslationAccess(
        guestVerification.claims.room
      );
      if (!hostTranslationEnabled) {
        return NextResponse.json(
          { error: "Host translation is unavailable for this room." },
          { status: 403 }
        );
      }
      authMode = "guest";
      rateKeyOwner = `guest:${guestVerification.claims.room}:${guestVerification.claims.identity}`;
    } else {
      const user = await getVerifiedUser(req);
      if (!user.ok) {
        return NextResponse.json({ error: user.error }, { status: user.status });
      }
      authenticatedUserUid = user.uid;
      allowlisted = await isEmailAllowlisted(user.email);
      const accessMode = getAiAccessMode();
      const authenticatedAccessAllowed = accessMode !== "allowlist";
      if (!allowlisted && !authenticatedAccessAllowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      authMode = "user";
      rateKeyOwner = user.uid;
    }
    authCompletedAt = Date.now();

    const ip = getClientIp(req);
    const authenticatedRateProfile = (() => {
      switch (intent) {
        case "translation":
          return {
            keySuffix: "translation",
            limit: AUTHENTICATED_TRANSLATION_RATE_LIMIT,
          };
        case "coach_ai":
          return {
            keySuffix: "coach_ai",
            limit: AUTHENTICATED_COACH_RATE_LIMIT,
          };
        default:
          return {
            keySuffix: "default",
            limit: DEFAULT_AUTHENTICATED_RATE_LIMIT,
          };
      }
    })();
    const rate = checkRateLimit(
      `${rateKeyOwner}:${ip}:openai:${allowlisted ? "allowlisted" : authMode === "guest" ? intent : authenticatedRateProfile.keySuffix}`,
      allowlisted ? ALLOWLISTED_RATE_LIMIT : authenticatedRateProfile.limit,
      60_000
    );
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }
    if (authMode === "user" && intent === "translation") {
      const hasTranslationGrant = await consumeAuthenticatedTranslationGrant(authenticatedUserUid);
      if (!hasTranslationGrant) {
        return NextResponse.json(
          { error: "Recent translation consumption required." },
          { status: 409 }
        );
      }
      translationGrantConsumed = true;
    }
    const messages: ChatCompletionMessageParam[] = Array.isArray(body.messages)
      ? (body.messages as ChatCompletionMessageParam[])
      : [];
    messageCount = messages.length;
    wantsStream = Boolean(body.stream);
    wantsJsonMode = Boolean(body.jsonMode);
    const requestedTimeoutMs = parseOptionalNumber(
      (body as { timeoutMs?: unknown }).timeoutMs
    );
    const requestedMaxTokens = parseOptionalNumber(
      (body as { maxTokens?: unknown }).maxTokens
    );
    const requestedTemperature = parseOptionalNumber(
      (body as { temperature?: unknown }).temperature
    );
    if (intent === "translation") {
      const translationPlan = getServerTranslationPlan(extractLastUserText(messages));
      translationBucket = translationPlan.bucket;
      sourceChars = String(translationPlan.sourceChars);
      sourceWords = String(translationPlan.sourceWords);
      compactScript = translationPlan.compactScript ? "1" : "0";
      estimatedBudget = String(translationPlan.estimatedBudget);
      maxTokens = clampNumber(
        translationPlan.maxTokens,
        MIN_MAX_TOKENS,
        allowlisted ? MAX_MAX_TOKENS : AUTHENTICATED_MAX_TOKENS
      );
    }

    const timeoutMs = clampNumber(
      requestedTimeoutMs ?? STREAM_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      allowlisted ? MAX_TIMEOUT_MS : AUTHENTICATED_MAX_TIMEOUT_MS
    );
    if (intent !== "translation") {
      maxTokens = clampNumber(
        requestedMaxTokens ?? (wantsJsonMode ? JSON_MODE_MAX_TOKENS : DEFAULT_MAX_TOKENS),
        MIN_MAX_TOKENS,
        allowlisted ? MAX_MAX_TOKENS : AUTHENTICATED_MAX_TOKENS
      );
    }
    temperature = clampNumber(
      requestedTemperature ?? (wantsJsonMode ? 0.2 : 0.7),
      MIN_TEMPERATURE,
      MAX_TEMPERATURE
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (wantsStream) {
      try {
        const streamStartedAt = Date.now();
        const streamed = await streamResponse(
          messages,
          {
            maxTokens,
            temperature,
          },
          openai,
          controller.signal
        );
        clearTimeout(timeout);
        console.info(
          `[BFZoom][OPENAI] ok totalMs=${Date.now() - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} bodyMs=${bodyCompletedAt - requestStartedAt} openAiMs=${Date.now() - streamStartedAt} intent=${intent} authMode=${authMode} stream=1 jsonMode=${wantsJsonMode ? 1 : 0} maxTokens=${maxTokens} temperature=${temperature} messages=${messageCount} bucket=${translationBucket} sourceChars=${sourceChars} sourceWords=${sourceWords} compactScript=${compactScript} estimatedBudget=${estimatedBudget}`
        );
        return streamed;
      } catch (streamError) {
        if (translationGrantConsumed && authenticatedUserUid) {
          await restoreAuthenticatedTranslationGrant(authenticatedUserUid).catch(() => {});
          translationGrantConsumed = false;
        }
        console.error("Erreur streaming OpenAI :", streamError);
        clearTimeout(timeout);
        return NextResponse.json(
          { error: "Erreur de streaming" },
          { status: 500 }
        );
      }
    }

    try {
      const completionRequest: ChatCompletionCreateParamsNonStreaming = {
        model: "gpt-4o-mini",
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (wantsJsonMode) {
        completionRequest.response_format = { type: "json_object" };
      }
      const openAiStartedAt = Date.now();
      const response = await openai.chat.completions.create(
        completionRequest,
        { signal: controller.signal }
      );
      const openAiCompletedAt = Date.now();
      const translatedText =
        typeof response.choices?.[0]?.message?.content === "string"
          ? response.choices[0].message.content.trim()
          : "";
      if (
        authMode === "user" &&
        intent === "translation" &&
        pocketFlow &&
        authenticatedUserUid &&
        translatedText
      ) {
        await issueAuthenticatedPocketTtsGrant(authenticatedUserUid, translatedText);
      }
      console.info(
        `[BFZoom][OPENAI] ok totalMs=${openAiCompletedAt - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} bodyMs=${bodyCompletedAt - requestStartedAt} openAiMs=${openAiCompletedAt - openAiStartedAt} intent=${intent} authMode=${authMode} stream=0 jsonMode=${wantsJsonMode ? 1 : 0} maxTokens=${maxTokens} temperature=${temperature} messages=${messageCount} bucket=${translationBucket} sourceChars=${sourceChars} sourceWords=${sourceWords} compactScript=${compactScript} estimatedBudget=${estimatedBudget}`
      );
      return NextResponse.json(response);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (translationGrantConsumed && authenticatedUserUid) {
      await restoreAuthenticatedTranslationGrant(authenticatedUserUid).catch(() => {});
    }
    console.error(
      `[BFZoom][OPENAI] error totalMs=${Date.now() - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} bodyMs=${bodyCompletedAt - requestStartedAt} intent=${intent} authMode=${authMode} stream=${wantsStream ? 1 : 0} jsonMode=${wantsJsonMode ? 1 : 0} maxTokens=${maxTokens} temperature=${temperature} messages=${messageCount} bucket=${translationBucket} sourceChars=${sourceChars} sourceWords=${sourceWords} compactScript=${compactScript} estimatedBudget=${estimatedBudget}`
    );
    console.error("Erreur avec OpenAI :", error);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "OpenAI timeout: demande trop longue, réessaie avec une requête plus courte." },
        { status: 504 }
      );
    }
    const message =
      error instanceof Error ? error.message : "Une erreur est survenue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
