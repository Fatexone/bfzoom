export type CaptionTargetConfig = {
  code: string;
  label: string;
  name: string;
  description: string;
  speechLocale: string;
};

export const CAPTION_TARGETS_CONFIG: CaptionTargetConfig[] = [
  {
    code: "fr",
    label: "FR",
    name: "French",
    description: "Sous-titres et synthèse vocale en français.",
    speechLocale: "fr-FR",
  },
  {
    code: "en",
    label: "EN",
    name: "English",
    description: "Sous-titres et synthèse vocale en anglais.",
    speechLocale: "en-US",
  },
  {
    code: "de",
    label: "DE",
    name: "German",
    description: "Traduction en allemand.",
    speechLocale: "de-DE",
  },
  {
    code: "it",
    label: "IT",
    name: "Italian",
    description: "Sous-titres et voix en italien.",
    speechLocale: "it-IT",
  },
  {
    code: "es",
    label: "ES",
    name: "Spanish",
    description: "Traduction en espagnol.",
    speechLocale: "es-ES",
  },
  {
    code: "ru",
    label: "RU",
    name: "Russian",
    description: "Sous-titres et synthèse en russe.",
    speechLocale: "ru-RU",
  },
  {
    code: "la",
    label: "LA",
    name: "Latin",
    description: "Langage latin, pour les présentations historiques.",
    speechLocale: "la",
  },
  {
    code: "ar",
    label: "AR",
    name: "Arabic",
    description: "Traduction arabe moderne.",
    speechLocale: "ar-SA",
  },
  {
    code: "ar-ma",
    label: "DA",
    name: "Darija (Maghreb)",
    description: "Darija du Maghreb avec voix arabe marocaine si disponible.",
    speechLocale: "ar-MA",
  },
  {
    code: "he",
    label: "HE",
    name: "Hebrew",
    description: "Langue hébraïque.",
    speechLocale: "he-IL",
  },
  {
    code: "fa",
    label: "FA",
    name: "Persan (Farsi)",
    description: "Pour les participants parlant persan.",
    speechLocale: "fa-IR",
  },
  {
    code: "ja",
    label: "JA",
    name: "Japanese",
    description: "Synthèse et sous-titres japonais.",
    speechLocale: "ja-JP",
  },
];

export const TRANSLATION_MODE_HELP = [
  {
    id: "realtime",
    label: "Realtime",
    detail: "Flux audio streaming avec latence réduite pour les discussions en direct.",
  },
  {
    id: "tts",
    label: "Traduction vocale",
    detail: "Traitement texte puis synthèse pour les environnements plus calmes.",
  },
  {
    id: "local",
    label: "Lecture locale",
    detail: "L'hôte entend la synthèse uniquement sur sa machine.",
  },
];

export const SPEECH_LANG_BY_TARGET = CAPTION_TARGETS_CONFIG.reduce<Record<string, string>>(
  (acc, item) => {
    acc[item.code] = item.speechLocale;
    return acc;
  },
  {}
);

export type CaptionTargetCode = (typeof CAPTION_TARGETS_CONFIG)[number]["code"];

export const DEFAULT_CAPTION_TARGET: CaptionTargetCode = "en";

export type SourceLanguageOption = {
  code: string;
  label: string;
  name: string;
  recognitionLocale: string;
};

export const SOURCE_LANGUAGE_OPTIONS: SourceLanguageOption[] = [
  { code: "fr", label: "FR", name: "Français", recognitionLocale: "fr-FR" },
  { code: "en", label: "EN", name: "Anglais", recognitionLocale: "en-US" },
  { code: "es", label: "ES", name: "Espagnol", recognitionLocale: "es-ES" },
  { code: "de", label: "DE", name: "Allemand", recognitionLocale: "de-DE" },
  { code: "it", label: "IT", name: "Italien", recognitionLocale: "it-IT" },
  { code: "pt", label: "PT", name: "Portugais", recognitionLocale: "pt-PT" },
  { code: "ar", label: "AR", name: "Arabe", recognitionLocale: "ar-SA" },
  { code: "ar-ma", label: "DA", name: "Darija (Maghreb)", recognitionLocale: "ar-MA" },
  { code: "fa", label: "FA", name: "Persan (Farsi)", recognitionLocale: "fa-IR" },
];

export const DEFAULT_SOURCE_LANGUAGE: SourceLanguageOption["code"] = "fr";
