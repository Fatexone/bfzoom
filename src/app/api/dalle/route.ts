import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  const { prompt } = (await request.json()) as { prompt?: string };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "Prompt manquant." }, { status: 400 });
  }

  try {
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt.trim(),
      size: "1024x1024",
      response_format: "b64_json",
    });
    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      return NextResponse.json({ error: "Impossible de generer l'image." }, { status: 500 });
    }
    return NextResponse.json({ image: `data:image/png;base64,${imageData}` });
  } catch (err) {
    console.error("Erreur generation DALL·E :", err);
    return NextResponse.json({ error: "Erreur OpenAI." }, { status: 500 });
  }
}
