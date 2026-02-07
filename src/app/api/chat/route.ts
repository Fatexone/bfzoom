import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message }: { message?: string } = await req.json();

    if (!message || message.trim() === "") {
      return NextResponse.json({ error: "Message manquant" }, { status: 400 });
    }

    // Traitement éventuel du message (placeholder)
    return NextResponse.json({ success: true, message: "Message reçu." }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}