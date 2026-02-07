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
    const rate = checkRateLimit(`${user.uid}:${ip}:transcribe`, 10, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Rate limit" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fichier audio manquant" }, { status: 400 });
    }

    const response = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
    });

    return NextResponse.json({ text: response.text || "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur transcription";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}