export const AI_PRACTICE_NOTEBOOK_COLLECTION = "ai_practice_notebook";
export const AI_PRACTICE_NOTEBOOK_USAGE_COLLECTION = "ai_practice_notebook_usage";
export const AI_PRACTICE_NOTEBOOK_UPDATED_EVENT = "bfzoom:ai-practice-notebook-updated";
export const AI_PRACTICE_NOTEBOOK_OPEN_EVENT = "bfzoom:ai-practice-notebook-open";
export const AI_PRACTICE_NOTEBOOK_SIMPLE_SECONDS = 9;
export const AI_PRACTICE_NOTEBOOK_ENRICHED_SECONDS = 24;
export const AI_PRACTICE_NOTEBOOK_MAX_ENTRIES = 200;

export type AiPracticeNotebookEntryKind =
  | "user_translation"
  | "coach_reply"
  | "coach_suggestion"
  | "draft_review";

export type AiPracticeNotebookEntryMode = "simple" | "enriched";

export type AiPracticeNotebookSaveInput = {
  kind: AiPracticeNotebookEntryKind;
  mode: AiPracticeNotebookEntryMode;
  baseText?: string;
  targetText: string;
  baseLanguageCode?: string;
  baseLanguageName?: string;
  targetLanguageCode?: string;
  targetLanguageName?: string;
  phoneticText?: string;
  correctedText?: string;
  naturalText?: string;
  familiarText?: string;
  contextLabel?: string;
  roomId?: string;
  voice?: string;
};

export type AiPracticeNotebookEntry = {
  id: string;
  fingerprint: string;
  kind: AiPracticeNotebookEntryKind;
  mode: AiPracticeNotebookEntryMode;
  baseText: string;
  targetText: string;
  baseLanguageCode: string;
  baseLanguageName: string;
  targetLanguageCode: string;
  targetLanguageName: string;
  phoneticText: string;
  correctedText: string;
  naturalText: string;
  familiarText: string;
  contextLabel: string;
  roomId: string;
  voice: string;
  chargeSeconds: number;
  createdAtMs: number;
  createdAtIso: string;
};

const normalizeText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);

const normalizeCode = (value: unknown, fallback = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .slice(0, 12) || fallback;

const normalizeVoice = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);

const normalizeFingerprintText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, maxLength);

export const getAiPracticeNotebookChargeSeconds = (mode: AiPracticeNotebookEntryMode) =>
  mode === "enriched"
    ? AI_PRACTICE_NOTEBOOK_ENRICHED_SECONDS
    : AI_PRACTICE_NOTEBOOK_SIMPLE_SECONDS;

export const formatNotebookChargeMinutes = (seconds: number) =>
  `+${(seconds / 60).toFixed(2).replace(".", ",")} min`;

export const buildAiPracticeNotebookFingerprint = (
  raw:
    | AiPracticeNotebookSaveInput
    | Omit<AiPracticeNotebookEntry, "id" | "createdAtMs" | "createdAtIso">
) => {
  const sanitized = sanitizeAiPracticeNotebookInput(raw as AiPracticeNotebookSaveInput);
  return [
    "v1",
    sanitized.kind,
    sanitized.mode,
    normalizeCode(sanitized.baseLanguageCode),
    normalizeCode(sanitized.targetLanguageCode),
    normalizeFingerprintText(sanitized.baseText, 240),
    normalizeFingerprintText(sanitized.targetText, 240),
    normalizeFingerprintText(sanitized.correctedText, 180),
    normalizeFingerprintText(sanitized.naturalText, 180),
    normalizeFingerprintText(sanitized.familiarText, 180),
    normalizeFingerprintText(sanitized.contextLabel, 80),
  ].join("|");
};

export const sanitizeAiPracticeNotebookInput = (
  raw: AiPracticeNotebookSaveInput
): Omit<AiPracticeNotebookEntry, "id" | "createdAtMs" | "createdAtIso" | "fingerprint"> => {
  const mode: AiPracticeNotebookEntryMode = raw.mode === "enriched" ? "enriched" : "simple";
  const kind: AiPracticeNotebookEntryKind = [
    "user_translation",
    "coach_reply",
    "coach_suggestion",
    "draft_review",
  ].includes(raw.kind)
    ? raw.kind
    : "user_translation";

  return {
    kind,
    mode,
    baseText: normalizeText(raw.baseText, 600),
    targetText: normalizeText(raw.targetText, 600),
    baseLanguageCode: normalizeCode(raw.baseLanguageCode),
    baseLanguageName: normalizeText(raw.baseLanguageName, 80),
    targetLanguageCode: normalizeCode(raw.targetLanguageCode),
    targetLanguageName: normalizeText(raw.targetLanguageName, 80),
    phoneticText: normalizeText(raw.phoneticText, 600),
    correctedText: normalizeText(raw.correctedText, 600),
    naturalText: normalizeText(raw.naturalText, 600),
    familiarText: normalizeText(raw.familiarText, 600),
    contextLabel: normalizeText(raw.contextLabel, 80),
    roomId: normalizeText(raw.roomId, 80),
    voice: normalizeVoice(raw.voice),
    chargeSeconds: getAiPracticeNotebookChargeSeconds(mode),
  };
};
