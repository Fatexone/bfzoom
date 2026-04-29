import { NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 30;
export const preferredRegion = "cdg1";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { canUseRoomFeatures } from "@/lib/roomAccess";
import { hasRoomHostTranslationAccess } from "@/lib/livekitRoomRegistry";
import { verifyGuestTtsToken } from "@/lib/guestTtsToken";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  consumeAuthenticatedPocketTtsGrant,
  restoreAuthenticatedPocketTtsGrant,
} from "@/lib/translationRuntimeGuard";

const normalizeVoice = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);

const normalizeFormat = (value: unknown): "mp3" | "pcm" | "wav" => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "pcm") return "pcm";
  if (normalized === "wav") return "wav";
  return "mp3";
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

const normalizeTtsInstructions = (value: unknown) => {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized.slice(0, 320);
};

const buildDefaultTtsInstructions = (language: string, locale: string) => {
  const normalizedLocale = normalizeLocale(locale);
  const normalizedLanguage = normalizeLanguageCode(language || normalizedLocale);

  switch (normalizedLocale || normalizedLanguage) {
    case "ar-ma":
      return "Speak entirely in Moroccan Darija with a natural North African accent. Do not use an English accent.";
  }

  switch (normalizedLanguage) {
    case "ar":
      return "Speak entirely in Arabic with a natural native Arabic accent. Do not use an English accent.";
    case "fa":
      return "Speak entirely in Persian with a natural native Persian accent. Do not use an English accent.";
    case "he":
      return "Speak entirely in Hebrew with a natural native Hebrew accent. Do not use an English accent.";
    case "hi":
      return "Speak entirely in Hindi with a natural native Hindi accent. Do not use an English accent.";
    case "ja":
      return "Speak entirely in Japanese with a natural native Japanese accent. Do not use an English accent.";
    case "ko":
      return "Speak entirely in Korean with a natural native Korean accent. Do not use an English accent.";
    case "th":
      return "Speak entirely in Thai with a natural native Thai accent. Do not use an English accent.";
    case "zh":
      return "Speak entirely in Chinese with a natural native Chinese accent. Do not use an English accent.";
    default:
      return "";
  }
};

const getContentTypeForFormat = (format: "mp3" | "pcm" | "wav") => {
  if (format === "pcm") return "audio/pcm";
  if (format === "wav") return "audio/wav";
  return "audio/mpeg";
};

