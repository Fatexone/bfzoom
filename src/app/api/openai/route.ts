import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const STREAM_TIMEOUT_MS = 60_000;

async function streamResponse(
  messages: ChatCompletionMessageParam[],
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
        temperature: 0.7,
        max_tokens: 800,
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
    const allowed = await isEmailAllowlisted(user.email);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ip = getClientIp(req);
    const rate = checkRateLimit(`${user.uid}:${ip}:openai`, 20, 60_000);
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    if (wantsStream) {
      try {
        const streamed = await streamResponse(messages, controller.signal);
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
      const response = await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages,
          temperature: 0.7,
          max_tokens: 800,
        },
        { signal: controller.signal }
      );
      return NextResponse.json(response);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("Erreur avec OpenAI :", error);
    const message =
      error instanceof Error ? error.message : "Une erreur est survenue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
