import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";

const COLLECTION = "ai_background_jobs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "JobId manquant." }, { status: 400 });
  }

  const db = getAdminDb();
  const doc = await db.collection(COLLECTION).doc(jobId).get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
  }

  const data = doc.data();
  const imageUrl = data?.imageUrl as string | undefined;
  if (!imageUrl) {
    return NextResponse.json({ error: "Aucune image disponible pour ce job." }, { status: 404 });
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    return NextResponse.json({ error: "Impossible de récupérer l'image." }, { status: 502 });
  }

  const buffer = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get("content-type") ?? "image/png";

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=60",
  });

  return new NextResponse(buffer, { headers });
}
