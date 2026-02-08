import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

const COLLECTION = "ai_background_jobs";

type JobStatus = "pending" | "processing" | "complete" | "error";

export async function POST(request: Request) {
  const { prompt } = (await request.json()) as { prompt?: string };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "Prompt manquant." }, { status: 400 });
  }

  const db = getAdminDb();
  const now = Timestamp.now();
  const docRef = db.collection(COLLECTION).doc();
  await docRef.set({
    prompt: prompt.trim(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ jobId: docRef.id, status: "pending" });
}

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

  const data = doc.data() as
    | {
        prompt?: string;
        status?: JobStatus;
        imageUrl?: string;
        errorMessage?: string;
        updatedAt?: Timestamp;
      }
    | undefined;

  const updatedAt = data?.updatedAt;
  const updatedAtIso = updatedAt
    ? updatedAt instanceof Timestamp
      ? updatedAt.toDate().toISOString()
      : new Date(updatedAt).toISOString()
    : undefined;

  return NextResponse.json({
    jobId,
    prompt: data?.prompt,
    status: (data?.status as JobStatus) ?? "pending",
    imageUrl: data?.imageUrl,
    errorMessage: data?.errorMessage,
    updatedAt: updatedAtIso,
  });
}
