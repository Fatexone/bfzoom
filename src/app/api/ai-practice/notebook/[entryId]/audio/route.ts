import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getAdminBucket, getAdminDb } from "@/lib/firebaseAdmin";
import { getVerifiedUser } from "@/lib/serverAuth";
import { AI_PRACTICE_NOTEBOOK_COLLECTION, type AiPracticeNotebookEntry } from "@/lib/aiPracticeNotebook";
import {
  buildNotebookAudioStoragePath,
  buildNotebookAudioText,
  DEFAULT_NOTEBOOK_VOICE,
  NOTEBOOK_AUDIO_FORMAT,
  normalizeNotebookPlaybackMode,
  normalizeNotebookVoice,
  type NotebookPlaybackMode,
} from "@/lib/aiPracticeNotebookAudio";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const toNotebookAudioEntry = (
  data: Record<string, unknown> | undefined
): Pick<AiPracticeNotebookEntry, "targetText" | "baseText" | "voice"> => ({
  targetText: String(data?.targetText || ""),
  baseText: String(data?.baseText || ""),
  voice: String(data?.voice || ""),
});

const synthesizeNotebookAudio = async ({
  text,
  voice,
}: {
  text: string;
  voice: string;
}) => {
  let usedVoice = voice;
  try {
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: usedVoice,
      input: text,
      response_format: NOTEBOOK_AUDIO_FORMAT,
    });
    return {
      usedVoice,
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  } catch (primaryError) {
    if (usedVoice === "alloy") {
      throw primaryError;
    }
    usedVoice = "alloy";
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: usedVoice,
      input: text,
      response_format: NOTEBOOK_AUDIO_FORMAT,
    });
    return {
      usedVoice,
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }
};

const buildAudioResponse = ({
  buffer,
  cacheStatus,
  storagePath,
  voice,
  mode,
}: {
  buffer: Buffer;
  cacheStatus: "hit" | "miss";
  storagePath: string;
  voice: string;
  mode: NotebookPlaybackMode;
}) =>
  new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(buffer.byteLength),
      "x-bfzoom-notebook-audio-cache": cacheStatus,
      "x-bfzoom-notebook-audio-path": storagePath,
      "x-bfzoom-notebook-audio-voice": voice,
      "x-bfzoom-notebook-audio-mode": mode,
    },
  });

export async function GET(
  req: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY manquante" }, { status: 500 });
  }

  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(`${user.uid}:${ip}:ai-practice-notebook:audio`, 90, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Rate limit" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const { entryId } = await context.params;
  const trimmedId = entryId.trim();
  if (!trimmedId) {
    return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
  }

  const url = new URL(req.url);
  const mode = normalizeNotebookPlaybackMode(url.searchParams.get("mode"));
  const requestedVoice = normalizeNotebookVoice(url.searchParams.get("voice"), DEFAULT_NOTEBOOK_VOICE);

  const entrySnap = await getAdminDb()
    .collection("users")
    .doc(user.uid)
    .collection(AI_PRACTICE_NOTEBOOK_COLLECTION)
    .doc(trimmedId)
    .get();

  if (!entrySnap.exists) {
    return NextResponse.json({ error: "Phrase introuvable." }, { status: 404 });
  }

  const entry = toNotebookAudioEntry(entrySnap.data());
  const text = buildNotebookAudioText(entry, mode);
  if (!text) {
    return NextResponse.json({ error: "Texte audio manquant." }, { status: 400 });
  }

  const storagePath = buildNotebookAudioStoragePath({
    uid: user.uid,
    entryId: trimmedId,
    text,
    voice: requestedVoice,
    mode,
  });
  const file = getAdminBucket().file(storagePath);

  const [exists] = await file.exists();
  if (exists) {
    const [buffer] = await file.download();
    return buildAudioResponse({
      buffer,
      cacheStatus: "hit",
      storagePath,
      voice: requestedVoice,
      mode,
    });
  }

  try {
    const { buffer, usedVoice } = await synthesizeNotebookAudio({
      text,
      voice: requestedVoice || normalizeNotebookVoice(entry.voice, DEFAULT_NOTEBOOK_VOICE),
    });

    await file.save(buffer, {
      resumable: false,
      contentType: "audio/mpeg",
      metadata: {
        cacheControl: "private, max-age=31536000, immutable",
        metadata: {
          entryId: trimmedId,
          mode,
          requestedVoice,
          usedVoice,
        },
      },
    });

    return buildAudioResponse({
      buffer,
      cacheStatus: "miss",
      storagePath,
      voice: usedVoice,
      mode,
    });
  } catch (error) {
    console.error("[AI Practice Notebook Audio] generation failed", error);
    return NextResponse.json({ error: "Erreur OpenAI TTS" }, { status: 500 });
  }
}
