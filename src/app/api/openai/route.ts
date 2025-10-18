import { NextResponse } from "next/server";
import OpenAI from "openai";

// Initialisation d'OpenAI avec la clé API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Assure-toi que ta clé est dans le fichier .env
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // Utilisation correcte de `chat.completions.create()`
    const response = await openai.chat.completions.create({
      model: "gpt-4", // Ou "gpt-3.5-turbo" si tu préfères
      messages: messages, // Liste des messages du chat
      temperature: 0.7,
      max_tokens: 500,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("Erreur avec OpenAI :", error);
    return NextResponse.json({ error: "Une erreur est survenue" }, { status: 500 });
  }
}
