export const TRANSLATOR_IDENTITY_PREFIX = "bfzoom-translator";

export type TranslatorTokenPayload = {
  room: string;
  sourceLanguage?: string;
  targetLanguage: string;
  voice?: string;
};

export type TranslatorParticipantMetadata = {
  role: "translator";
  room: string;
  sourceLanguage?: string;
  targetLanguage: string;
  voice?: string;
};

const sanitizeLanguageCode = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 10);

export const buildTranslatorIdentity = (targetLanguage: string) => {
  const lang = sanitizeLanguageCode(targetLanguage || "en") || "en";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${TRANSLATOR_IDENTITY_PREFIX}-${lang}-${suffix}`;
};

export const isTranslatorIdentity = (identity: string) =>
  identity.trim().toLowerCase().startsWith(`${TRANSLATOR_IDENTITY_PREFIX}-`);

export const buildTranslatorMetadata = (
  payload: TranslatorTokenPayload
): TranslatorParticipantMetadata => ({
  role: "translator",
  room: payload.room,
  sourceLanguage: payload.sourceLanguage?.trim() || undefined,
  targetLanguage: payload.targetLanguage.trim(),
  voice: payload.voice?.trim() || undefined,
});
