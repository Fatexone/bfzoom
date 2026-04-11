import type { AiPracticeNotebookEntry } from "@/lib/aiPracticeNotebook";

export type NotebookPlaybackMode = "target_only" | "target_base" | "repeat";

export const DEFAULT_NOTEBOOK_VOICE = process.env.NEXT_PUBLIC_REALTIME_VOICE || "ash";
export const NOTEBOOK_AUDIO_FORMAT = "mp3";
export const NOTEBOOK_AUDIO_CACHE_VERSION = "v1";

type NotebookAudioSource = Pick<AiPracticeNotebookEntry, "baseText" | "targetText">;

export const normalizeNotebookPlaybackMode = (value: unknown): NotebookPlaybackMode => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "target_only") return "target_only";
  if (normalized === "target_base") return "target_base";
  return "repeat";
};

export const normalizeNotebookVoice = (value: unknown, fallback = DEFAULT_NOTEBOOK_VOICE) =>
  String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32) || fallback;

const hashNotebookAudioKey = (input: string) => {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

const normalizeNotebookAudioText = (value: string) =>
  value.replace(/\s+/g, " ").trim();

export const buildNotebookAudioText = (
  entry: NotebookAudioSource,
  mode: NotebookPlaybackMode
) => {
  const target = entry.targetText.trim();
  const base = entry.baseText.trim();
  if (!target) return "";
  if (mode === "target_only") {
    return target;
  }
  const normalizedTarget = normalizeNotebookAudioText(target).toLowerCase();
  const normalizedBase = normalizeNotebookAudioText(base).toLowerCase();
  const shouldReadBase = Boolean(base && normalizedBase && normalizedBase !== normalizedTarget);
  if (mode === "target_base") {
    return shouldReadBase ? `${target}. ${base}.` : target;
  }
  return shouldReadBase ? `${target}. ${base}. ${target}.` : target;
};

export const buildNotebookAudioStoragePath = ({
  uid,
  entryId,
  text,
  voice,
  mode,
}: {
  uid: string;
  entryId: string;
  text: string;
  voice: string;
  mode: NotebookPlaybackMode;
}) => {
  const resolvedVoice = normalizeNotebookVoice(voice);
  const normalizedText = normalizeNotebookAudioText(text);
  const source = [
    NOTEBOOK_AUDIO_CACHE_VERSION,
    NOTEBOOK_AUDIO_FORMAT,
    mode,
    resolvedVoice,
    normalizedText,
  ].join("|");
  const digest = `${hashNotebookAudioKey(source)}-${source.length.toString(36)}`;
  return `users/${uid}/ai-practice-notebook-audio/${entryId}/${mode}-${resolvedVoice}-${digest}.${NOTEBOOK_AUDIO_FORMAT}`;
};

export const buildNotebookAudioRequestUrl = ({
  entryId,
  mode,
  voice,
}: {
  entryId: string;
  mode: NotebookPlaybackMode;
  voice?: string;
}) => {
  const params = new URLSearchParams({
    mode,
    voice: normalizeNotebookVoice(voice),
  });
  return `/api/ai-practice/notebook/${encodeURIComponent(entryId)}/audio?${params.toString()}`;
};
