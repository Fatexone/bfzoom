import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function streamResponse(
  messages: ChatCompletionMessageParam[],
  options: {
    maxTokens: number;
    temperature: number;
  },
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
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY manquante" },
      { status: 500 }
    );
  }

  try {
    const user = await getVerifiedUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }
    const allowlisted = await isEmailAllowlisted(user.email);
    const accessMode = getAiAccessMode();
    const authenticatedAccessAllowed = accessMode !== "allowlist";
    if (!allowlisted && !authenticatedAccessAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ip = getClientIp(req);
    const rate = checkRateLimit(
      `${user.uid}:${ip}:openai:${allowlisted ? "allowlisted" : "auth"}`,
      allowlisted ? 20 : 8,
      60_000
    );
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const body = await req.json();
    const messages: ChatCompletionMessageParam[] = Array.isArray(body.messages)
      ? (body.messages as ChatCompletionMessageParam[])
      : [];
    const wantsStream = Boolean(body.stream);
    const wantsJsonMode = Boolean(body.jsonMode);
    const requestedTimeoutMs = parseOptionalNumber(
      (body as { timeoutMs?: unknown }).timeoutMs
    );
    const requestedMaxTokens = parseOptionalNumber(
      (body as { maxTokens?: unknown }).maxTokens
    );
    const requestedTemperature = parseOptionalNumber(
      (body as { temperature?: unknown }).temperature
    );

    const timeoutMs = clampNumber(
      requestedTimeoutMs ?? STREAM_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      allowlisted ? MAX_TIMEOUT_MS : AUTHENTICATED_MAX_TIMEOUT_MS
    );
    const maxTokens = clampNumber(
      requestedMaxTokens ?? (wantsJsonMode ? JSON_MODE_MAX_TOKENS : DEFAULT_MAX_TOKENS),
      MIN_MAX_TOKENS,
      allowlisted ? MAX_MAX_TOKENS : AUTHENTICATED_MAX_TOKENS
    );
    const temperature = clampNumber(
      requestedTemperature ?? (wantsJsonMode ? 0.2 : 0.7),
      MIN_TEMPERATURE,
      MAX_TEMPERATURE
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (wantsStream) {
      try {
        const streamed = await streamResponse(
          messages,
          {
            maxTokens,
            temperature,
          },
          controller.signal
        );
        clearTimeout(timeout);
        return streamed;
      } catch (streamError) {
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
      const response = await openai.chat.completions.create(
        completionRequest,
        { signal: controller.signal }
      );
      return NextResponse.json(response);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
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
