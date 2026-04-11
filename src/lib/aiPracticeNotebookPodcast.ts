import type { AiPracticeNotebookEntry } from "@/lib/aiPracticeNotebook";
import { formatNotebookChargeMinutes } from "@/lib/aiPracticeNotebook";
import {
  buildNotebookAudioText,
  DEFAULT_NOTEBOOK_VOICE,
  normalizeNotebookVoice,
  type NotebookPlaybackMode,
} from "@/lib/aiPracticeNotebookAudio";

export const AI_PRACTICE_NOTEBOOK_PODCAST_COLLECTION = "ai_practice_notebook_podcasts";
export const AI_PRACTICE_NOTEBOOK_PODCAST_USAGE_COLLECTION =
  "ai_practice_notebook_podcast_usage";
export const AI_PRACTICE_NOTEBOOK_PODCAST_CHARGE_SECONDS = 45;
export const NOTEBOOK_PODCAST_CACHE_VERSION = "v1";
export const NOTEBOOK_PODCAST_AUDIO_FORMAT = "wav";
export const NOTEBOOK_PODCAST_TTS_CHAR_LIMIT = 4096;
export const NOTEBOOK_PODCAST_MAX_TOTAL_CHARACTERS = 16384;
export const NOTEBOOK_PODCAST_MAX_ESTIMATED_SECONDS = 180;
export const NOTEBOOK_PODCAST_PCM_SAMPLE_RATE = 24000;
export const NOTEBOOK_PODCAST_PCM_CHANNELS = 1;
export const NOTEBOOK_PODCAST_PCM_BITS_PER_SAMPLE = 16;

const hashNotebookPodcastKey = (input: string) => {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

type NotebookPodcastEntrySource = Pick<
  AiPracticeNotebookEntry,
  "createdAtMs" | "baseText" | "targetText"
>;

const sortNotebookEntriesForPodcast = (entries: NotebookPodcastEntrySource[]) =>
  [...entries].sort((left, right) => left.createdAtMs - right.createdAtMs);

const splitOversizedBlock = (value: string, maxLength: number) => {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(". ", maxLength);
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }
    const head = remaining.slice(0, splitIndex).trim();
    if (head) {
      parts.push(head);
    }
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
};

export const buildNotebookPodcastDraft = ({
  entries,
  mode,
  voice,
}: {
  entries: NotebookPodcastEntrySource[];
  mode: NotebookPlaybackMode;
  voice?: string;
}) => {
  const resolvedVoice = normalizeNotebookVoice(voice, DEFAULT_NOTEBOOK_VOICE);
  const textBlocks = sortNotebookEntriesForPodcast(entries)
    .map((entry) => buildNotebookAudioText(entry, mode).trim())
    .filter(Boolean);
  const joinedText = textBlocks.join("\n\n");
  const totalCharacters = joinedText.length;
  const wordCount = joinedText
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean).length;
  const estimatedSeconds = Math.ceil(
    Math.max(totalCharacters / 18, wordCount / 2.5, textBlocks.length * 2)
  );
  const source = [
    NOTEBOOK_PODCAST_CACHE_VERSION,
    NOTEBOOK_PODCAST_AUDIO_FORMAT,
    mode,
    resolvedVoice,
    joinedText,
  ].join("|");
  const digest = `${hashNotebookPodcastKey(source)}-${source.length.toString(36)}`;
  return {
    resolvedVoice,
    textBlocks,
    joinedText,
    totalCharacters,
    estimatedSeconds,
    entryCount: textBlocks.length,
    podcastHash: digest,
    eligible:
      textBlocks.length > 0 &&
      totalCharacters > 0 &&
      totalCharacters <= NOTEBOOK_PODCAST_MAX_TOTAL_CHARACTERS &&
      estimatedSeconds <= NOTEBOOK_PODCAST_MAX_ESTIMATED_SECONDS,
  };
};

export const buildNotebookPodcastChunks = ({
  textBlocks,
  maxChunkCharacters = NOTEBOOK_PODCAST_TTS_CHAR_LIMIT,
}: {
  textBlocks: string[];
  maxChunkCharacters?: number;
}) => {
  const chunks: string[] = [];
  let current = "";

  const pushBlock = (block: string) => {
    if (!block) return;
    if (!current) {
      current = block;
      return;
    }
    const next = `${current}\n\n${block}`;
    if (next.length <= maxChunkCharacters) {
      current = next;
      return;
    }
    chunks.push(current);
    current = block;
  };

  for (const rawBlock of textBlocks) {
    const normalizedBlock = rawBlock.trim();
    if (!normalizedBlock) continue;
    if (normalizedBlock.length <= maxChunkCharacters) {
      pushBlock(normalizedBlock);
      continue;
    }
    for (const part of splitOversizedBlock(normalizedBlock, maxChunkCharacters)) {
      pushBlock(part);
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
};

export const buildNotebookPodcastStoragePath = ({
  uid,
  podcastHash,
}: {
  uid: string;
  podcastHash: string;
}) => `users/${uid}/ai-practice-notebook-podcasts/${podcastHash}.${NOTEBOOK_PODCAST_AUDIO_FORMAT}`;

export const buildNotebookPodcastDownloadUrl = ({
  podcastHash,
}: {
  podcastHash: string;
}) => `/api/ai-practice/notebook/podcast?hash=${encodeURIComponent(podcastHash)}`;

export const buildNotebookPodcastFilename = ({
  podcastHash,
}: {
  podcastHash: string;
}) => `bfzoom-ai-practice-podcast-${podcastHash.slice(0, 8)}.${NOTEBOOK_PODCAST_AUDIO_FORMAT}`;

export const formatNotebookPodcastChargeMinutes = () =>
  formatNotebookChargeMinutes(AI_PRACTICE_NOTEBOOK_PODCAST_CHARGE_SECONDS);

export const formatNotebookPodcastDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};