const isWorkerAuthorized = (req: Request) => {
  const configuredSecret = (process.env.TRANSLATOR_WORKER_SECRET || "").trim();
  if (!configuredSecret) return false;
  const providedSecret = (req.headers.get("x-translator-worker-secret") || "").trim();
  return Boolean(providedSecret) && providedSecret === configuredSecret;
};

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  let authCompletedAt = requestStartedAt;
  let bodyCompletedAt = requestStartedAt;
  let authMode: "worker" | "guest" | "user" | "unknown" = "unknown";
  let inputChars = 0;
  let requestedFormat: "mp3" | "pcm" | "wav" = "mp3";
  let requestedVoice = "";
  let requestedLanguage = "";
  let requestedLocale = "";
  let requestedInstructions = "";
  let requestedText = "";
  let authenticatedUserUid = "";
  let pocketTtsGrantConsumed = false;
  const pocketFlow = (req.headers.get("x-bfzoom-pocket-flow") || "").trim() === "1";
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      console.error("[TTS] OPENAI_API_KEY manquante");
      return NextResponse.json({ error: "OPENAI_API_KEY manquante" }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey });

    const workerAuthorized = isWorkerAuthorized(req);
    authMode = workerAuthorized ? "worker" : "unknown";
    let rateKeyOwner = "translator-worker";

    if (!workerAuthorized) {
      const guestToken = (req.headers.get("x-bfzoom-guest-tts-token") || "").trim();
      if (guestToken) {
        const guestVerification = verifyGuestTtsToken(guestToken);
        if (!guestVerification.ok) {
          console.warn("[TTS] Guest token invalide");
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const hostTranslationEnabled = await hasRoomHostTranslationAccess(
          guestVerification.claims.room
        );
        if (!hostTranslationEnabled) {
          console.warn("[TTS] Host translation disabled for guest room");
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
          console.warn("[TTS] Utilisateur non authentifie");
          return NextResponse.json({ error: user.error }, { status: user.status });
        }
        const allowlisted = await isEmailAllowlisted(user.email);
        const allowed = canUseRoomFeatures(allowlisted);
        if (!allowed) {
          console.warn("[TTS] Acces refuse");
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        authMode = "user";
        authenticatedUserUid = user.uid;
        rateKeyOwner = user.uid;
      }
    }
    authCompletedAt = Date.now();

    const ip = getClientIp(req);
    const rate = checkRateLimit(`${rateKeyOwner}:${ip}:tts`, 12, 60_000);
    if (!rate.ok) {
      console.warn("[TTS] Rate limit depasse");
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }
    const { text, voice, format, language, locale, instructions } = (await req.json()) as {
      text?: string;
      voice?: string;
      format?: string;
      language?: string;
      locale?: string;
      instructions?: string;
    };
    const input = text?.trim();
    bodyCompletedAt = Date.now();
    requestedFormat = normalizeFormat(format);
    requestedLanguage = normalizeLanguageCode(language);
    requestedLocale = normalizeLocale(locale);
    requestedInstructions =
      normalizeTtsInstructions(instructions) ||
      buildDefaultTtsInstructions(requestedLanguage, requestedLocale);
    if (!input) {
      console.warn("[TTS] Texte manquant");
      return NextResponse.json({ error: "Texte manquant" }, { status: 400 });
    }
    requestedText = input;
    inputChars = input.length;
    requestedVoice =
      normalizeVoice(voice) || normalizeVoice(process.env.NEXT_PUBLIC_REALTIME_VOICE) || "alloy";
    if (authMode === "user" && pocketFlow) {
      const hasPocketTtsGrant = await consumeAuthenticatedPocketTtsGrant(
        authenticatedUserUid,
        input
      );
      if (!hasPocketTtsGrant) {
        console.warn("[TTS] Pocket translation grant missing");
        return NextResponse.json(
          { error: "Recent Pocket translation required." },
          { status: 409 }
        );
      }
      pocketTtsGrantConsumed = true;
    }
    try {
      let response;
      let usedVoice = requestedVoice;
      const openAiStartedAt = Date.now();
      try {
        response = await openai.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: usedVoice,
          input,
          response_format: requestedFormat,
          ...(requestedInstructions ? { instructions: requestedInstructions } : {}),
        });
      } catch (primaryError) {
        if (usedVoice === "alloy") {
          throw primaryError;
        }
        usedVoice = "alloy";
        response = await openai.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: usedVoice,
          input,
          response_format: requestedFormat,
          ...(requestedInstructions ? { instructions: requestedInstructions } : {}),
        });
      }
      const openAiCompletedAt = Date.now();
      const headersReadyMs = openAiCompletedAt - requestStartedAt;
      const authMs = authCompletedAt - requestStartedAt;
      const bodyMs = bodyCompletedAt - authCompletedAt;
      const openAiMs = openAiCompletedAt - openAiStartedAt;
      const contentType =
        response.headers.get("content-type") || getContentTypeForFormat(requestedFormat);
      const contentLength = response.headers.get("content-length");

      if (response.body) {
        console.info(
          `[BFZoom][TTS][SERVER] ok totalMs=${headersReadyMs} authMs=${authMs} bodyMs=${bodyMs} openAiMs=${openAiMs} streamMs=streaming format=${requestedFormat} requestedVoice=${requestedVoice || "auto"} usedVoice=${usedVoice} language=${requestedLanguage || "auto"} locale=${requestedLocale || "auto"} inputChars=${inputChars} audioBytes=${contentLength || "streaming"} authMode=${authMode} streaming=1`
        );

        const headers = new Headers({
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "x-bfzoom-tts-voice": usedVoice,
          "x-bfzoom-tts-format": requestedFormat,
          "x-bfzoom-tts-language": requestedLanguage || "auto",
          "x-bfzoom-tts-locale": requestedLocale || "auto",
          "x-bfzoom-tts-total-ms": String(headersReadyMs),
          "x-bfzoom-tts-openai-ms": String(openAiMs),
          "x-bfzoom-tts-arraybuffer-ms": "0",
          "x-bfzoom-tts-streaming": "1",
        });

        if (contentLength) {
          headers.set("Content-Length", contentLength);
        }

        return new NextResponse(response.body, { headers });
      }

      const arrayBufferStartedAt = Date.now();
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const arrayBufferCompletedAt = Date.now();
      const totalMs = arrayBufferCompletedAt - requestStartedAt;
      const arrayBufferMs = arrayBufferCompletedAt - arrayBufferStartedAt;
      console.info(
        `[BFZoom][TTS][SERVER] ok totalMs=${totalMs} authMs=${authMs} bodyMs=${bodyMs} openAiMs=${openAiMs} arrayBufferMs=${arrayBufferMs} format=${requestedFormat} requestedVoice=${requestedVoice || "auto"} usedVoice=${usedVoice} language=${requestedLanguage || "auto"} locale=${requestedLocale || "auto"} inputChars=${inputChars} audioBytes=${audioBuffer.byteLength} authMode=${authMode} streaming=0`
      );
      return new NextResponse(audioBuffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "x-bfzoom-tts-voice": usedVoice,
          "x-bfzoom-tts-format": requestedFormat,
          "x-bfzoom-tts-language": requestedLanguage || "auto",
          "x-bfzoom-tts-locale": requestedLocale || "auto",
          "x-bfzoom-tts-total-ms": String(totalMs),
          "x-bfzoom-tts-openai-ms": String(openAiMs),
          "x-bfzoom-tts-arraybuffer-ms": String(arrayBufferMs),
          "x-bfzoom-tts-streaming": "0",
        },
      });
    } catch (ttsError) {
      if (pocketTtsGrantConsumed && authenticatedUserUid) {
        await restoreAuthenticatedPocketTtsGrant(authenticatedUserUid, input).catch(() => {});
        pocketTtsGrantConsumed = false;
      }
      console.error(
        `[BFZoom][TTS][SERVER] error totalMs=${Date.now() - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} bodyMs=${bodyCompletedAt - authCompletedAt} format=${requestedFormat} requestedVoice=${requestedVoice || "auto"} language=${requestedLanguage || "auto"} locale=${requestedLocale || "auto"} inputChars=${inputChars} authMode=${authMode}`
      );
      console.error("[TTS] Erreur OpenAI TTS");
      return NextResponse.json({ error: "Erreur OpenAI TTS" }, { status: 500 });
    }
  } catch (error) {
    if (pocketTtsGrantConsumed && authenticatedUserUid) {
      await restoreAuthenticatedPocketTtsGrant(authenticatedUserUid, requestedText).catch(
        () => {}
      );
    }
    console.error(
      `[BFZoom][TTS][SERVER] fatal totalMs=${Date.now() - requestStartedAt} authMs=${authCompletedAt - requestStartedAt} bodyMs=${bodyCompletedAt - authCompletedAt} format=${requestedFormat} requestedVoice=${requestedVoice || "auto"} language=${requestedLanguage || "auto"} locale=${requestedLocale || "auto"} inputChars=${inputChars} authMode=${authMode}`
    );
    console.error("[TTS] Erreur generale");
    const message = error instanceof Error ? error.message : "Erreur TTS";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
