import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { SessionCreateParams } from "openai/resources/beta/realtime/sessions";
import { getVerifiedUser } from "@/lib/serverAuth";
import { getUserTranslationEntitlement } from "@/lib/translationEntitlement";
import { buildTranslationLockedReason } from "@/lib/translationCredits";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;

type AiPracticeRealtimeSessionRequest = {
  language?: unknown;
  targetLanguage?: unknown;
  voice?: unknown;
  instructions?: unknown;
  transcriptionLanguage?: unknown;
  transcriptionPrompt?: unknown;
  conversationFocus?: unknown;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_REALTIME_MODEL: SessionCreateParams["model"] =
  "gpt-4o-mini-realtime-preview";

const ALLOWED_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
]);

const normalizeText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

const normalizeVoice = (value: unknown) => {
  const normalized = normalizeText(value, 32).toLowerCase();
  return ALLOWED_VOICES.has(normalized) ? normalized : "";
};

const normalizeLocale = (value: unknown) => {
  const normalized = normalizeText(value, 16).toLowerCase();
  return normalized.replace(/[^a-z-]/g, "").slice(0, 16);
};

const buildInstructions = ({
  language,
  targetLanguage,
  customInstructions,
  conversationFocus,
}: {
  language: string;
  targetLanguage: string;
  customInstructions: string;
  conversationFocus: string;
}) => {
  const lines = [
    "You are BFZoom AI Practice, a fast live language coach.",
    "Reply with one short natural sentence and keep the learner speaking.",
    "Ask at most one short follow-up question.",
    "Correct gently only when it helps the learner continue.",
    "Sound like a lively mentor: warm, perceptive, lightly witty, and easy to talk to.",
    "A little humor or perspective is welcome when it feels natural.",
    "Do not act like a therapist or abstract philosopher. Stay concrete and useful.",
    "Keep the current topic and build on the last exchange unless the learner clearly changes subject.",
    "Short replies such as yes, no, okay, maybe, or tell me more always refer to your previous question or explanation.",
    "Do not restart the conversation or ask what topic the learner wants unless this is the first turn or the learner explicitly asks to change topic.",
    "If the learner answer is brief or ambiguous, continue the same thread or ask a short clarification about the same thread.",
  ];

  if (language) {
    lines.push(`Learner source language: ${language}.`);
  }
  if (targetLanguage) {
    lines.push(`Target language: ${targetLanguage}.`);
  }
  if (customInstructions) {
    lines.push(`Additional guidance: ${customInstructions}`);
  }
  if (conversationFocus) {
    lines.push(`Current thread to preserve: ${conversationFocus}`);
    lines.push(
      "If this session reconnects or restarts, continue that thread immediately instead of resetting the conversation."
    );
  }

  return lines.join("\n");
};

const buildSessionParams = (
  body: AiPracticeRealtimeSessionRequest
): SessionCreateParams => {
  const language = normalizeLocale(body.language);
  const targetLanguage = normalizeLocale(body.targetLanguage);
  const voice = normalizeVoice(body.voice) || "ash";
  const customInstructions = normalizeText(body.instructions, 800);
  const conversationFocus = normalizeText(body.conversationFocus, 420);
  const transcriptionLanguage = normalizeLocale(body.transcriptionLanguage);
  const transcriptionPrompt = normalizeText(body.transcriptionPrompt, 240);

  return {
    client_secret: {
      expires_at: {
        anchor: "created_at",
        seconds: 60,
      },
    },
    model: DEFAULT_REALTIME_MODEL,
    modalities: ["audio"],
    input_audio_format: "pcm16",
    input_audio_noise_reduction: {
      type: "far_field",
    },
    output_audio_format: "pcm16",
    max_response_output_tokens: 120,
    temperature: 0.5,
    voice,
    turn_detection: {
      type: "semantic_vad",
      create_response: true,
      interrupt_response: true,
      eagerness: "high",
    },
    input_audio_transcription: {
      model: "gpt-4o-mini-transcribe",
      ...(transcriptionLanguage ? { language: transcriptionLanguage } : {}),
      ...(transcriptionPrompt ? { prompt: transcriptionPrompt } : {}),
    },
    instructions: buildInstructions({
      language,
      targetLanguage,
      customInstructions,
      conversationFocus,
    }),
  };
};

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY manquante" },
        { status: 500 }
      );
    }

    const user = await getVerifiedUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }

    const entitlement = await getUserTranslationEntitlement({
      uid: user.uid,
      email: user.email,
    });
    if (!entitlement.enabled) {
      return NextResponse.json(
        {
          error: buildTranslationLockedReason(),
          enabled: false,
        },
        { status: 403 }
      );
    }

    const ip = getClientIp(req);
    const rate = checkRateLimit(`${user.uid}:${ip}:ai-practice:realtime-session`, 12, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    let body: AiPracticeRealtimeSessionRequest = {};
    try {
      body = (await req.json()) as AiPracticeRealtimeSessionRequest;
    } catch {
      body = {};
    }

    const session = await openai.beta.realtime.sessions.create(buildSessionParams(body));
    return NextResponse.json(session, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur de creation de session Realtime";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
