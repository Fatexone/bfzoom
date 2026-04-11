import type { Voice } from "expo-speech";

const NATIVE_FIRST_TTS_LANGUAGE_CODES = new Set([
  "ar",
  "ar-ma",
  "fa",
  "he",
  "hi",
  "ja",
  "ko",
  "th",
  "zh",
]);

const normalizeLanguageCode = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

const getLanguageBase = (value: string) => normalizeLanguageCode(value).split("-")[0] || "";

export const shouldPreferNativeTtsLanguage = (languageCode: string) => {
  const normalized = normalizeLanguageCode(languageCode);
  const base = getLanguageBase(languageCode);
  return NATIVE_FIRST_TTS_LANGUAGE_CODES.has(normalized) || NATIVE_FIRST_TTS_LANGUAGE_CODES.has(base);
};

export const shouldWarnAboutMissingNativeTtsVoice = shouldPreferNativeTtsLanguage;

export const getVoicesForLanguage = (
  voices: Voice[],
  languageCode: string,
  locale: string
) => {
  const exactLocale = normalizeLanguageCode(locale);
  const requestedCode = normalizeLanguageCode(languageCode);
  const prefix = getLanguageBase(exactLocale || requestedCode);

  const rankVoiceLanguage = (voiceLanguage: string) => {
    const normalizedVoiceLanguage = normalizeLanguageCode(voiceLanguage);
    if (normalizedVoiceLanguage === exactLocale) return 0;
    if (
      normalizedVoiceLanguage === requestedCode ||
      normalizedVoiceLanguage.startsWith(`${requestedCode}-`)
    ) {
      return 1;
    }
    if (normalizedVoiceLanguage === prefix || normalizedVoiceLanguage.startsWith(`${prefix}-`)) {
      return 2;
    }
    return 3;
  };

  return [...voices]
    .filter((voice) => rankVoiceLanguage(voice.language || "") < 3)
    .sort((left, right) => {
      const languageRankDiff =
        rankVoiceLanguage(left.language || "") - rankVoiceLanguage(right.language || "");
      if (languageRankDiff !== 0) return languageRankDiff;

      const leftQualityRank = left.quality === "Enhanced" ? 0 : 1;
      const rightQualityRank = right.quality === "Enhanced" ? 0 : 1;
      if (leftQualityRank !== rightQualityRank) return leftQualityRank - rightQualityRank;

      return left.name.localeCompare(right.name);
    });
};

export const getEnhancedVoicesForLanguage = (
  voices: Voice[],
  languageCode: string,
  locale: string
) => getVoicesForLanguage(voices, languageCode, locale).filter((voice) => voice.quality === "Enhanced");

export const selectPreferredDeviceVoiceId = (
  voices: Voice[],
  languageCode: string,
  locale: string
) => getVoicesForLanguage(voices, languageCode, locale)[0]?.identifier;

export const selectPreferredEnhancedDeviceVoiceId = (
  voices: Voice[],
  languageCode: string,
  locale: string
) => getEnhancedVoicesForLanguage(voices, languageCode, locale)[0]?.identifier;

export const buildAiTtsInstructions = ({
  languageCode,
  languageLabel,
}: {
  languageCode: string;
  languageLabel: string;
}) => {
  const normalized = normalizeLanguageCode(languageCode);
  const label = languageLabel.trim() || normalized.toUpperCase();

  switch (normalized) {
    case "ar-ma":
      return "Speak entirely in Moroccan Darija with a natural North African accent. Do not use an English accent. Pronounce the Arabic text naturally.";
    case "ar":
      return "Speak entirely in Arabic with a natural native Arabic accent. Do not use an English accent. Pronounce the Arabic text naturally.";
    case "fa":
      return "Speak entirely in Persian with a natural native Persian accent. Do not use an English accent.";
    case "he":
      return "Speak entirely in Hebrew with a natural native Hebrew accent. Do not use an English accent.";
    case "hi":
      return "Speak entirely in Hindi with a natural native Hindi accent. Do not use an English accent. Pronounce Devanagari text naturally.";
    case "ja":
      return "Speak entirely in Japanese with a natural native Japanese accent. Do not use an English accent.";
    case "ko":
      return "Speak entirely in Korean with a natural native Korean accent. Do not use an English accent.";
    case "th":
      return "Speak entirely in Thai with a natural native Thai accent. Do not use an English accent.";
    case "zh":
      return "Speak entirely in Chinese with a natural native Chinese accent. Do not use an English accent.";
    case "en":
      return "Speak naturally in English.";
    default:
      return `Speak entirely in ${label} with a natural native accent. Do not use an English accent unless the target language is English. Pronounce the text naturally and do not transliterate it.`;
  }
};
