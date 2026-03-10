export type TranslationNotebookDirection = "outgoing" | "incoming";
export type TranslationNotebookStatus = "to_review" | "mastered";

export type TranslationNotebookEntry = {
  id: string;
  createdAt: number;
  sourceText: string;
  translatedText: string;
  sourceLanguageCode: string;
  sourceLanguageName: string;
  targetLanguageCode: string;
  targetLanguageName: string;
  direction: TranslationNotebookDirection;
  status: TranslationNotebookStatus;
  mode: "exercise";
};

type SaveTranslationNotebookInput = {
  sourceText: string;
  translatedText: string;
  sourceLanguageCode?: string;
  sourceLanguageName?: string;
  targetLanguageCode?: string;
  targetLanguageName?: string;
  direction?: TranslationNotebookDirection;
};

export const TRANSLATION_NOTEBOOK_STORAGE_KEY = "bfzoom:translation-notebook:v1";
const TRANSLATION_NOTEBOOK_MAX_ITEMS = 10;

const isBrowser = () => typeof window !== "undefined";

const toSafeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeEntry = (value: unknown): TranslationNotebookEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TranslationNotebookEntry>;
  const id = toSafeString(candidate.id);
  const sourceText = toSafeString(candidate.sourceText);
  const translatedText = toSafeString(candidate.translatedText);
  if (!id || !sourceText || !translatedText) return null;
  const createdAt =
    typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : 0;
  return {
    id,
    createdAt,
    sourceText,
    translatedText,
    sourceLanguageCode: toSafeString(candidate.sourceLanguageCode),
    sourceLanguageName: toSafeString(candidate.sourceLanguageName),
    targetLanguageCode: toSafeString(candidate.targetLanguageCode),
    targetLanguageName: toSafeString(candidate.targetLanguageName),
    direction: candidate.direction === "incoming" ? "incoming" : "outgoing",
    status: candidate.status === "mastered" ? "mastered" : "to_review",
    mode: "exercise",
  };
};

export const getTranslationNotebookEntries = (): TranslationNotebookEntry[] => {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(TRANSLATION_NOTEBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter((item): item is TranslationNotebookEntry => Boolean(item))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, TRANSLATION_NOTEBOOK_MAX_ITEMS);
  } catch {
    return [];
  }
};

export const saveTranslationNotebookEntry = (input: SaveTranslationNotebookInput) => {
  if (!isBrowser()) return;
  const sourceText = toSafeString(input.sourceText);
  const translatedText = toSafeString(input.translatedText);
  if (!sourceText || !translatedText) return;
  const now = Date.now();
  const next: TranslationNotebookEntry = {
    id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: now,
    sourceText,
    translatedText,
    sourceLanguageCode: toSafeString(input.sourceLanguageCode).toLowerCase(),
    sourceLanguageName: toSafeString(input.sourceLanguageName),
    targetLanguageCode: toSafeString(input.targetLanguageCode).toLowerCase(),
    targetLanguageName: toSafeString(input.targetLanguageName),
    direction: input.direction === "incoming" ? "incoming" : "outgoing",
    status: "to_review",
    mode: "exercise",
  };
  const existing = getTranslationNotebookEntries();
  const latest = existing[0];
  if (
    latest &&
    latest.sourceText === next.sourceText &&
    latest.translatedText === next.translatedText &&
    latest.targetLanguageCode === next.targetLanguageCode &&
    now - latest.createdAt < 1500
  ) {
    return;
  }
  const merged = [next, ...existing].slice(0, TRANSLATION_NOTEBOOK_MAX_ITEMS);
  try {
    window.localStorage.setItem(TRANSLATION_NOTEBOOK_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore localStorage quota and privacy mode errors.
  }
};

export const clearTranslationNotebookEntries = () => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(TRANSLATION_NOTEBOOK_STORAGE_KEY);
  } catch {}
};

export const updateTranslationNotebookEntryStatus = (
  entryId: string,
  status: TranslationNotebookStatus
) => {
  if (!isBrowser()) return;
  const safeId = toSafeString(entryId);
  if (!safeId) return;
  const safeStatus: TranslationNotebookStatus = status === "mastered" ? "mastered" : "to_review";
  const existing = getTranslationNotebookEntries();
  const updated = existing.map((entry) =>
    entry.id === safeId ? { ...entry, status: safeStatus } : entry
  );
  try {
    window.localStorage.setItem(TRANSLATION_NOTEBOOK_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage quota and privacy mode errors.
  }
};
