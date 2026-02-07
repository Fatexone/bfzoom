import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY manquante" }, { status: 500 });
    }
    const user = await getVerifiedUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }
    const allowed = await isEmailAllowlisted(user.email);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const ip = getClientIp(req);
    const rate = checkRateLimit(`${user.uid}:${ip}:tts`, 12, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }
    const { text, voice } = (await req.json()) as { text?: string; voice?: string };
    const input = text?.trim();
    if (!input) {
      return NextResponse.json({ error: "Texte manquant" }, { status: 400 });
    }
    const allowedVoices = new Set(["alloy", "echo", "fable", "nova", "onyx", "shimmer"]);
    const selectedVoice = allowedVoices.has(voice || "") ? (voice as string) : "alloy";
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: selectedVoice,
      input,
    });
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur TTS";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}