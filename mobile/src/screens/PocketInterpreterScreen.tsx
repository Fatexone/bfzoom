import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import type { User } from "firebase/auth";
import * as FileSystemLegacy from "expo-file-system/legacy";
import {
  createAudioPlayer,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Speech from "expo-speech";
import type { Voice } from "expo-speech";
import { AudioSession } from "@livekit/react-native";
import { env } from "../config/env";
import { useTranslationCredits } from "../hooks/useTranslationCredits";
import { useI18n, type AppLanguage } from "../i18n";
import {
  consumeTranslationSeconds,
  fetchTtsAudio,
  isTranslationAbortError,
  transcribeAudio,
  translateText,
} from "../services/translation";
import {
  isPocketProcessFallbackError,
  processPocketAudio,
} from "../services/pocketProcess";
import {
  buildAiTtsInstructions,
  getVoicesForLanguage,
  selectPreferredDeviceVoiceId,
  selectPreferredEnhancedDeviceVoiceId,
  shouldPreferNativeTtsLanguage,
} from "../utils/ttsPolicy";

type PocketInterpreterScreenProps = {
  user: User;
  onOpenDashboard: () => void;
};

const MOBILE_BRAND_ICON = require("../../assets/icon.png");

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English", speechLocale: "en-US" },
  { code: "fr", label: "Français", speechLocale: "fr-FR" },
  { code: "ar", label: "العربية", speechLocale: "ar-SA" },
  { code: "ar-ma", label: "الدارجة", speechLocale: "ar-MA" },
  { code: "zh", label: "中文", speechLocale: "zh-CN" },
  { code: "pt", label: "Português", speechLocale: "pt-PT" },
  { code: "pt-br", label: "Português (Brasil)", speechLocale: "pt-BR" },
  { code: "hi", label: "हिन्दी", speechLocale: "hi-IN" },
  { code: "ko", label: "한국어", speechLocale: "ko-KR" },
  { code: "tr", label: "Türkçe", speechLocale: "tr-TR" },
  { code: "th", label: "ไทย", speechLocale: "th-TH" },
  { code: "es", label: "Español", speechLocale: "es-ES" },
  { code: "de", label: "Deutsch", speechLocale: "de-DE" },
  { code: "he", label: "עברית", speechLocale: "he-IL" },
  { code: "it", label: "Italiano", speechLocale: "it-IT" },
  { code: "id", label: "Bahasa Indonesia", speechLocale: "id-ID" },
  { code: "ja", label: "日本語", speechLocale: "ja-JP" },
  { code: "ru", label: "Русский", speechLocale: "ru-RU" },
  { code: "fa", label: "فارسی", speechLocale: "fa-IR" },
  { code: "la", label: "Latin", speechLocale: "la" },
] as const;

type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]["code"];
type PocketStatus = "idle" | "recording" | "processing" | "speaking";
type PocketHistoryItem = {
  id: string;
  createdAt: number;
  sourceText: string;
  translatedText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  favorite: boolean;
  sourceAudioUri?: string | null;
  audioUri?: string | null;
};
type PocketTtsCacheEntry = {
  text: string;
  language: LanguageCode;
  uri: string;
};

const LANGUAGE_PROMPT_NAMES: Record<LanguageCode, string> = {
  en: "English",
  fr: "French",
  ar: "Arabic",
  "ar-ma": "Darija (Maghreb)",
  zh: "Chinese",
  pt: "Portuguese",
  "pt-br": "Portuguese (Brazil)",
  hi: "Hindi",
  ko: "Korean",
  tr: "Turkish",
  th: "Thai",
  es: "Spanish",
  de: "German",
  he: "Hebrew",
  it: "Italian",
  id: "Indonesian",
  ja: "Japanese",
  ru: "Russian",
  fa: "Persian",
  la: "Latin",
};

const LANGUAGE_UI_LABELS: Record<LanguageCode, { fr: string; en: string }> = {
  en: { fr: "Anglais", en: "English" },
  fr: { fr: "Francais", en: "French" },
  ar: { fr: "Arabe", en: "Arabic" },
  "ar-ma": { fr: "Darija (Maghreb)", en: "Darija (Maghreb)" },
  zh: { fr: "Chinois", en: "Chinese" },
  pt: { fr: "Portugais", en: "Portuguese" },
  "pt-br": { fr: "Portugais (Bresil)", en: "Portuguese (Brazil)" },
  hi: { fr: "Hindi", en: "Hindi" },
  ko: { fr: "Coreen", en: "Korean" },
  tr: { fr: "Turc", en: "Turkish" },
  th: { fr: "Thai", en: "Thai" },
  es: { fr: "Espagnol", en: "Spanish" },
  de: { fr: "Allemand", en: "German" },
  he: { fr: "Hebreu", en: "Hebrew" },
  it: { fr: "Italien", en: "Italian" },
  id: { fr: "Indonesien", en: "Indonesian" },
  ja: { fr: "Japonais", en: "Japanese" },
  ru: { fr: "Russe", en: "Russian" },
  fa: { fr: "Persan", en: "Persian" },
  la: { fr: "Latin", en: "Latin" },
};

const RTL_LANGUAGE_CODES = new Set<LanguageCode>(["ar", "ar-ma", "fa", "he"]);
const POCKET_PREFS_STORAGE_KEY = "bfzoom.pocket-interpreter.prefs";
const POCKET_HISTORY_STORAGE_KEY = "bfzoom.pocket-interpreter.history";
const POCKET_HISTORY_AUDIO_DIR = "bfzoom-pocket-history-audio";
const MIN_RECORDING_MS = 650;
const MIN_AUDIO_BYTES = 1200;
const MAX_HISTORY_ITEMS = 30;
const MAX_HISTORY_PREVIEW_ITEMS = 4;
const MAX_HISTORY_FAVORITES = 20;
const AI_TTS_ENABLED = true;
const AI_TTS_DEFAULT_VOICE = "nova";
const AI_TTS_MAX_CHARS = 650;
const IOS_AI_TTS_FORMAT_PREFERENCE: ReadonlyArray<"wav" | "mp3"> = ["mp3", "wav"];
const DEFAULT_AI_TTS_FORMAT: "mp3" = "mp3";
const IOS_AI_TTS_PLAYBACK_START_TIMEOUT_MS = 1800;
const POCKET_SLOW_REPLAY_PLAYBACK_RATE = 0.72;
const POCKET_FAVORITES_PLAYBACK_PAUSE_MS = 260;

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

const getLanguageUiLabel = (code: LanguageCode, language: AppLanguage) => {
  const labels = LANGUAGE_UI_LABELS[code];
  const shortCode = code.toUpperCase();
  if (!labels) return shortCode;
  return `${shortCode} · ${labels[language === "fr" ? "fr" : "en"]}`;
};

const getTtsTempExtension = (format: "wav" | "mp3") => (format === "wav" ? "wav" : "mp3");

const buildSegmentExtension = (uri: string) => {
  const clean = uri.split("?")[0] || uri;
  return (clean.match(/\.([a-z0-9]+)$/i)?.[1] || "m4a").toLowerCase();
};

const getAudioFileSize = async (uri: string) => {
  try {
    const info = await FileSystemLegacy.getInfoAsync(uri);
    if (!info.exists) return 0;
    return "size" in info && typeof info.size === "number" ? info.size : 0;
  } catch {
    return 0;
  }
};

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = String(safe % 60).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
  }
  return `${minutes}:${rest}`;
};

const normalizeHistoryItem = (value: unknown): PocketHistoryItem | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PocketHistoryItem>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const sourceText = typeof item.sourceText === "string" ? item.sourceText.trim() : "";
  const translatedText =
    typeof item.translatedText === "string" ? item.translatedText.trim() : "";
  const sourceLanguage =
    typeof item.sourceLanguage === "string" &&
    LANGUAGE_OPTIONS.some((option) => option.code === item.sourceLanguage)
      ? (item.sourceLanguage as LanguageCode)
      : null;
  const targetLanguage =
    typeof item.targetLanguage === "string" &&
    LANGUAGE_OPTIONS.some((option) => option.code === item.targetLanguage)
      ? (item.targetLanguage as LanguageCode)
      : null;
  if (!id || !sourceText || !translatedText || !sourceLanguage || !targetLanguage) {
    return null;
  }
  return {
    id,
    createdAt:
      typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
        ? Math.max(0, Math.floor(item.createdAt))
        : Date.now(),
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    favorite: item.favorite === true,
    sourceAudioUri:
      typeof item.sourceAudioUri === "string" && item.sourceAudioUri.trim()
        ? item.sourceAudioUri.trim()
        : null,
    audioUri: typeof item.audioUri === "string" && item.audioUri.trim() ? item.audioUri.trim() : null,
  };
};

const toFriendlyAudioError = (error: unknown, language: AppLanguage) => {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/permission/i.test(raw)) {
    return language === "fr"
      ? "Autorisation micro refusee. Active le micro puis reessaie."
      : "Microphone permission denied. Enable the microphone and try again.";
  }
  if (/no speech detected/i.test(raw)) {
    return language === "fr"
      ? "Aucune voix detectee. Maintiens le bouton puis parle clairement."
      : "No speech detected. Hold the button and speak clearly.";
  }
  if (/too short|audio invalide/i.test(raw)) {
    return language === "fr"
      ? "Parle au moins 1 seconde avant de relacher."
      : "Speak for at least 1 second before releasing.";
  }
  return raw || (language === "fr" ? "Erreur audio." : "Audio error.");
};

const readHttpError = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return `${response.status} ${response.statusText}`.trim();
  }
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
};

const toPocketLogValue = (value: unknown) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value)) : "na";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "string") {
    return value.trim().replace(/\s+/g, "_").slice(0, 180);
  }
  try {
    return JSON.stringify(value).replace(/\s+/g, "_").slice(0, 180);
  } catch {
    return String(value).replace(/\s+/g, "_").slice(0, 180);
  }
};

const logPocket = (event: string, details?: Record<string, unknown>) => {
  if (!__DEV__) return;
  const serialized = Object.entries(details || {})
    .map(([key, value]) => {
      const normalized = toPocketLogValue(value);
      return normalized ? `${key}=${normalized}` : "";
    })
    .filter(Boolean)
    .join(" ");
  console.log(`[BFZoom][POCKET] ${event}${serialized ? ` ${serialized}` : ""}`);
};

export function PocketInterpreterScreen({
  user,
  onOpenDashboard,
}: PocketInterpreterScreenProps) {
  const { language } = useI18n();
  const apiBaseUrl = useMemo(() => env.apiBaseUrl.trim().replace(/\/+$/, ""), []);
  const recorderPreset = useMemo(() => {
    if (Platform.OS !== "ios") return RecordingPresets.HIGH_QUALITY;
    // Keep Pocket capture close to the visio talkie preset to reduce upload size
    // without dropping below speech-friendly quality on iPhone.
    return {
      ...RecordingPresets.HIGH_QUALITY,
      numberOfChannels: 1,
      sampleRate: 24_000,
      bitRate: 64_000,
    };
  }, []);
  const recorder = useAudioRecorder(recorderPreset);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [bearerToken, setBearerToken] = useState<string | undefined>(undefined);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>("fr");
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>("en");
  const [status, setStatus] = useState<PocketStatus>("idle");
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PocketHistoryItem[]>([]);
  const [optimisticRemainingSeconds, setOptimisticRemainingSeconds] = useState<number | undefined>(
    undefined
  );
  const [faceModeVisible, setFaceModeVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyFavoritesOnly, setHistoryFavoritesOnly] = useState(false);
  const [languagesPanelOpen, setLanguagesPanelOpen] = useState(false);
  const [favoritesPanelOpen, setFavoritesPanelOpen] = useState(false);
  const [recentHistoryOpen, setRecentHistoryOpen] = useState(false);
  const [favoritesPlaybackActive, setFavoritesPlaybackActive] = useState(false);
  const [favoritesPlaybackIndex, setFavoritesPlaybackIndex] = useState<number | null>(null);
  const [favoritesPlaybackTotal, setFavoritesPlaybackTotal] = useState(0);
  const [favoritesPlaybackEntryId, setFavoritesPlaybackEntryId] = useState<string | null>(null);
  const [sourceEditModalVisible, setSourceEditModalVisible] = useState(false);
  const [sourceEditDraft, setSourceEditDraft] = useState("");
  const [sourceEditBusy, setSourceEditBusy] = useState(false);
  const [sourceEditError, setSourceEditError] = useState("");
  const [currentExchangeEntryId, setCurrentExchangeEntryId] = useState<string | null>(null);
  const [currentExchangeRetranslatable, setCurrentExchangeRetranslatable] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);

  const startInFlightRef = useRef(false);
  const pendingStopAfterStartRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const recordingBaselineUriRef = useRef("");
  const recorderUrlRef = useRef("");
  const recorderPreparedRef = useRef(false);
  const recorderWarmupPromiseRef = useRef<Promise<boolean> | null>(null);
  const recorderWarmupSessionRef = useRef(0);
  const speechSessionRef = useRef(0);
  const stopRecordingRef = useRef<null | (() => Promise<void>)>(null);
  const ttsPlaybackSessionRef = useRef(0);
  const interactionSessionRef = useRef(0);
  const mediaSessionRef = useRef(0);
  const processingAbortControllerRef = useRef<AbortController | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const ttsPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const ttsPlayerMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsPlayerStatusSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const ttsTempFileRef = useRef("");
  const ttsTempFileOwnedRef = useRef(false);
  const ttsPlaybackEndHandlerRef = useRef<null | (() => void)>(null);
  const ttsCacheRef = useRef<PocketTtsCacheEntry | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const previousHistoryRef = useRef<PocketHistoryItem[]>([]);
  const pendingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favoritesPlaybackRunRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const loadVoices = async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (!cancelled) {
          setAvailableVoices(voices);
        }
      } catch {}
    };
    void loadVoices();
    return () => {
      cancelled = true;
    };
  }, []);
  const favoritesPlaybackActiveRef = useRef(false);
  const favoritesPlaybackMediaSessionIdRef = useRef<number | null>(null);

  const ui = useMemo(
    () =>
      language === "fr"
        ? {
            kicker: "POCKET INTERPRETER",
            title: "Interprete de poche",
            subtitle:
              "Parle a quelqu'un en face-a-face. Maintiens, parle, puis laisse BFZoom afficher et lire la traduction.",
            brandSignature: "by Beyond Frontiers",
            sharedMinutes: "Minutes BFZoom partagees avec le web",
            languagesTitle: "Langues",
            languagesSummary: (source: string, target: string) => `${source} → ${target}`,
            sourceLanguage: "Je parle",
            targetLanguage: "Ils entendent",
            swap: "Inverser",
            languagesBusy: "Attends la fin de la traduction avant de changer les langues.",
            creditsLoading: "Chargement des minutes...",
            creditsLabel: (value: string) => `Temps restant: ${value}`,
            creditsUnlimited: "Temps restant: Illimité",
            creditsLocked: "Recharge requise pour utiliser Pocket Interpreter.",
            buyCredits: "Voir les packs iOS",
            holdToTalk: "Maintenir pour parler",
            holdToTalkLocked: "Credits requis",
            releaseHint: "Relache pour traduire",
            statusIdle: "Pret a traduire",
            statusRecording: "J'ecoute...",
            statusProcessing: "Je traduis...",
            statusSpeaking: "Je lis la traduction...",
            sourceCard: "Ce que tu as dit",
            translationCard: "Traduction",
            editSource: "Corriger le texte",
            editSourceTitle: "Corriger le texte capte",
            editSourceHint:
              "Ajuste la phrase si la capture s'est trompee, puis relance la traduction.",
            editSourcePlaceholder: "Modifie la phrase avant de retraduire.",
            retranslate: "Retraduire",
            retranslateBusy: "Nouvelle traduction...",
            cancel: "Annuler",
            correctionExpired: "La fenetre de correction a expire. Refais un court enregistrement.",
            emptyEditSource: "Le texte a retraduire est vide.",
            replay: "Relire",
            replaySlow: "Relire lentement",
            faceMode: "Mode face",
            faceModeTitle: "Montre cet ecran a ton interlocuteur",
            faceModeHint: "Texte agrandi pour la personne en face.",
            closeFaceMode: "Fermer",
            recent: "Derniers echanges",
            recentPhrases: "Phrases recentes",
            recentSummary: (count: number) =>
              `${count} phrase${count > 1 ? "s" : ""} recente${count > 1 ? "s" : ""}`,
            favoritePhrases: "Phrases favorites",
            favoritesSummary: (count: number) => `${count} favori${count > 1 ? "s" : ""}`,
            historyHint: "Retrouve, rejoue et reutilise tes dernieres traductions.",
            listenFavorites: "Ecouter les favoris",
            stopFavorites: "Arreter l'ecoute",
            favoritesPlaybackHint: "Lecture en chaine : phrase puis traduction.",
            favoritesPlaybackProgress: (current: number, total: number) =>
              `Lecture ${current}/${total}`,
            favoritesPlayingNow: "En ecoute",
            viewAll: "Voir tout",
            showAll: "Tout",
            favoritesOnly: "Favoris",
            usePhrase: "Afficher",
            favorite: "Favori",
            unfavorite: "Retirer",
            favoriteAction: "Ajouter favori",
            unfavoriteAction: "Retirer favori",
            delete: "Supprimer",
            offlineAudioReady: "Audio disponible hors ligne",
            offlineTextOnly: "Texte disponible. Aucun audio enregistre pour cette phrase.",
            favoritesLimit: "Maximum 20 favoris.",
            noHistory: "Aucun echange pour l'instant.",
            noFavorites: "Aucune phrase favorite pour l'instant.",
            keepSpeaking: "Parle au moins 1 seconde avant de relacher.",
            noSpeech: "Aucune voix detectee. Maintiens le bouton puis parle clairement.",
            translationEmpty: "Traduction vide. Reessaie.",
            creditsError: (message: string) => `Credits: ${message}`,
            accountIssue: "Session indisponible. Reconnecte-toi puis reessaie.",
            accessPending: "Verification de l'acces...",
            retryAccess: "Relancer l'acces",
            playbackFailed: "Lecture audio indisponible. Reessaie.",
            creditsIssue: "Impossible de verifier tes minutes pour le moment.",
            processingBusy: "Attends la fin de la traduction en cours.",
          }
        : {
            kicker: "POCKET INTERPRETER",
            title: "Pocket Interpreter",
            subtitle:
              "Speak face-to-face with someone nearby. Hold, speak, then let BFZoom show and read the translation aloud.",
            brandSignature: "by Beyond Frontiers",
            sharedMinutes: "BFZoom minutes shared with the web",
            languagesTitle: "Languages",
            languagesSummary: (source: string, target: string) => `${source} → ${target}`,
            sourceLanguage: "I speak",
            targetLanguage: "They hear",
            swap: "Swap",
            languagesBusy: "Wait for the translation to finish before changing languages.",
            creditsLoading: "Loading minutes...",
            creditsLabel: (value: string) => `Time left: ${value}`,
            creditsUnlimited: "Time left: Unlimited",
            creditsLocked: "Top up required to use Pocket Interpreter.",
            buyCredits: "View iOS packs",
            holdToTalk: "Hold to talk",
            holdToTalkLocked: "Credits required",
            releaseHint: "Release to translate",
            statusIdle: "Ready to translate",
            statusRecording: "Listening...",
            statusProcessing: "Translating...",
            statusSpeaking: "Playing translation...",
            sourceCard: "What you said",
            translationCard: "Translation",
            editSource: "Edit text",
            editSourceTitle: "Edit captured text",
            editSourceHint: "Adjust the sentence if the capture was wrong, then run the translation again.",
            editSourcePlaceholder: "Update the sentence before retranslating.",
            retranslate: "Retranslate",
            retranslateBusy: "Refreshing translation...",
            cancel: "Cancel",
            correctionExpired: "The correction window expired. Record a short phrase again.",
            emptyEditSource: "There is no text to retranslate.",
            replay: "Replay",
            replaySlow: "Replay slowly",
            faceMode: "Face mode",
            faceModeTitle: "Show this screen to the person in front of you",
            faceModeHint: "Large text for the other person.",
            closeFaceMode: "Close",
            recent: "Recent exchanges",
            recentPhrases: "Recent phrases",
            recentSummary: (count: number) =>
              `${count} recent phrase${count > 1 ? "s" : ""}`,
            favoritePhrases: "Favorite phrases",
            favoritesSummary: (count: number) => `${count} favorite${count > 1 ? "s" : ""}`,
            historyHint: "Find, replay, and reuse your latest translations.",
            listenFavorites: "Play favorites",
            stopFavorites: "Stop playback",
            favoritesPlaybackHint: "Queued playback: source phrase then translation.",
            favoritesPlaybackProgress: (current: number, total: number) =>
              `Playing ${current}/${total}`,
            favoritesPlayingNow: "Now playing",
            viewAll: "View all",
            showAll: "All",
            favoritesOnly: "Favorites",
            usePhrase: "Show",
            favorite: "Favorite",
            unfavorite: "Remove",
            favoriteAction: "Add favorite",
            unfavoriteAction: "Remove favorite",
            delete: "Delete",
            offlineAudioReady: "Offline audio available",
            offlineTextOnly: "Text available. No saved audio for this phrase.",
            favoritesLimit: "Maximum 20 favorites.",
            noHistory: "No exchange yet.",
            noFavorites: "No favorite phrase yet.",
            keepSpeaking: "Speak for at least 1 second before releasing.",
            noSpeech: "No speech detected. Hold the button and speak clearly.",
            translationEmpty: "Empty translation. Try again.",
            creditsError: (message: string) => `Credits: ${message}`,
            accountIssue: "Session unavailable. Sign in again and retry.",
            accessPending: "Checking access...",
            retryAccess: "Retry access",
            playbackFailed: "Audio playback unavailable. Try again.",
            creditsIssue: "Unable to verify your minutes right now.",
            processingBusy: "Wait for the current translation to finish.",
          },
    [language]
  );

  const {
    credits,
    loading: creditsLoading,
    error: creditsError,
    stale: creditsStale,
    refetch: refetchCredits,
  } = useTranslationCredits(bearerToken);

  useEffect(() => {
    recorderUrlRef.current = String(recorderState.url || recorder.uri || "").trim();
  }, [recorder.uri, recorderState.url]);

  useEffect(() => {
    let cancelled = false;
    user
      .getIdToken()
      .then((token) => {
        if (!cancelled) {
          setBearerToken(token);
          setTokenLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBearerToken(undefined);
          setTokenLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refreshBearerToken = useCallback(async () => {
    const currentToken = (bearerToken || "").trim();
    try {
      const nextToken = (await user.getIdToken()).trim();
      if (nextToken && nextToken !== currentToken) {
        setBearerToken(nextToken);
      }
      return nextToken || currentToken;
    } catch {
      return currentToken;
    }
  }, [bearerToken, user]);

  const retryPocketAccess = useCallback(async () => {
    setError("");
    setTokenLoading(true);
    try {
      const nextToken = (await user.getIdToken(true)).trim();
      setBearerToken(nextToken || undefined);
    } catch {
      setBearerToken(undefined);
    } finally {
      setTokenLoading(false);
      refetchCredits();
    }
  }, [refetchCredits, user]);

  const deleteHistoryAudioUris = useCallback((entries: PocketHistoryItem[]) => {
    for (const entry of entries) {
      const sourceAudioUri = (entry.sourceAudioUri || "").trim();
      const uri = (entry.audioUri || "").trim();
      if (sourceAudioUri) {
        void FileSystemLegacy.deleteAsync(sourceAudioUri, { idempotent: true }).catch(() => {});
      }
      if (!uri) continue;
      void FileSystemLegacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }, []);

  const getHistoryAudioDirectory = useCallback(async () => {
    const baseDir = FileSystemLegacy.documentDirectory || FileSystemLegacy.cacheDirectory;
    if (!baseDir) return null;
    const nextDir = `${baseDir}${POCKET_HISTORY_AUDIO_DIR}/`;
    try {
      await FileSystemLegacy.makeDirectoryAsync(nextDir, { intermediates: true });
    } catch {}
    return nextDir;
  }, []);

  const persistHistoryAudioUri = useCallback(
    async (sourceUri: string, entryId: string, kind: "source" | "translation") => {
      const cleanSourceUri = sourceUri.trim();
      const cleanEntryId = entryId.trim();
      if (!cleanSourceUri || !cleanEntryId) return null;
      const historyDir = await getHistoryAudioDirectory();
      if (!historyDir) return null;
      const extension = buildSegmentExtension(cleanSourceUri) || "mp3";
      const destination = `${historyDir}${cleanEntryId}-${kind}.${extension}`;
      try {
        await FileSystemLegacy.deleteAsync(destination, { idempotent: true }).catch(() => {});
        await FileSystemLegacy.copyAsync({ from: cleanSourceUri, to: destination });
        return destination;
      } catch {
        return null;
      }
    },
    [getHistoryAudioDirectory]
  );

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(POCKET_PREFS_STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as {
          sourceLanguage?: string;
          targetLanguage?: string;
        };
        const nextSource = LANGUAGE_OPTIONS.find((item) => item.code === parsed.sourceLanguage);
        const nextTarget = LANGUAGE_OPTIONS.find((item) => item.code === parsed.targetLanguage);
        if (nextSource) setSourceLanguage(nextSource.code);
        if (nextTarget) setTargetLanguage(nextTarget.code);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(
      POCKET_PREFS_STORAGE_KEY,
      JSON.stringify({ sourceLanguage, targetLanguage })
    ).catch(() => {});
  }, [sourceLanguage, targetLanguage]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(POCKET_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as unknown[];
        const nextHistory = Array.isArray(parsed)
          ? parsed
              .map(normalizeHistoryItem)
              .filter((item): item is PocketHistoryItem => Boolean(item))
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, MAX_HISTORY_ITEMS)
          : [];
        if (!cancelled) {
          previousHistoryRef.current = nextHistory;
          setHistory(nextHistory);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(POCKET_HISTORY_STORAGE_KEY, JSON.stringify(history)).catch(() => {});
    const previous = previousHistoryRef.current;
    const removed = previous.filter(
      (item) => !history.some((currentItem) => currentItem.id === item.id)
    );
    if (removed.length > 0) {
      deleteHistoryAudioUris(removed);
    }
    previousHistoryRef.current = history;
  }, [deleteHistoryAudioUris, history]);

  useEffect(() => {
    if (!credits) return;
    setOptimisticRemainingSeconds(
      typeof credits.totalSecondsRemaining === "number" && Number.isFinite(credits.totalSecondsRemaining)
        ? Math.max(0, Math.floor(credits.totalSecondsRemaining))
        : 0
    );
  }, [credits]);

  const sourceLanguageLabel = useMemo(
    () => getLanguageUiLabel(sourceLanguage, language),
    [language, sourceLanguage]
  );
  const targetLanguageLabel = useMemo(
    () => getLanguageUiLabel(targetLanguage, language),
    [language, targetLanguage]
  );
  const favoriteHistory = useMemo(() => history.filter((entry) => entry.favorite), [history]);
  const favoriteHistoryCount = favoriteHistory.length;
  const previewFavoriteHistory = useMemo(
    () => favoriteHistory.slice(0, MAX_HISTORY_PREVIEW_ITEMS),
    [favoriteHistory]
  );
  const previewHistory = useMemo(
    () => history.slice(0, MAX_HISTORY_PREVIEW_ITEMS),
    [history]
  );
  const visibleHistory = useMemo(
    () => (historyFavoritesOnly ? favoriteHistory : history),
    [favoriteHistory, history, historyFavoritesOnly]
  );

  const fallbackRemainingSeconds =
    typeof credits?.totalSecondsRemaining === "number" && Number.isFinite(credits.totalSecondsRemaining)
      ? Math.max(0, Math.floor(credits.totalSecondsRemaining))
      : 0;
  const creditsRemainingSeconds =
    optimisticRemainingSeconds !== undefined ? optimisticRemainingSeconds : fallbackRemainingSeconds;
  const hasUnlimitedCredits = Boolean(credits && (credits.isAdmin || credits.isPremium));
  const creditsRemainingLabel = hasUnlimitedCredits
    ? ui.creditsUnlimited
    : ui.creditsLabel(formatDuration(creditsRemainingSeconds));
  const effectiveCreditsError = creditsStale ? null : creditsError;
  const translationLocked = Boolean(credits && !credits.enabled);
  const hasBearerToken = Boolean((bearerToken || "").trim());
  const canUsePocket =
    hasBearerToken && !tokenLoading && !creditsLoading && !effectiveCreditsError && Boolean(credits);
  const showAccessRetry = Boolean(effectiveCreditsError || (!tokenLoading && !hasBearerToken));
  const languageControlsDisabled = status === "recording" || status === "processing";
  const currentExchangeCanEdit =
    currentExchangeRetranslatable
    && Boolean(sourceText.trim())
    && Boolean(translatedText.trim())
    && status !== "recording"
    && status !== "processing"
    && !sourceEditBusy;
  const currentExchangeFavorite = useMemo(() => {
    const entryId = (currentExchangeEntryId || "").trim();
    if (!entryId) return false;
    return history.some((entry) => entry.id === entryId && entry.favorite);
  }, [currentExchangeEntryId, history]);
  const currentExchangeCanFavorite =
    Boolean((currentExchangeEntryId || "").trim())
    && Boolean(translatedText.trim())
    && status !== "recording"
    && status !== "processing";
  const currentExchangeCanDelete =
    Boolean((currentExchangeEntryId || "").trim())
    && status !== "recording"
    && status !== "processing";

  const statusLabel = useMemo(() => {
    if (status === "recording") return ui.statusRecording;
    if (status === "processing") return ui.statusProcessing;
    if (status === "speaking") return ui.statusSpeaking;
    if (tokenLoading || creditsLoading) return ui.accessPending;
    if (translationLocked) return ui.creditsLocked;
    return ui.statusIdle;
  }, [creditsLoading, status, tokenLoading, translationLocked, ui]);

  const updateHistoryEntryAudio = useCallback((entryId: string, nextAudioUri: string | null) => {
    const cleanId = entryId.trim();
    if (!cleanId) return;
    setHistory((previous) =>
      previous.map((entry) =>
        entry.id === cleanId
          ? {
              ...entry,
              audioUri: nextAudioUri,
            }
          : entry
      )
    );
  }, []);

  const updateHistoryEntrySourceAudio = useCallback(
    (entryId: string, nextSourceAudioUri: string | null) => {
      const cleanId = entryId.trim();
      if (!cleanId) return;
      setHistory((previous) =>
        previous.map((entry) =>
          entry.id === cleanId
            ? {
                ...entry,
                sourceAudioUri: nextSourceAudioUri,
              }
            : entry
        )
      );
    },
    []
  );

  const addHistoryEntry = useCallback((entry: PocketHistoryItem) => {
    setHistory((previous) => [entry, ...previous].slice(0, MAX_HISTORY_ITEMS));
  }, []);

  const replaceHistoryEntryExchange = useCallback(
    (entryId: string, nextSourceText: string, nextTranslatedText: string) => {
      const cleanId = entryId.trim();
      if (!cleanId) return;
      let previousSourceAudioUri = "";
      let previousAudioUri = "";
      setHistory((previous) =>
        previous.map((entry) => {
          if (entry.id !== cleanId) return entry;
          previousSourceAudioUri = (entry.sourceAudioUri || "").trim();
          previousAudioUri = (entry.audioUri || "").trim();
          return {
            ...entry,
            sourceText: nextSourceText,
            translatedText: nextTranslatedText,
            sourceAudioUri: null,
            audioUri: null,
          };
        })
      );
      if (previousSourceAudioUri) {
        void FileSystemLegacy.deleteAsync(previousSourceAudioUri, { idempotent: true }).catch(() => {});
      }
      if (previousAudioUri) {
        void FileSystemLegacy.deleteAsync(previousAudioUri, { idempotent: true }).catch(() => {});
      }
    },
    []
  );

  const closeSourceEditModal = useCallback(() => {
    if (sourceEditBusy) return;
    setSourceEditModalVisible(false);
    setSourceEditDraft("");
    setSourceEditError("");
  }, [sourceEditBusy]);

  const clearFavoritesPlaybackState = useCallback(() => {
    favoritesPlaybackActiveRef.current = false;
    setFavoritesPlaybackActive(false);
    setFavoritesPlaybackIndex(null);
    setFavoritesPlaybackTotal(0);
    setFavoritesPlaybackEntryId(null);
  }, []);

  const isBackgroundPlaybackAllowed = useCallback(
    () => Platform.OS === "ios" && favoritesPlaybackActiveRef.current,
    []
  );

  const isPlaybackAllowedInCurrentAppState = useCallback(
    () => appStateRef.current === "active" || isBackgroundPlaybackAllowed(),
    [isBackgroundPlaybackAllowed]
  );

  const toggleHistoryFavorite = useCallback(
    (entryId: string) => {
      favoritesPlaybackRunRef.current += 1;
      clearFavoritesPlaybackState();
      let blocked = false;
      setHistory((previous) =>
        previous.map((entry) => {
          if (entry.id !== entryId) return entry;
          if (!entry.favorite && favoriteHistoryCount >= MAX_HISTORY_FAVORITES) {
            blocked = true;
            return entry;
          }
          return {
            ...entry,
            favorite: !entry.favorite,
          };
        })
      );
      if (blocked) {
        setError(ui.favoritesLimit);
      }
    },
    [clearFavoritesPlaybackState, favoriteHistoryCount, ui.favoritesLimit]
  );

  const removeHistoryEntry = useCallback(
    (entryId: string) => {
      favoritesPlaybackRunRef.current += 1;
      clearFavoritesPlaybackState();
      logPocket("history_remove", { entryId });
      setHistory((previous) => previous.filter((entry) => entry.id !== entryId));
    },
    [clearFavoritesPlaybackState]
  );

  const triggerHaptic = useCallback((kind: "start" | "stop" | "speak" | "error") => {
    if (Platform.OS !== "ios") return;
    try {
      if (kind === "start") {
        Vibration.vibrate(12);
        return;
      }
      if (kind === "stop") {
        Vibration.vibrate(18);
        return;
      }
      if (kind === "speak") {
        Vibration.vibrate([0, 18, 40, 18]);
        return;
      }
      Vibration.vibrate(28);
    } catch {}
  }, []);

  const clearPendingStopTimeout = useCallback(() => {
    if (!pendingStopTimeoutRef.current) return;
    clearTimeout(pendingStopTimeoutRef.current);
    pendingStopTimeoutRef.current = null;
  }, []);

  const beginMediaSession = useCallback(() => {
    mediaSessionRef.current += 1;
    return mediaSessionRef.current;
  }, []);

  const abortProcessingRequests = useCallback(() => {
    processingAbortControllerRef.current?.abort();
    processingAbortControllerRef.current = null;
  }, []);

  const abortTtsRequests = useCallback(() => {
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;
  }, []);

  const releasePocketAudioSession = useCallback(
    async (mediaSessionId?: number) => {
      if (typeof mediaSessionId === "number" && mediaSessionRef.current !== mediaSessionId) {
        return;
      }
      if (
        typeof mediaSessionId === "number" &&
        favoritesPlaybackMediaSessionIdRef.current === mediaSessionId
      ) {
        favoritesPlaybackMediaSessionIdRef.current = null;
      }
      await setIsAudioActiveAsync(false).catch(() => {});
      if (typeof mediaSessionId === "number" && mediaSessionRef.current !== mediaSessionId) {
        return;
      }
      if (Platform.OS === "ios") {
        await AudioSession.stopAudioSession().catch(() => {});
      }
    },
    []
  );

  const clearTtsPlayerMonitor = useCallback(() => {
    if (!ttsPlayerMonitorRef.current) return;
    clearInterval(ttsPlayerMonitorRef.current);
    ttsPlayerMonitorRef.current = null;
  }, []);

  const clearTtsPlayerStatusSubscription = useCallback(() => {
    ttsPlayerStatusSubscriptionRef.current?.remove();
    ttsPlayerStatusSubscriptionRef.current = null;
  }, []);

  const clearCachedTts = useCallback(() => {
    const cached = ttsCacheRef.current;
    ttsCacheRef.current = null;
    if (!cached?.uri) return;
    void FileSystemLegacy.deleteAsync(cached.uri, { idempotent: true }).catch(() => {});
  }, []);

  const updateCachedTts = useCallback(
    (nextEntry: PocketTtsCacheEntry) => {
      const previous = ttsCacheRef.current;
      ttsCacheRef.current = nextEntry;
      if (previous?.uri && previous.uri !== nextEntry.uri) {
        void FileSystemLegacy.deleteAsync(previous.uri, { idempotent: true }).catch(() => {});
      }
    },
    []
  );

  const stopTtsPlayer = useCallback(
    (options?: { notifyEnded?: boolean }) => {
      clearTtsPlayerMonitor();
      clearTtsPlayerStatusSubscription();
      const onEnded = options?.notifyEnded ? ttsPlaybackEndHandlerRef.current : null;
      ttsPlaybackEndHandlerRef.current = null;
      const player = ttsPlayerRef.current;
      if (player) {
        try {
          player.clearLockScreenControls();
        } catch {}
        try {
          player.pause();
        } catch {}
        try {
          player.remove();
        } catch {}
      }
      ttsPlayerRef.current = null;
      const tempUri = ttsTempFileRef.current;
      const tempUriOwned = ttsTempFileOwnedRef.current;
      ttsTempFileRef.current = "";
      ttsTempFileOwnedRef.current = false;
      if (tempUri && tempUriOwned) {
        void FileSystemLegacy.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      }
      onEnded?.();
    },
    [clearTtsPlayerMonitor, clearTtsPlayerStatusSubscription]
  );

  const releaseFavoritesPlaybackSession = useCallback(
    async (expectedMediaSessionId?: number) => {
      const activeMediaSessionId = favoritesPlaybackMediaSessionIdRef.current;
      if (activeMediaSessionId === null) {
        return;
      }
      if (
        typeof expectedMediaSessionId === "number" &&
        activeMediaSessionId !== expectedMediaSessionId
      ) {
        return;
      }
      favoritesPlaybackMediaSessionIdRef.current = null;
      await releasePocketAudioSession(activeMediaSessionId);
    },
    [releasePocketAudioSession]
  );

  const stopFavoritesPlayback = useCallback(
    (options?: { bumpInteraction?: boolean; stopAudio?: boolean }) => {
      favoritesPlaybackRunRef.current += 1;
      clearFavoritesPlaybackState();
      if (options?.bumpInteraction !== false) {
        interactionSessionRef.current += 1;
      }
      if (options?.stopAudio === false) {
        return;
      }
      speechSessionRef.current += 1;
      ttsPlaybackSessionRef.current += 1;
      abortTtsRequests();
      void Speech.stop().catch(() => {});
      stopTtsPlayer({ notifyEnded: true });
      setStatus((current) => (current === "speaking" ? "idle" : current));
      void releaseFavoritesPlaybackSession();
    },
    [
      abortTtsRequests,
      clearFavoritesPlaybackState,
      releaseFavoritesPlaybackSession,
      stopTtsPlayer,
    ]
  );

  const openSourceEditModal = useCallback(() => {
    if (!currentExchangeCanEdit) return;
    interactionSessionRef.current += 1;
    stopFavoritesPlayback({ bumpInteraction: false, stopAudio: false });
    speechSessionRef.current += 1;
    abortTtsRequests();
    void Speech.stop();
    stopTtsPlayer();
    clearCachedTts();
    setStatus("idle");
    setError("");
    setSourceEditError("");
    setFaceModeVisible(false);
    setHistoryModalVisible(false);
    setSourceEditDraft(sourceText.trim());
    setSourceEditModalVisible(true);
  }, [
    abortTtsRequests,
    clearCachedTts,
    currentExchangeCanEdit,
    sourceText,
    stopFavoritesPlayback,
    stopTtsPlayer,
  ]);

  const stopPocketMedia = useCallback(
    async (options?: { stopRecorder?: boolean; mediaSessionId?: number }) => {
      if (
        typeof options?.mediaSessionId === "number" &&
        mediaSessionRef.current !== options.mediaSessionId
      ) {
        return;
      }
      abortTtsRequests();
      stopTtsPlayer();
      await Speech.stop().catch(() => {});
      if (
        typeof options?.mediaSessionId === "number" &&
        mediaSessionRef.current !== options.mediaSessionId
      ) {
        return;
      }
      if (options?.stopRecorder) {
        await recorder.stop().catch(() => {});
        if (
          typeof options?.mediaSessionId === "number" &&
          mediaSessionRef.current !== options.mediaSessionId
        ) {
          return;
        }
      }
      clearFavoritesPlaybackState();
      clearCachedTts();
      recorderPreparedRef.current = false;
      startInFlightRef.current = false;
      pendingStopAfterStartRef.current = false;
      recordingStartedAtRef.current = 0;
      await releaseFavoritesPlaybackSession();
      await releasePocketAudioSession(options?.mediaSessionId);
    },
    [
      abortTtsRequests,
      clearCachedTts,
      clearFavoritesPlaybackState,
      releaseFavoritesPlaybackSession,
      recorder,
      releasePocketAudioSession,
      stopTtsPlayer,
    ]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasActive = appStateRef.current === "active";
      appStateRef.current = nextState;
      if (nextState !== "active") {
        if (isBackgroundPlaybackAllowed()) {
          setFaceModeVisible(false);
          setHistoryModalVisible(false);
          setSourceEditModalVisible(false);
          setSourceEditDraft("");
          setSourceEditBusy(false);
          setSourceEditError("");
          return;
        }
        const mediaSessionId = beginMediaSession();
        clearPendingStopTimeout();
        abortTtsRequests();
        speechSessionRef.current += 1;
        ttsPlaybackSessionRef.current += 1;
        interactionSessionRef.current += 1;
        clearFavoritesPlaybackState();
        abortProcessingRequests();
        setFaceModeVisible(false);
        setHistoryModalVisible(false);
        setSourceEditModalVisible(false);
        setSourceEditDraft("");
        setSourceEditBusy(false);
        setSourceEditError("");
        if (status === "processing") {
          setStatus("idle");
          void releasePocketAudioSession(mediaSessionId);
          return;
        }
        if (status === "recording" || startInFlightRef.current || recorderState.isRecording) {
          setStatus("idle");
          void stopPocketMedia({ stopRecorder: true, mediaSessionId });
          return;
        }
        if (status === "speaking") {
          setStatus("idle");
          void stopPocketMedia({ mediaSessionId });
          return;
        }
        void releasePocketAudioSession(mediaSessionId);
        return;
      }
      if (!wasActive && nextState === "active") {
        void refreshBearerToken().then(() => {
          refetchCredits();
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    abortProcessingRequests,
    abortTtsRequests,
    beginMediaSession,
    clearFavoritesPlaybackState,
    clearPendingStopTimeout,
    isBackgroundPlaybackAllowed,
    recorderState.isRecording,
    refetchCredits,
    refreshBearerToken,
    releasePocketAudioSession,
    startInFlightRef,
    status,
    stopPocketMedia,
  ]);

  const ensureIosSpeakerOutput = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    try {
      await AudioSession.startAudioSession();
    } catch {}
    try {
      await AudioSession.selectAudioOutput("force_speaker");
    } catch {}
  }, []);

  const setPlaybackAudioMode = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: Platform.OS === "ios" ? "doNotMix" : "duckOthers",
      shouldPlayInBackground: isBackgroundPlaybackAllowed(),
      shouldRouteThroughEarpiece: false,
    });
    if (Platform.OS === "ios") {
      await ensureIosSpeakerOutput();
      await wait(80);
    }
  }, [ensureIosSpeakerOutput, isBackgroundPlaybackAllowed]);

  const setRecordingAudioMode = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: Platform.OS === "ios" ? "doNotMix" : "duckOthers",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    if (Platform.OS === "ios") {
      await ensureIosSpeakerOutput();
      await wait(120);
    }
  }, [ensureIosSpeakerOutput]);

  const blobToBase64 = useCallback((blob: Blob) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => {
        reject(
          new Error(
            language === "fr" ? "Impossible de decoder l'audio TTS." : "Unable to decode TTS audio."
          )
        );
      };
      reader.readAsDataURL(blob);
    });
  }, [language]);

  const writeBase64TtsToTempFile = useCallback(
    async (audioBase64: string, format: "wav" | "mp3") => {
      const cacheBase = FileSystemLegacy.cacheDirectory || FileSystemLegacy.documentDirectory;
      if (!cacheBase) {
        throw new Error(
          language === "fr" ? "Cache audio indisponible." : "Audio cache unavailable."
        );
      }
      const tempUri = `${cacheBase}bfzoom-pocket-tts-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${getTtsTempExtension(format)}`;
      await FileSystemLegacy.writeAsStringAsync(tempUri, audioBase64, {
        encoding: "base64" as never,
      });
      return tempUri;
    },
    [language]
  );

  const playTtsUri = useCallback(
    (
      uri: string,
      onEnded?: () => void,
      options?: {
        playbackRate?: number;
        cleanupOnEnd?: boolean;
        lockScreenMetadata?: {
          title?: string;
          artist?: string;
          albumTitle?: string;
          artworkUrl?: string;
        };
      }
    ) => {
      stopTtsPlayer();
      ttsPlaybackEndHandlerRef.current = onEnded || null;
      const player = createAudioPlayer(
        { uri },
        {
          keepAudioSessionActive: true,
          updateInterval: 120,
        }
      );
      ttsPlayerRef.current = player;
      ttsTempFileRef.current = uri;
      ttsTempFileOwnedRef.current = options?.cleanupOnEnd === true;
      try {
        player.volume = 1;
      } catch {}
      const playbackRate =
        typeof options?.playbackRate === "number" && Number.isFinite(options.playbackRate)
          ? Math.max(0.5, Math.min(1.25, options.playbackRate))
          : 1;
      try {
        if (typeof player.setPlaybackRate === "function") {
          player.setPlaybackRate(playbackRate, "high");
        } else {
          player.playbackRate = playbackRate;
          player.shouldCorrectPitch = true;
        }
      } catch {}
      const statusSubscription = player.addListener("playbackStatusUpdate", (status) => {
        const activePlayer = ttsPlayerRef.current;
        if (!activePlayer || activePlayer !== player) {
          return;
        }
        if (status.didJustFinish) {
          stopTtsPlayer({ notifyEnded: true });
        }
      });
      ttsPlayerStatusSubscriptionRef.current = statusSubscription;
      if (Platform.OS === "ios") {
        try {
          player.setActiveForLockScreen(true, {
            title: options?.lockScreenMetadata?.title || "BFZoom",
            artist: options?.lockScreenMetadata?.artist || "Pocket Interpreter",
            albumTitle: options?.lockScreenMetadata?.albumTitle,
            artworkUrl: options?.lockScreenMetadata?.artworkUrl,
          });
        } catch {}
      }
      player.play();
    },
    [stopTtsPlayer]
  );

  const waitForTtsPlaybackStart = useCallback(async (sessionId: number, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (sessionId !== ttsPlaybackSessionRef.current) return false;
      const player = ttsPlayerRef.current;
      if (player && (player.playing || player.currentTime > 0.02 || player.duration > 0.1)) {
        return true;
      }
      await wait(80);
    }
    const player = ttsPlayerRef.current;
    return Boolean(player && (player.playing || player.currentTime > 0.02 || player.duration > 0.1));
  }, []);

  const speakTranslation = useCallback(
    async (
      text: string,
      nextLanguage: LanguageCode,
      options?: {
        slow?: boolean;
        bearerToken?: string;
        historyEntryId?: string;
        allowServerTts?: boolean;
        awaitCompletion?: boolean;
        allowDeviceVoiceFallback?: boolean;
        mediaSessionId?: number;
        releaseAudioSessionOnEnd?: boolean;
      }
    ) => {
      const content = text.trim();
      let resolveCompletion: (() => void) | null = null;
      let completionSettled = false;
      const completionPromise = options?.awaitCompletion
        ? new Promise<void>((resolve) => {
            resolveCompletion = resolve;
          })
        : null;
      const settleCompletion = () => {
        if (completionSettled) return;
        completionSettled = true;
        resolveCompletion?.();
      };
      const waitForCompletionIfNeeded = async () => {
        if (!completionPromise) return;
        await completionPromise;
      };

      if (!content) {
        settleCompletion();
        return;
      }
      if (!isPlaybackAllowedInCurrentAppState()) {
        settleCompletion();
        return;
      }

      const locale =
        LANGUAGE_OPTIONS.find((item) => item.code === nextLanguage)?.speechLocale || "en-US";
      const preferredDeviceVoiceId = selectPreferredDeviceVoiceId(
        availableVoices,
        nextLanguage,
        locale
      );
      const preferredNaturalDeviceVoiceId = selectPreferredEnhancedDeviceVoiceId(
        availableVoices,
        nextLanguage,
        locale
      );
      const autoSelectedDeviceVoiceId =
        preferredNaturalDeviceVoiceId || preferredDeviceVoiceId;
      const preferDeviceVoice =
        shouldPreferNativeTtsLanguage(nextLanguage) && Boolean(preferredNaturalDeviceVoiceId);
      const aiTtsInstructions = buildAiTtsInstructions({
        languageCode: nextLanguage,
        languageLabel: LANGUAGE_PROMPT_NAMES[nextLanguage] || nextLanguage,
      });
      const mediaSessionId =
        typeof options?.mediaSessionId === "number" ? options.mediaSessionId : beginMediaSession();
      const releaseAudioSessionOnEnd = options?.releaseAudioSessionOnEnd !== false;
      const allowDeviceVoiceFallback = options?.allowDeviceVoiceFallback !== false;
      clearPendingStopTimeout();
      const sessionId = speechSessionRef.current + 1;
      const historyEntryId = (options?.historyEntryId || "").trim();
      speechSessionRef.current = sessionId;
      ttsPlaybackSessionRef.current = sessionId;
      if (!isPlaybackAllowedInCurrentAppState()) {
        await releasePocketAudioSession(mediaSessionId);
        settleCompletion();
        return;
      }
      setStatus("speaking");
      triggerHaptic("speak");
      logPocket("tts_session_start", {
        sessionId,
        targetLanguage: nextLanguage,
        textChars: content.length,
        slow: options?.slow === true,
        historyEntryId: historyEntryId || undefined,
      });

      const finish = (mode: "ai" | "cache" | "device" | "history", reason: string) => {
        logPocket("tts_end", {
          sessionId,
          mode,
          reason,
          targetLanguage: nextLanguage,
        });
        settleCompletion();
        if (
          sessionId !== speechSessionRef.current ||
          mediaSessionRef.current !== mediaSessionId
        ) {
          return;
        }
        if (releaseAudioSessionOnEnd) {
          setStatus("idle");
          void releasePocketAudioSession(mediaSessionId);
        }
      };

      const isPlaybackSessionActive = () =>
        sessionId === speechSessionRef.current &&
        sessionId === ttsPlaybackSessionRef.current &&
        mediaSessionRef.current === mediaSessionId &&
        isPlaybackAllowedInCurrentAppState();

      const speakWithDeviceVoice = async (fallback: boolean, reason: string) => {
        if (!isPlaybackSessionActive()) {
          finish("device", "superseded");
          return;
        }
        if (!allowDeviceVoiceFallback) {
          logPocket("tts_device_fallback_skipped", {
            sessionId,
            targetLanguage: nextLanguage,
            reason,
          });
          if (isPlaybackSessionActive()) {
            setError(ui.playbackFailed);
          }
          finish("device", "fallback_disabled");
          return;
        }
        const deviceLocale = locale;
        logPocket("tts_fallback_device", {
          sessionId,
          targetLanguage: nextLanguage,
          slow: options?.slow === true,
          fallback,
          reason,
          selectedVoice: fallback ? "auto" : autoSelectedDeviceVoiceId || "auto",
        });
        Speech.speak(content, {
          language: deviceLocale,
          rate: options?.slow ? POCKET_SLOW_REPLAY_PLAYBACK_RATE : 0.96,
          pitch: 1,
          voice: fallback ? undefined : autoSelectedDeviceVoiceId,
          useApplicationAudioSession: Platform.OS === "ios",
          onDone: () => finish("device", "done"),
          onStopped: () => finish("device", "stopped"),
          onError: () => {
            if (isPlaybackSessionActive()) {
              setError(ui.playbackFailed);
            }
            finish("device", "error");
          },
        });
        await waitForCompletionIfNeeded();
      };

      let ttsController: AbortController | null = null;
      try {
        abortTtsRequests();
        ttsController = typeof AbortController !== "undefined" ? new AbortController() : null;
        ttsAbortControllerRef.current = ttsController;
        await setPlaybackAudioMode();
        await setIsAudioActiveAsync(true).catch(() => {});
        stopTtsPlayer();
        await Speech.stop();
        if (!isPlaybackSessionActive()) {
          finish("ai", "superseded");
          return;
        }
        const cachedEntry = ttsCacheRef.current;
        if (
          cachedEntry &&
          cachedEntry.text === content &&
          cachedEntry.language === nextLanguage
        ) {
          const cachedInfo = await FileSystemLegacy.getInfoAsync(cachedEntry.uri).catch(() => null);
          if (cachedInfo?.exists) {
            logPocket("tts_cache_hit", {
              sessionId,
              targetLanguage: nextLanguage,
              slow: options?.slow === true,
              historyEntryId: historyEntryId || undefined,
            });
            playTtsUri(cachedEntry.uri, () => finish("cache", "ended"), {
              playbackRate: options?.slow ? POCKET_SLOW_REPLAY_PLAYBACK_RATE : 1,
              cleanupOnEnd: false,
              lockScreenMetadata: {
                title: content.slice(0, 60),
                artist: "BFZoom",
              },
            });
            if (Platform.OS === "ios" && appStateRef.current === "active") {
              const playbackWaitStartedAt = Date.now();
              const playbackStarted = await waitForTtsPlaybackStart(
                sessionId,
                IOS_AI_TTS_PLAYBACK_START_TIMEOUT_MS
              );
                if (playbackStarted) {
                  logPocket("tts_play_start", {
                  sessionId,
                  mode: "cache",
                  playbackWaitMs: Date.now() - playbackWaitStartedAt,
                    targetLanguage: nextLanguage,
                  });
                  await waitForCompletionIfNeeded();
                  return;
                }
              logPocket("tts_playback_stalled", {
                sessionId,
                mode: "cache",
                targetLanguage: nextLanguage,
              });
              if (isPlaybackSessionActive()) {
                setError(ui.playbackFailed);
              }
              stopTtsPlayer();
            } else {
                logPocket("tts_play_start", {
                  sessionId,
                  mode: "cache",
                  playbackWaitMs: 0,
                  targetLanguage: nextLanguage,
                });
                await waitForCompletionIfNeeded();
                return;
              }
          } else {
            clearCachedTts();
          }
        }
        const activeBearerToken = (options?.bearerToken || "").trim()
          || (await refreshBearerToken()).trim();
        if (!isPlaybackSessionActive()) {
          finish("ai", "superseded");
          return;
        }
        const allowServerTts =
          options?.allowServerTts !== false &&
          Boolean(activeBearerToken) &&
          Boolean(credits?.enabled) &&
          !effectiveCreditsError;
        if (preferDeviceVoice) {
          logPocket("tts_device_preferred", {
            sessionId,
            targetLanguage: nextLanguage,
            selectedVoice: preferredNaturalDeviceVoiceId || "auto",
            textChars: Math.min(content.length, AI_TTS_MAX_CHARS),
          });
          await speakWithDeviceVoice(false, "native_preferred");
          return;
        }
        if (AI_TTS_ENABLED && apiBaseUrl && allowServerTts) {
          const cacheBase = FileSystemLegacy.cacheDirectory || FileSystemLegacy.documentDirectory;
          if (cacheBase) {
            const preferredFormats =
              Platform.OS === "ios" ? IOS_AI_TTS_FORMAT_PREFERENCE : [DEFAULT_AI_TTS_FORMAT];
            let lastTtsError = "";
            for (const format of preferredFormats) {
              try {
                const requestStartedAt = Date.now();
                logPocket("tts_request", {
                  sessionId,
                  format,
                  targetLanguage: nextLanguage,
                  textChars: Math.min(content.length, AI_TTS_MAX_CHARS),
                  slow: options?.slow === true,
                  historyEntryId: historyEntryId || undefined,
                });
                const audioBlob = await fetchTtsAudio({
                  apiBaseUrl,
                  bearerToken: activeBearerToken,
                  text: content.slice(0, AI_TTS_MAX_CHARS),
                  voice: AI_TTS_DEFAULT_VOICE,
                  format,
                  language: nextLanguage,
                  locale,
                  instructions: aiTtsInstructions,
                  pocketFlow: true,
                  signal: ttsController?.signal,
                });
                const responseReadyAt = Date.now();
                const blobReadyAt = Date.now();
                const audioBase64 = await blobToBase64(audioBlob);
                const base64ReadyAt = Date.now();
                const tempUri = `${cacheBase}bfzoom-pocket-tts-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 8)}.${getTtsTempExtension(format)}`;
                await FileSystemLegacy.writeAsStringAsync(tempUri, audioBase64, {
                  encoding: "base64" as never,
                });
                const fileReadyAt = Date.now();
                logPocket("tts_response", {
                  sessionId,
                  format,
                  targetLanguage: nextLanguage,
                  networkMs: responseReadyAt - requestStartedAt,
                  blobMs: blobReadyAt - responseReadyAt,
                  base64Ms: base64ReadyAt - blobReadyAt,
                  fileWriteMs: fileReadyAt - base64ReadyAt,
                  localPrepMs: fileReadyAt - blobReadyAt,
                  audioBytes: audioBlob.size,
                });
                if (!isPlaybackSessionActive()) {
                  void FileSystemLegacy.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
                  logPocket("tts_superseded", {
                    sessionId,
                    format,
                    targetLanguage: nextLanguage,
                  });
                  finish("ai", "superseded");
                  return;
                }
                updateCachedTts({
                  text: content,
                  language: nextLanguage,
                  uri: tempUri,
                });
                playTtsUri(tempUri, () => finish("ai", "ended"), {
                  playbackRate: options?.slow ? POCKET_SLOW_REPLAY_PLAYBACK_RATE : 1,
                  cleanupOnEnd: false,
                  lockScreenMetadata: {
                    title: content.slice(0, 60),
                    artist: "BFZoom",
                  },
                });
                if (historyEntryId) {
                  void persistHistoryAudioUri(tempUri, historyEntryId, "translation")
                    .then((persistedAudioUri) => {
                      if (!persistedAudioUri) return;
                      updateHistoryEntryAudio(historyEntryId, persistedAudioUri);
                      logPocket("history_audio_persisted", {
                        sessionId,
                        entryId: historyEntryId,
                        format,
                      });
                    })
                    .catch(() => {});
                }
                if (Platform.OS === "ios" && appStateRef.current === "active") {
                  const playbackWaitStartedAt = Date.now();
                  const playbackStarted = await waitForTtsPlaybackStart(
                    sessionId,
                    IOS_AI_TTS_PLAYBACK_START_TIMEOUT_MS
                  );
                  if (!playbackStarted) {
                    lastTtsError =
                      language === "fr"
                        ? "Lecture audio iOS bloquee."
                        : "iOS audio playback stalled.";
                    logPocket("tts_playback_stalled", {
                      sessionId,
                      mode: "ai",
                      format,
                      targetLanguage: nextLanguage,
                    });
                    if (isPlaybackSessionActive()) {
                      setError(ui.playbackFailed);
                    }
                    stopTtsPlayer();
                    continue;
                  }
                  logPocket("tts_play_start", {
                    sessionId,
                    mode: "ai",
                    format,
                    targetLanguage: nextLanguage,
                    playbackWaitMs: Date.now() - playbackWaitStartedAt,
                    totalToPlayMs: Date.now() - requestStartedAt,
                  });
                  await waitForCompletionIfNeeded();
                } else {
                  logPocket("tts_play_start", {
                    sessionId,
                    mode: "ai",
                    format,
                    targetLanguage: nextLanguage,
                    playbackWaitMs: 0,
                    totalToPlayMs: Date.now() - requestStartedAt,
                  });
                  await waitForCompletionIfNeeded();
                }
                return;
              } catch (ttsError) {
                if (isTranslationAbortError(ttsError)) {
                  throw ttsError;
                }
                lastTtsError =
                  ttsError instanceof Error
                    ? ttsError.message.trim()
                    : String(ttsError || "").trim();
                logPocket("tts_format_failed", {
                  sessionId,
                  format,
                  targetLanguage: nextLanguage,
                  message: lastTtsError || "unknown",
                });
              }
            }
            if (lastTtsError) {
              logPocket("tts_ai_failed", {
                sessionId,
                targetLanguage: nextLanguage,
                message: lastTtsError,
              });
              if (isPlaybackSessionActive()) {
                setError(
                  language === "fr"
                    ? `Voix IA indisponible: ${lastTtsError}.`
                    : `AI voice unavailable: ${lastTtsError}.`
                );
              }
            }
          }
        }
        await speakWithDeviceVoice(false, "ai_tts_unavailable");
      } catch (nextError) {
        if (isTranslationAbortError(nextError)) {
          finish("ai", "superseded");
          return;
        }
        logPocket("tts_session_failed", {
          sessionId,
          targetLanguage: nextLanguage,
          message:
            nextError instanceof Error ? nextError.message.trim() : String(nextError || "").trim(),
        });
        await speakWithDeviceVoice(true, "session_error");
      } finally {
        if (ttsAbortControllerRef.current === ttsController) {
          ttsAbortControllerRef.current = null;
        }
      }
    },
    [
      apiBaseUrl,
      availableVoices,
      abortTtsRequests,
      blobToBase64,
      beginMediaSession,
      clearCachedTts,
      clearPendingStopTimeout,
      credits?.enabled,
      effectiveCreditsError,
      isPlaybackAllowedInCurrentAppState,
      language,
      playTtsUri,
      persistHistoryAudioUri,
      refreshBearerToken,
      releasePocketAudioSession,
      setPlaybackAudioMode,
      stopTtsPlayer,
      triggerHaptic,
      ui.playbackFailed,
      updateHistoryEntryAudio,
      updateCachedTts,
      waitForTtsPlaybackStart,
    ]
  );

  const playStoredHistoryAudio = useCallback(
    async ({
      uri,
      entryId,
      playbackLanguage,
      slow,
      awaitCompletion,
      track,
      onMissing,
      mediaSessionId: providedMediaSessionId,
      releaseAudioSessionOnEnd: providedReleaseAudioSessionOnEnd,
    }: {
      uri: string;
      entryId: string;
      playbackLanguage: LanguageCode;
      slow?: boolean;
      awaitCompletion?: boolean;
      track: "source" | "translation";
      onMissing?: () => void;
      mediaSessionId?: number;
      releaseAudioSessionOnEnd?: boolean;
    }) => {
      const cleanUri = uri.trim();
      if (!cleanUri) return false;

      const audioInfo = await FileSystemLegacy.getInfoAsync(cleanUri).catch(() => null);
      if (!audioInfo?.exists) {
        logPocket("history_replay_audio_missing", {
          entryId,
          targetLanguage: playbackLanguage,
          track,
        });
        onMissing?.();
        return false;
      }

      let resolveCompletion: (() => void) | null = null;
      let completionSettled = false;
      const completionPromise = awaitCompletion
        ? new Promise<void>((resolve) => {
            resolveCompletion = resolve;
          })
        : null;
      const settleCompletion = () => {
        if (completionSettled) return;
        completionSettled = true;
        resolveCompletion?.();
      };
      const mediaSessionId =
        typeof providedMediaSessionId === "number"
          ? providedMediaSessionId
          : beginMediaSession();
      const releaseAudioSessionOnEnd = providedReleaseAudioSessionOnEnd !== false;
      clearPendingStopTimeout();
      const sessionId = speechSessionRef.current + 1;
      const playbackRate = slow ? POCKET_SLOW_REPLAY_PLAYBACK_RATE : 1;
      speechSessionRef.current = sessionId;
      ttsPlaybackSessionRef.current = sessionId;
      const isReplaySessionActive = () =>
        sessionId === speechSessionRef.current &&
        sessionId === ttsPlaybackSessionRef.current &&
        mediaSessionRef.current === mediaSessionId &&
        isPlaybackAllowedInCurrentAppState();
      setStatus("speaking");
      triggerHaptic("speak");
      logPocket("history_replay_audio", {
        sessionId,
        entryId,
        targetLanguage: playbackLanguage,
        slow: slow === true,
        playbackRate,
        track,
      });
      await setPlaybackAudioMode().catch(() => {});
      await setIsAudioActiveAsync(true).catch(() => {});
      stopTtsPlayer();
      await Speech.stop();
      if (!isReplaySessionActive()) {
        if (releaseAudioSessionOnEnd) {
          setStatus("idle");
          await releasePocketAudioSession(mediaSessionId);
        }
        settleCompletion();
        return true;
      }
      const playbackWaitStartedAt = Date.now();
      playTtsUri(
        cleanUri,
        () => {
          logPocket("tts_end", {
            sessionId,
            mode: "history",
            reason: "ended",
            targetLanguage: playbackLanguage,
            track,
          });
          if (
            sessionId !== speechSessionRef.current ||
            mediaSessionRef.current !== mediaSessionId
          ) {
            settleCompletion();
            return;
          }
          if (releaseAudioSessionOnEnd) {
            setStatus("idle");
            void releasePocketAudioSession(mediaSessionId);
          }
          settleCompletion();
        },
        {
          playbackRate,
          cleanupOnEnd: false,
          lockScreenMetadata: {
            title: track === "source" ? "BFZoom source" : "BFZoom translation",
            artist: "BFZoom",
          },
        }
      );
      const playbackStarted =
        Platform.OS === "ios" && appStateRef.current !== "active"
          ? true
          : await waitForTtsPlaybackStart(sessionId, IOS_AI_TTS_PLAYBACK_START_TIMEOUT_MS);
      if (playbackStarted) {
        logPocket("tts_play_start", {
          sessionId,
          mode: "history",
          targetLanguage: playbackLanguage,
          slow: slow === true,
          playbackRate,
          playbackWaitMs: Date.now() - playbackWaitStartedAt,
          track,
        });
        if (completionPromise) {
          await completionPromise;
        }
      } else {
        logPocket("tts_playback_stalled", {
          sessionId,
          mode: "history",
          targetLanguage: playbackLanguage,
          slow: slow === true,
          playbackRate,
          track,
        });
        if (isReplaySessionActive()) {
          setError(ui.playbackFailed);
        }
        stopTtsPlayer({ notifyEnded: true });
        if (completionPromise) {
          await completionPromise;
        }
      }
      return true;
    },
    [
      beginMediaSession,
      clearPendingStopTimeout,
      isPlaybackAllowedInCurrentAppState,
      playTtsUri,
      releasePocketAudioSession,
      setPlaybackAudioMode,
      stopTtsPlayer,
      triggerHaptic,
      ui.playbackFailed,
      waitForTtsPlaybackStart,
    ]
  );

  const replayHistoryEntry = useCallback(
    async (
      entry: PocketHistoryItem,
      options?: {
        slow?: boolean;
        awaitCompletion?: boolean;
        preserveInteractionSession?: boolean;
        bearerToken?: string;
        mediaSessionId?: number;
        releaseAudioSessionOnEnd?: boolean;
        allowDeviceVoiceFallback?: boolean;
      }
    ) => {
      if (status === "processing") {
        setError(ui.processingBusy);
        return;
      }
      if (!options?.preserveInteractionSession) {
        interactionSessionRef.current += 1;
      }
      const playedStoredAudio = await playStoredHistoryAudio({
        uri: entry.audioUri || "",
        entryId: entry.id,
        playbackLanguage: entry.targetLanguage,
        slow: options?.slow,
        awaitCompletion: options?.awaitCompletion,
        track: "translation",
        onMissing: () => updateHistoryEntryAudio(entry.id, null),
        mediaSessionId: options?.mediaSessionId,
        releaseAudioSessionOnEnd: options?.releaseAudioSessionOnEnd,
      });
      if (playedStoredAudio) {
        return;
      }
      logPocket("history_replay_tts", {
        entryId: entry.id,
        targetLanguage: entry.targetLanguage,
        slow: options?.slow === true,
      });
      await speakTranslation(entry.translatedText, entry.targetLanguage, {
        slow: options?.slow,
        historyEntryId: entry.id,
        awaitCompletion: options?.awaitCompletion,
        bearerToken: options?.bearerToken,
        mediaSessionId: options?.mediaSessionId,
        releaseAudioSessionOnEnd: options?.releaseAudioSessionOnEnd,
        allowDeviceVoiceFallback: options?.allowDeviceVoiceFallback,
      });
    },
    [
      playStoredHistoryAudio,
      speakTranslation,
      status,
      ui.processingBusy,
      updateHistoryEntryAudio,
    ]
  );

  const resetCurrentExchange = useCallback(() => {
    logPocket("exchange_reset", {
      sourceLanguage,
      targetLanguage,
      hadSourceText: Boolean(sourceText.trim()),
      hadTranslatedText: Boolean(translatedText.trim()),
    });
    setSourceText("");
    setTranslatedText("");
    setError("");
    setSourceEditModalVisible(false);
    setSourceEditDraft("");
    setSourceEditBusy(false);
    setSourceEditError("");
    setCurrentExchangeEntryId(null);
    setCurrentExchangeRetranslatable(false);
    stopFavoritesPlayback({ bumpInteraction: false, stopAudio: false });
    speechSessionRef.current += 1;
    abortTtsRequests();
    void Speech.stop();
    stopTtsPlayer();
    clearCachedTts();
    setStatus("idle");
  }, [
    abortTtsRequests,
    clearCachedTts,
    sourceLanguage,
    sourceText,
    stopFavoritesPlayback,
    stopTtsPlayer,
    targetLanguage,
    translatedText,
  ]);

  const removeCurrentExchange = useCallback(() => {
    const entryId = (currentExchangeEntryId || "").trim();
    if (!entryId) {
      resetCurrentExchange();
      return;
    }
    removeHistoryEntry(entryId);
    resetCurrentExchange();
  }, [currentExchangeEntryId, removeHistoryEntry, resetCurrentExchange]);

  const applyHistoryEntry = useCallback(
    (entry: PocketHistoryItem) => {
      if (status === "processing") {
        setError(ui.processingBusy);
        return;
      }
      interactionSessionRef.current += 1;
      stopFavoritesPlayback({ bumpInteraction: false, stopAudio: false });
      logPocket("history_apply", {
        entryId: entry.id,
        sourceLanguage: entry.sourceLanguage,
        targetLanguage: entry.targetLanguage,
        hasAudio: Boolean((entry.audioUri || "").trim() || (entry.sourceAudioUri || "").trim()),
      });
      speechSessionRef.current += 1;
      abortTtsRequests();
      void Speech.stop();
      stopTtsPlayer();
      clearCachedTts();
      setError("");
      setStatus("idle");
      setFaceModeVisible(false);
      setSourceEditModalVisible(false);
      setSourceEditDraft("");
      setSourceEditBusy(false);
      setSourceEditError("");
      setCurrentExchangeEntryId(entry.id);
      setCurrentExchangeRetranslatable(false);
      setSourceLanguage(entry.sourceLanguage);
      setTargetLanguage(entry.targetLanguage);
      setSourceText(entry.sourceText);
      setTranslatedText(entry.translatedText);
      setHistoryModalVisible(false);
    },
    [
      abortTtsRequests,
      clearCachedTts,
      status,
      stopFavoritesPlayback,
      stopTtsPlayer,
      ui.processingBusy,
    ]
  );

  const closeHistoryModal = useCallback(() => {
    stopFavoritesPlayback();
    setHistoryModalVisible(false);
  }, [stopFavoritesPlayback]);

  const openRecentHistoryModal = useCallback(() => {
    setHistoryFavoritesOnly(false);
    setHistoryModalVisible(true);
  }, []);

  const openFavoriteHistoryModal = useCallback(() => {
    setHistoryFavoritesOnly(true);
    setHistoryModalVisible(true);
  }, []);

  const playFavoritePlaylist = useCallback(async () => {
    if (status === "processing") {
      setError(ui.processingBusy);
      return;
    }
    if (favoriteHistory.length === 0) {
      return;
    }

    const playbackRunId = favoritesPlaybackRunRef.current + 1;
    favoritesPlaybackRunRef.current = playbackRunId;
    favoritesPlaybackActiveRef.current = true;
    interactionSessionRef.current += 1;
    const interactionSessionId = interactionSessionRef.current;
    const isPlaybackCurrent = () =>
      favoritesPlaybackRunRef.current === playbackRunId &&
      interactionSessionRef.current === interactionSessionId &&
      isPlaybackAllowedInCurrentAppState();

    abortTtsRequests();
    void Speech.stop().catch(() => {});
    stopTtsPlayer({ notifyEnded: true });
    clearCachedTts();
    setError("");
    setFavoritesPlaybackActive(true);
    setFavoritesPlaybackEntryId(null);
    setFavoritesPlaybackIndex(0);
    setFavoritesPlaybackTotal(favoriteHistory.length);
    setStatus((current) => (current === "speaking" ? "idle" : current));

    logPocket("favorites_playback_start", {
      favorites: favoriteHistory.length,
    });

    try {
      const playlistMediaSessionId = beginMediaSession();
      favoritesPlaybackMediaSessionIdRef.current = playlistMediaSessionId;
      await setPlaybackAudioMode().catch(() => {});
      await setIsAudioActiveAsync(true).catch(() => {});
      const activeBearerToken =
        (bearerToken || "").trim() || (await refreshBearerToken()).trim() || undefined;
      for (let index = 0; index < favoriteHistory.length; index += 1) {
        if (!isPlaybackCurrent()) return;
        const entry = favoriteHistory[index];
        setFavoritesPlaybackEntryId(entry.id);
        setFavoritesPlaybackIndex(index + 1);
        logPocket("favorites_playback_entry", {
          entryId: entry.id,
          index: index + 1,
          total: favoriteHistory.length,
          sourceLanguage: entry.sourceLanguage,
          targetLanguage: entry.targetLanguage,
        });
        const playedRecordedSource = await playStoredHistoryAudio({
          uri: entry.sourceAudioUri || "",
          entryId: entry.id,
          playbackLanguage: entry.sourceLanguage,
          awaitCompletion: true,
          track: "source",
          onMissing: () => updateHistoryEntrySourceAudio(entry.id, null),
          mediaSessionId: playlistMediaSessionId,
          releaseAudioSessionOnEnd: false,
        });
        if (!playedRecordedSource) {
          await speakTranslation(entry.sourceText, entry.sourceLanguage, {
            awaitCompletion: true,
            bearerToken: activeBearerToken,
            mediaSessionId: playlistMediaSessionId,
            releaseAudioSessionOnEnd: false,
            allowDeviceVoiceFallback: true,
          });
        }
        if (!isPlaybackCurrent()) return;
        if (appStateRef.current === "active") {
          await wait(POCKET_FAVORITES_PLAYBACK_PAUSE_MS);
        }
        if (!isPlaybackCurrent()) return;
        await replayHistoryEntry(entry, {
          awaitCompletion: true,
          preserveInteractionSession: true,
          bearerToken: activeBearerToken,
          mediaSessionId: playlistMediaSessionId,
          releaseAudioSessionOnEnd: false,
          allowDeviceVoiceFallback: false,
        });
        if (!isPlaybackCurrent()) return;
        if (appStateRef.current === "active") {
          await wait(POCKET_FAVORITES_PLAYBACK_PAUSE_MS);
        }
      }
      logPocket("favorites_playback_done", {
        favorites: favoriteHistory.length,
      });
    } catch (nextError) {
      if (!isTranslationAbortError(nextError) && isPlaybackCurrent()) {
        setError(
          nextError instanceof Error && nextError.message.trim()
            ? nextError.message.trim()
            : ui.playbackFailed
        );
      }
      logPocket("favorites_playback_failed", {
        message:
          nextError instanceof Error ? nextError.message.trim() : String(nextError || "").trim(),
      });
    } finally {
      await releaseFavoritesPlaybackSession();
      if (favoritesPlaybackRunRef.current === playbackRunId) {
        clearFavoritesPlaybackState();
        setStatus((current) => (current === "speaking" ? "idle" : current));
      }
    }
  }, [
    abortTtsRequests,
    bearerToken,
    beginMediaSession,
      clearCachedTts,
      clearFavoritesPlaybackState,
      favoriteHistory,
      isPlaybackAllowedInCurrentAppState,
      playStoredHistoryAudio,
      releaseFavoritesPlaybackSession,
    refreshBearerToken,
    replayHistoryEntry,
    setPlaybackAudioMode,
    speakTranslation,
    status,
    stopTtsPlayer,
    ui.playbackFailed,
    ui.processingBusy,
    updateHistoryEntrySourceAudio,
  ]);

  const retranslateEditedSource = useCallback(async () => {
    const nextSourceText = sourceEditDraft.trim();
    if (!nextSourceText) {
      setSourceEditError(ui.emptyEditSource);
      return;
    }
    if (!currentExchangeRetranslatable) {
      setSourceEditError(ui.correctionExpired);
      return;
    }
    if (status === "recording" || status === "processing") {
      setSourceEditError(ui.processingBusy);
      return;
    }

    interactionSessionRef.current += 1;
    const interactionSessionId = interactionSessionRef.current;
    const isEditSessionCurrent = () =>
      interactionSessionRef.current === interactionSessionId && appStateRef.current === "active";
    const processingController =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    processingAbortControllerRef.current = processingController;
    const previousEntryId = (currentExchangeEntryId || "").trim();

    setSourceEditBusy(true);
    setSourceEditError("");
    setError("");
    setStatus("processing");
    setFaceModeVisible(false);
    setHistoryModalVisible(false);
    abortTtsRequests();
    void Speech.stop();
    stopTtsPlayer();
    clearCachedTts();

    try {
      const activeBearerToken = (bearerToken || "").trim() || (await refreshBearerToken()).trim();
      if (!isEditSessionCurrent()) return;
      if (!activeBearerToken) {
        throw new Error(ui.accountIssue);
      }

      const translated = await translateText({
        apiBaseUrl,
        bearerToken: activeBearerToken,
        text: nextSourceText,
        fromLanguage: LANGUAGE_PROMPT_NAMES[sourceLanguage],
        toLanguage: LANGUAGE_PROMPT_NAMES[targetLanguage],
        pocketFlow: true,
        signal: processingController?.signal,
      });
      if (!isEditSessionCurrent()) return;

      const cleanTranslation = translated.trim();
      if (!cleanTranslation) {
        throw new Error(ui.translationEmpty);
      }

      let historyEntryId = previousEntryId;
      if (historyEntryId) {
        replaceHistoryEntryExchange(historyEntryId, nextSourceText, cleanTranslation);
      } else {
        const nextEntry: PocketHistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: Date.now(),
          sourceText: nextSourceText,
          translatedText: cleanTranslation,
          sourceLanguage,
          targetLanguage,
          favorite: false,
          sourceAudioUri: null,
          audioUri: null,
        };
        addHistoryEntry(nextEntry);
        historyEntryId = nextEntry.id;
      }

      logPocket("manual_retranslate_ok", {
        entryId: historyEntryId || undefined,
        sourceLanguage,
        targetLanguage,
        sourceChars: nextSourceText.length,
        translatedChars: cleanTranslation.length,
      });

      setCurrentExchangeEntryId(historyEntryId || null);
      setCurrentExchangeRetranslatable(true);
      setSourceText(nextSourceText);
      setTranslatedText(cleanTranslation);
      setSourceEditModalVisible(false);
      setSourceEditDraft("");
      setSourceEditError("");

      if (appStateRef.current === "active") {
        void speakTranslation(cleanTranslation, targetLanguage, {
          bearerToken: activeBearerToken,
          historyEntryId,
        });
      } else {
        setStatus("idle");
      }
    } catch (nextError) {
      if (isTranslationAbortError(nextError)) {
        if (isEditSessionCurrent()) {
          setStatus("idle");
        }
        return;
      }
      const rawMessage =
        nextError instanceof Error ? nextError.message.trim() : String(nextError || "").trim();
      const nextMessage = /recent translation consumption required/i.test(rawMessage)
        ? ui.correctionExpired
        : rawMessage || ui.translationEmpty;
      if (isEditSessionCurrent()) {
        setStatus("idle");
        setSourceEditError(nextMessage);
      }
      logPocket("manual_retranslate_failed", {
        entryId: previousEntryId || undefined,
        sourceLanguage,
        targetLanguage,
        message: nextMessage,
      });
    } finally {
      if (processingAbortControllerRef.current === processingController) {
        processingAbortControllerRef.current = null;
      }
      if (interactionSessionRef.current === interactionSessionId) {
        setSourceEditBusy(false);
      }
    }
  }, [
    abortTtsRequests,
    addHistoryEntry,
    apiBaseUrl,
    clearCachedTts,
    currentExchangeEntryId,
    currentExchangeRetranslatable,
    bearerToken,
    refreshBearerToken,
    replaceHistoryEntryExchange,
    sourceEditDraft,
    sourceLanguage,
    speakTranslation,
    status,
    stopTtsPlayer,
    targetLanguage,
    ui.accountIssue,
    ui.correctionExpired,
    ui.emptyEditSource,
    ui.processingBusy,
    ui.translationEmpty,
  ]);

  useEffect(() => {
    logPocket("screen_mount", {
      sourceLanguage,
      targetLanguage,
      hasToken: Boolean((bearerToken || "").trim()),
    });
    return () => {
      logPocket("screen_unmount", {
        sourceLanguage,
        targetLanguage,
      });
    };
    // Intentionally once per screen lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      interactionSessionRef.current += 1;
      speechSessionRef.current += 1;
      ttsPlaybackSessionRef.current += 1;
      abortProcessingRequests();
      abortTtsRequests();
      clearPendingStopTimeout();
      const mediaSessionId = beginMediaSession();
      void stopPocketMedia({ stopRecorder: true, mediaSessionId });
    };
  }, [
    abortProcessingRequests,
    abortTtsRequests,
    beginMediaSession,
    clearPendingStopTimeout,
    stopPocketMedia,
  ]);

  const resolveFreshRecordingUri = useCallback(async () => {
    const baseline = recordingBaselineUriRef.current.trim();
    const deadline = Date.now() + 1800;
    let fallback = "";

    while (Date.now() < deadline) {
      const candidates = [recorder.uri || "", recorderState.url || "", recorderUrlRef.current || ""]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      for (const candidate of candidates) {
        if (!fallback) fallback = candidate;
        if (!baseline || candidate !== baseline) {
          return candidate;
        }
      }
      await wait(80);
    }

    return fallback;
  }, [recorder.uri, recorderState.url]);

  const stabilizeRecordedAudioUri = useCallback(async (rawUri: string, minBytes: number) => {
    let stableUri = rawUri;
    const cacheDir = FileSystemLegacy.cacheDirectory;
    let copiedToCache = false;

    if (cacheDir) {
      const extension = buildSegmentExtension(rawUri);
      const nextUri =
        `${cacheDir}pocket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.` +
        `${extension || "m4a"}`;
      try {
        await FileSystemLegacy.copyAsync({ from: rawUri, to: nextUri });
        stableUri = nextUri;
        copiedToCache = true;
      } catch {
        stableUri = rawUri;
      }
    }

    let currentSize = await getAudioFileSize(stableUri);
    if (copiedToCache && currentSize >= minBytes) {
      return { uri: stableUri, size: currentSize };
    }

    const deadline = Date.now() + 1500;
    let lastSize = -1;
    let stableRounds = 0;

    while (Date.now() < deadline) {
      currentSize = await getAudioFileSize(stableUri);
      if (currentSize >= minBytes && currentSize === lastSize) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
      }
      lastSize = currentSize;
      await wait(80);
    }

    return { uri: stableUri, size: currentSize };
  }, []);

  const ensureRecorderPrepared = useCallback(
    async ({
      promptForPermission,
      mediaSessionId,
    }: {
      promptForPermission: boolean;
      mediaSessionId: number;
    }) => {
      const isWarmupSessionActive = () =>
        mediaSessionRef.current === mediaSessionId && appStateRef.current === "active";
      if (!isWarmupSessionActive()) return false;
      if (recorderState.isRecording) return true;
      if (recorderPreparedRef.current) return true;
      if (
        recorderWarmupPromiseRef.current &&
        recorderWarmupSessionRef.current === mediaSessionId
      ) {
        return recorderWarmupPromiseRef.current;
      }

      const warmupTask = (async () => {
        const permission = promptForPermission
          ? await requestRecordingPermissionsAsync()
          : await getRecordingPermissionsAsync();
        if (!isWarmupSessionActive()) {
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        if (!permission.granted) {
          recorderPreparedRef.current = false;
          throw new Error("Microphone permission denied.");
        }

        await setIsAudioActiveAsync(true).catch(() => {});
        if (!isWarmupSessionActive()) {
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        await setRecordingAudioMode();
        if (!isWarmupSessionActive()) {
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        recordingBaselineUriRef.current = (recorder.uri || recorderUrlRef.current || "").trim();
        try {
          await recorder.stop();
        } catch {}
        if (!isWarmupSessionActive()) {
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        await wait(Platform.OS === "ios" ? 220 : 120);
        if (!isWarmupSessionActive()) {
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        await recorder.prepareToRecordAsync(recorderPreset);
        if (!isWarmupSessionActive()) {
          try {
            await recorder.stop();
          } catch {}
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        await wait(Platform.OS === "ios" ? 60 : 40);
        if (!isWarmupSessionActive()) {
          try {
            await recorder.stop();
          } catch {}
          await releasePocketAudioSession(mediaSessionId);
          return false;
        }
        recorderPreparedRef.current = true;
        return true;
      })().finally(() => {
        if (recorderWarmupSessionRef.current === mediaSessionId) {
          recorderWarmupPromiseRef.current = null;
          recorderWarmupSessionRef.current = 0;
        }
      });

      recorderWarmupSessionRef.current = mediaSessionId;
      recorderWarmupPromiseRef.current = warmupTask;
      return warmupTask;
    },
    [
      recorder,
      recorderPreset,
      recorderState.isRecording,
      releasePocketAudioSession,
      setRecordingAudioMode,
    ]
  );

  const startRecording = useCallback(async () => {
    if (tokenLoading || creditsLoading) {
      setError(ui.accessPending);
      return;
    }
    if (!hasBearerToken || effectiveCreditsError || !credits) {
      setError(effectiveCreditsError ? ui.creditsError(effectiveCreditsError) : ui.accountIssue);
      return;
    }
    if (translationLocked) {
      logPocket("record_start_blocked", {
        reason: "credits_locked",
        sourceLanguage,
        targetLanguage,
      });
      setError(ui.creditsLocked);
      return;
    }
    if (startInFlightRef.current || recorderState.isRecording || status === "processing") return;

    const recordStartRequestedAt = Date.now();
    const mediaSessionId = beginMediaSession();
    speechSessionRef.current += 1;
    interactionSessionRef.current += 1;
    const interactionSessionId = interactionSessionRef.current;
    const isStartSessionActive = () =>
      interactionSessionRef.current === interactionSessionId &&
      mediaSessionRef.current === mediaSessionId &&
      appStateRef.current === "active";
    clearPendingStopTimeout();
    abortTtsRequests();
    void Speech.stop();
    stopTtsPlayer();
    startInFlightRef.current = true;
    pendingStopAfterStartRef.current = false;
    setError("");
    setStatus("recording");
    triggerHaptic("start");
    logPocket("record_start_request", {
      sourceLanguage,
      targetLanguage,
    });

    try {
      const usedWarmRecorder = recorderPreparedRef.current;
      const prepared = await ensureRecorderPrepared({ promptForPermission: true, mediaSessionId });
      if (!prepared || !isStartSessionActive()) {
        await stopPocketMedia({ stopRecorder: true, mediaSessionId });
        setStatus("idle");
        return;
      }
      recordingStartedAtRef.current = 0;
      await recorder.record();
      if (!isStartSessionActive()) {
        await stopPocketMedia({ stopRecorder: true, mediaSessionId });
        setStatus("idle");
        return;
      }
      recorderPreparedRef.current = false;
      recordingStartedAtRef.current = Date.now();
      setFaceModeVisible(false);
      setHistoryModalVisible(false);
      setSourceEditModalVisible(false);
      setSourceEditDraft("");
      setSourceEditBusy(false);
      setSourceEditError("");
      setCurrentExchangeEntryId(null);
      setCurrentExchangeRetranslatable(false);
      setSourceText("");
      setTranslatedText("");
      setStatus("recording");
      logPocket("record_start_ok", {
        sourceLanguage,
        targetLanguage,
        startLatencyMs: recordingStartedAtRef.current - recordStartRequestedAt,
        usedWarmRecorder,
      });
    } catch (nextError) {
      recorderPreparedRef.current = false;
      await stopPocketMedia({ stopRecorder: true, mediaSessionId });
      setStatus("idle");
      triggerHaptic("error");
      setError(toFriendlyAudioError(nextError, language));
      logPocket("record_start_failed", {
        sourceLanguage,
        targetLanguage,
        message:
          nextError instanceof Error ? nextError.message.trim() : String(nextError || "").trim(),
      });
    } finally {
      startInFlightRef.current = false;
      if (pendingStopAfterStartRef.current) {
        logPocket("record_stop_queued_after_start", {
          sourceLanguage,
          targetLanguage,
        });
        pendingStopAfterStartRef.current = false;
        pendingStopTimeoutRef.current = setTimeout(() => {
          pendingStopTimeoutRef.current = null;
          void stopRecordingRef.current?.();
        }, 40);
      }
    }
  }, [
    beginMediaSession,
    clearPendingStopTimeout,
    abortTtsRequests,
    credits,
    creditsLoading,
    effectiveCreditsError,
    ensureRecorderPrepared,
    hasBearerToken,
    language,
    recorder,
    recorderState.isRecording,
    sourceLanguage,
    status,
    stopPocketMedia,
    stopTtsPlayer,
    tokenLoading,
    targetLanguage,
    triggerHaptic,
    translationLocked,
    ui,
  ]);

  const stopRecording = useCallback(async () => {
    if (status === "processing") return;
    if (startInFlightRef.current) {
      logPocket("record_stop_deferred", {
        sourceLanguage,
        targetLanguage,
      });
      pendingStopAfterStartRef.current = true;
      return;
    }
    if (!recorderState.isRecording && status !== "recording") return;

    const stopRequestedAt = Date.now();
    setError("");
    triggerHaptic("stop");
    logPocket("record_stop_request", {
      sourceLanguage,
      targetLanguage,
    });
    let tempAudioUri = "";
    const interactionSessionId = interactionSessionRef.current + 1;
    interactionSessionRef.current = interactionSessionId;
    const mediaSessionId = beginMediaSession();
    const isInteractionCurrent = () => interactionSessionRef.current === interactionSessionId;
    abortProcessingRequests();
    const processingController =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    processingAbortControllerRef.current = processingController;
    try {
      clearPendingStopTimeout();
      const elapsedBeforeStop =
        recordingStartedAtRef.current > 0 ? Date.now() - recordingStartedAtRef.current : 0;
      if (elapsedBeforeStop > 0 && elapsedBeforeStop < MIN_RECORDING_MS) {
        const waitMs = MIN_RECORDING_MS - elapsedBeforeStop;
        logPocket("record_stop_min_hold_wait", {
          sourceLanguage,
          targetLanguage,
          waitMs,
        });
        await wait(waitMs);
      }
      setStatus("processing");
      const recorderStopStartedAt = Date.now();
      await recorder.stop();
      if (!isInteractionCurrent()) return;
      const recorderStopMs = Date.now() - recorderStopStartedAt;
      const postStopSettleMs = Platform.OS === "ios" ? 80 : 80;
      await wait(postStopSettleMs);
      const resolveUriStartedAt = Date.now();
      const uri = await resolveFreshRecordingUri();
      if (!isInteractionCurrent()) return;
      const resolveUriMs = Date.now() - resolveUriStartedAt;
      if (!uri) {
        throw new Error(language === "fr" ? "Audio invalide." : "Invalid audio.");
      }

      const durationMs = Math.max(
        recorderState.durationMillis || 0,
        recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0
      );
      if (durationMs < MIN_RECORDING_MS) {
        throw new Error(ui.keepSpeaking);
      }

      const stabilizeStartedAt = Date.now();
      const stable = await stabilizeRecordedAudioUri(uri, MIN_AUDIO_BYTES);
      if (!isInteractionCurrent()) return;
      const stabilizeMs = Date.now() - stabilizeStartedAt;
      tempAudioUri = stable.uri !== uri ? stable.uri : "";
      if (stable.size < MIN_AUDIO_BYTES) {
        throw new Error(ui.keepSpeaking);
      }
      const usageSeconds = Math.max(1, Math.min(300, Math.floor(durationMs / 1000) || 1));
      logPocket("record_segment_ready", {
        sourceLanguage,
        targetLanguage,
        durationMs,
        usageSeconds,
        recorderStopMs,
        resolveUriMs,
        stabilizeMs,
        audioBytes: stable.size,
        copiedToCache: stable.uri !== uri,
      });

      const activeBearerToken = (bearerToken || "").trim() || (await refreshBearerToken()).trim();
      if (!isInteractionCurrent()) return;
      if (!activeBearerToken) {
        throw new Error(ui.accountIssue);
      }

      const targetLocale =
        LANGUAGE_OPTIONS.find((item) => item.code === targetLanguage)?.speechLocale || "en-US";
      const aiTtsInstructions = buildAiTtsInstructions({
        languageCode: targetLanguage,
        languageLabel: LANGUAGE_PROMPT_NAMES[targetLanguage] || targetLanguage,
      });
      const unifiedRequestId = `pocket-${interactionSessionId}-${Date.now()}`;
      logPocket("pocket_process_request", {
        requestId: unifiedRequestId,
        sourceLanguage,
        targetLanguage,
        usageSeconds,
      });

      try {
        const unifiedStartedAt = Date.now();
        const unifiedResult = await processPocketAudio({
          apiBaseUrl,
          bearerToken: activeBearerToken,
          audioUri: stable.uri,
          sourceLanguage,
          targetLanguage,
          fromLanguage: LANGUAGE_PROMPT_NAMES[sourceLanguage],
          toLanguage: LANGUAGE_PROMPT_NAMES[targetLanguage],
          usageSeconds,
          voice: AI_TTS_DEFAULT_VOICE,
          format:
            Platform.OS === "ios"
              ? IOS_AI_TTS_FORMAT_PREFERENCE[0] || DEFAULT_AI_TTS_FORMAT
              : DEFAULT_AI_TTS_FORMAT,
          locale: targetLocale,
          instructions: aiTtsInstructions,
          requestId: unifiedRequestId,
          clientMetrics: {
            recordingMs: durationMs,
            recorderStopMs,
            postStopSettleMs,
            resolveUriMs,
            stabilizeMs,
            preUploadMs: Date.now() - stopRequestedAt,
          },
          signal: processingController?.signal,
        });
        if (!isInteractionCurrent()) return;

        setOptimisticRemainingSeconds(
          typeof unifiedResult.totalSecondsRemaining === "number" &&
            Number.isFinite(unifiedResult.totalSecondsRemaining)
            ? Math.max(0, Math.floor(unifiedResult.totalSecondsRemaining))
            : 0
        );
        refetchCredits();

        if (!unifiedResult.ok) {
          setTranslatedText("");
          setStatus("idle");
          setError(unifiedResult.lockReason || ui.creditsLocked);
          return;
        }

        const draft = unifiedResult.sourceText.trim();
        const cleanTranslation = unifiedResult.translatedText.trim();
        if (!draft) {
          throw new Error("No speech detected.");
        }
        if (!cleanTranslation) {
          throw new Error(ui.translationEmpty);
        }

        logPocket("pocket_process_ok", {
          requestId: unifiedRequestId,
          sourceLanguage,
          targetLanguage,
          sourceChars: draft.length,
          translatedChars: cleanTranslation.length,
          serverTotalMs: unifiedResult.metrics.totalMs,
          serverTranscribeMs: unifiedResult.metrics.transcribeMs,
          serverTranslateMs: unifiedResult.metrics.translateMs,
          serverConsumeMs: unifiedResult.metrics.consumeMs,
          serverConsumeTxMs: unifiedResult.metrics.consumeTransactionMs,
          serverConsumeReadMs: unifiedResult.metrics.consumeReadMs,
          serverConsumePlanMs: unifiedResult.metrics.consumePlanMs,
          serverConsumeAttempts: unifiedResult.metrics.consumeAttempts,
          serverConsumeMode: unifiedResult.metrics.consumeMode,
          serverConsumeWriteMode: unifiedResult.metrics.consumeWriteMode,
          serverGrantMs: unifiedResult.metrics.grantMs,
          serverTtsMs: unifiedResult.metrics.ttsMs,
          serverAudioBase64Ms: unifiedResult.metrics.audioBase64Ms,
          clientFetchMs: unifiedResult.metrics.clientFetchMs,
          clientJsonMs: unifiedResult.metrics.clientJsonMs,
          clientTransportMs: unifiedResult.metrics.clientTransportMs,
          responseContentLength: unifiedResult.metrics.responseContentLength,
          vercelId: unifiedResult.metrics.vercelId,
          totalSinceReleaseMs: Date.now() - stopRequestedAt,
          requestMs: Date.now() - unifiedStartedAt,
        });

        setSourceText(draft);
        setTranslatedText(cleanTranslation);
        const nextEntryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        let tempTtsUri = "";
        if (unifiedResult.ttsAvailable && unifiedResult.ttsBase64) {
          const tempTtsWriteStartedAt = Date.now();
          tempTtsUri = await writeBase64TtsToTempFile(
            unifiedResult.ttsBase64,
            unifiedResult.ttsFormat
          );
          logPocket("pocket_process_audio_ready", {
            requestId: unifiedRequestId,
            format: unifiedResult.ttsFormat,
            audioBytes: unifiedResult.metrics.audioBytes,
            fileWriteMs: Date.now() - tempTtsWriteStartedAt,
          });
        } else {
          logPocket("pocket_process_tts_deferred", {
            requestId: unifiedRequestId,
            reason: unifiedResult.ttsError || "tts_unavailable",
          });
        }

        const nextEntry: PocketHistoryItem = {
          id: nextEntryId,
          createdAt: Date.now(),
          sourceText: draft,
          translatedText: cleanTranslation,
          sourceLanguage,
          targetLanguage,
          favorite: false,
          sourceAudioUri: null,
          audioUri: null,
        };
        addHistoryEntry(nextEntry);
        setCurrentExchangeEntryId(nextEntry.id);
        setCurrentExchangeRetranslatable(true);
        setSourceEditModalVisible(false);
        setSourceEditDraft("");
        setSourceEditBusy(false);
        setSourceEditError("");
        logPocket("history_add", {
          entryId: nextEntry.id,
          sourceLanguage,
          targetLanguage,
          translatedChars: cleanTranslation.length,
        });

        if (tempTtsUri) {
          updateCachedTts({
            text: cleanTranslation,
            language: targetLanguage,
            uri: tempTtsUri,
          });
        }

        if (appStateRef.current === "active") {
          void speakTranslation(cleanTranslation, targetLanguage, {
            bearerToken: activeBearerToken,
            historyEntryId: nextEntry.id,
          });
        } else {
          setStatus("idle");
          await releasePocketAudioSession(mediaSessionId);
        }

        if (tempTtsUri) {
          void persistHistoryAudioUri(tempTtsUri, nextEntryId, "translation")
            .then((persistedAudioUri) => {
              if (!persistedAudioUri) return;
              updateHistoryEntryAudio(nextEntryId, persistedAudioUri);
              logPocket("history_audio_persisted", {
                entryId: nextEntryId,
                format: unifiedResult.ttsFormat,
              });
            })
            .catch(() => {});
        }

        const persistedSourceAudioUri = await persistHistoryAudioUri(stable.uri, nextEntryId, "source").catch(() => null);
        if (persistedSourceAudioUri) {
          updateHistoryEntrySourceAudio(nextEntryId, persistedSourceAudioUri);
          logPocket("history_source_audio_persisted", {
            entryId: nextEntryId,
            sourceLanguage,
            targetLanguage,
          });
        }
        return;
      } catch (pocketProcessError) {
        if (!isPocketProcessFallbackError(pocketProcessError)) {
          throw pocketProcessError;
        }
        logPocket("pocket_process_fallback", {
          requestId: unifiedRequestId,
          sourceLanguage,
          targetLanguage,
          reason:
            pocketProcessError instanceof Error
              ? pocketProcessError.message.trim()
              : String(pocketProcessError || "").trim(),
        });
      }

      const preflightStartedAt = Date.now();
      const preflightResult = await consumeTranslationSeconds({
        apiBaseUrl,
        bearerToken: activeBearerToken,
        seconds: usageSeconds,
        origin: "local-pocket-preflight",
        preview: true,
        signal: processingController?.signal,
      });
      if (!isInteractionCurrent()) return;
      logPocket("credits_preflight", {
        usageSeconds,
        ok: preflightResult.ok,
        enabled: preflightResult.enabled,
        lockReason: preflightResult.lockReason || undefined,
        remainingSeconds: preflightResult.totalSecondsRemaining,
        preflightMs: Date.now() - preflightStartedAt,
      });
      setOptimisticRemainingSeconds(
        typeof preflightResult.totalSecondsRemaining === "number" &&
          Number.isFinite(preflightResult.totalSecondsRemaining)
          ? Math.max(0, Math.floor(preflightResult.totalSecondsRemaining))
          : 0
      );
      if (!preflightResult.ok || !preflightResult.enabled) {
        refetchCredits();
        setTranslatedText("");
        setStatus("idle");
        setError(preflightResult.lockReason || ui.creditsLocked);
        return;
      }

      const transcribeStartedAt = Date.now();
      const transcript = await transcribeAudio({
        apiBaseUrl,
        bearerToken: activeBearerToken,
        audioUri: stable.uri,
        language: sourceLanguage,
        pocketFlow: true,
        signal: processingController?.signal,
      });
      if (!isInteractionCurrent()) return;
      const draft = transcript.trim();
      if (!draft) {
        throw new Error("No speech detected.");
      }
      logPocket("transcribe_ok", {
        sourceLanguage,
        targetLanguage,
        textChars: draft.length,
        transcribeMs: Date.now() - transcribeStartedAt,
        totalSinceReleaseMs: Date.now() - stopRequestedAt,
      });

      setSourceText(draft);
      const consumeStartedAt = Date.now();
      const consumeResult = await consumeTranslationSeconds({
        apiBaseUrl,
        bearerToken: activeBearerToken,
        seconds: usageSeconds,
        origin: "local-pocket",
        signal: processingController?.signal,
      });
      if (!isInteractionCurrent()) return;
      logPocket("credits_consume", {
        usageSeconds,
        ok: consumeResult.ok,
        enabled: consumeResult.enabled,
        isAdmin: consumeResult.isAdmin,
        isPremium: consumeResult.isPremium,
        lockReason: consumeResult.lockReason || undefined,
        remainingSeconds: consumeResult.totalSecondsRemaining,
        consumeMs: Date.now() - consumeStartedAt,
      });
      setOptimisticRemainingSeconds(
        typeof consumeResult.totalSecondsRemaining === "number" &&
          Number.isFinite(consumeResult.totalSecondsRemaining)
          ? Math.max(0, Math.floor(consumeResult.totalSecondsRemaining))
          : 0
      );
      refetchCredits();

      if (!consumeResult.ok || !consumeResult.enabled) {
        setTranslatedText("");
        setStatus("idle");
        setError(consumeResult.lockReason || ui.creditsLocked);
        return;
      }

      const translateStartedAt = Date.now();
      const translated = await translateText({
        apiBaseUrl,
        bearerToken: activeBearerToken,
        text: draft,
        fromLanguage: LANGUAGE_PROMPT_NAMES[sourceLanguage],
        toLanguage: LANGUAGE_PROMPT_NAMES[targetLanguage],
        pocketFlow: true,
        signal: processingController?.signal,
      });
      if (!isInteractionCurrent()) return;
      const cleanTranslation = translated.trim();
      if (!cleanTranslation) {
        throw new Error(ui.translationEmpty);
      }
      logPocket("translate_ok", {
        sourceLanguage,
        targetLanguage,
        sourceChars: draft.length,
        translatedChars: cleanTranslation.length,
        translateMs: Date.now() - translateStartedAt,
        totalSinceReleaseMs: Date.now() - stopRequestedAt,
      });

      setTranslatedText(cleanTranslation);
      const nextEntryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nextEntry: PocketHistoryItem = {
        id: nextEntryId,
        createdAt: Date.now(),
        sourceText: draft,
        translatedText: cleanTranslation,
        sourceLanguage,
        targetLanguage,
        favorite: false,
        sourceAudioUri: null,
        audioUri: null,
      };
      addHistoryEntry(nextEntry);
      setCurrentExchangeEntryId(nextEntry.id);
      setCurrentExchangeRetranslatable(true);
      setSourceEditModalVisible(false);
      setSourceEditDraft("");
      setSourceEditBusy(false);
      setSourceEditError("");
      logPocket("history_add", {
        entryId: nextEntry.id,
        sourceLanguage,
        targetLanguage,
        translatedChars: cleanTranslation.length,
      });

      if (appStateRef.current === "active") {
        void speakTranslation(cleanTranslation, targetLanguage, {
          bearerToken: activeBearerToken,
          historyEntryId: nextEntry.id,
        });
      } else {
        setStatus("idle");
        await releasePocketAudioSession(mediaSessionId);
      }
      const persistedSourceAudioUriFallback = await persistHistoryAudioUri(stable.uri, nextEntryId, "source").catch(() => null);
      if (persistedSourceAudioUriFallback) {
        updateHistoryEntrySourceAudio(nextEntryId, persistedSourceAudioUriFallback);
        logPocket("history_source_audio_persisted", {
          entryId: nextEntryId,
          sourceLanguage,
          targetLanguage,
        });
      }
    } catch (nextError) {
      if (isTranslationAbortError(nextError)) {
        if (isInteractionCurrent()) {
          setStatus("idle");
        }
        return;
      }
      if (isInteractionCurrent()) {
        setStatus("idle");
        if (appStateRef.current === "active") {
          triggerHaptic("error");
          setError(toFriendlyAudioError(nextError, language));
        }
      }
      logPocket("record_stop_failed", {
        sourceLanguage,
        targetLanguage,
        message:
          nextError instanceof Error ? nextError.message.trim() : String(nextError || "").trim(),
      });
      if (/no speech detected/i.test(nextError instanceof Error ? nextError.message : String(nextError))) {
        setSourceText("");
        setTranslatedText("");
      }
    } finally {
      if (processingAbortControllerRef.current === processingController) {
        processingAbortControllerRef.current = null;
      }
      recorderPreparedRef.current = false;
      recordingStartedAtRef.current = 0;
      await releasePocketAudioSession(mediaSessionId);
      if (tempAudioUri) {
        void FileSystemLegacy.deleteAsync(tempAudioUri, { idempotent: true }).catch(() => {});
      }
    }
  }, [
    apiBaseUrl,
    addHistoryEntry,
    abortProcessingRequests,
    beginMediaSession,
    clearPendingStopTimeout,
    bearerToken,
    language,
    recorder,
    recorderState.durationMillis,
    recorderState.isRecording,
    persistHistoryAudioUri,
    refetchCredits,
    refreshBearerToken,
    releasePocketAudioSession,
    resolveFreshRecordingUri,
    sourceLanguage,
    speakTranslation,
    stabilizeRecordedAudioUri,
    status,
    targetLanguage,
    triggerHaptic,
    updateCachedTts,
    updateHistoryEntryAudio,
    updateHistoryEntrySourceAudio,
    ui.accountIssue,
    ui.creditsLocked,
    ui.keepSpeaking,
    ui.translationEmpty,
    writeBase64TtsToTempFile,
  ]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const applySourceLanguage = useCallback(
    (nextLanguage: LanguageCode) => {
      if (languageControlsDisabled) return;
      const previousSource = sourceLanguage;
      logPocket("source_language_change", {
        fromLanguage: sourceLanguage,
        toLanguage: nextLanguage,
        targetLanguage,
      });
      setSourceLanguage(nextLanguage);
      if (nextLanguage === targetLanguage) {
        setTargetLanguage(previousSource);
      }
      resetCurrentExchange();
    },
    [languageControlsDisabled, resetCurrentExchange, sourceLanguage, targetLanguage]
  );

  const applyTargetLanguage = useCallback(
    (nextLanguage: LanguageCode) => {
      if (languageControlsDisabled) return;
      const previousTarget = targetLanguage;
      logPocket("target_language_change", {
        fromLanguage: targetLanguage,
        toLanguage: nextLanguage,
        sourceLanguage,
      });
      setTargetLanguage(nextLanguage);
      if (nextLanguage === sourceLanguage) {
        setSourceLanguage(previousTarget);
      }
      resetCurrentExchange();
    },
    [languageControlsDisabled, resetCurrentExchange, sourceLanguage, targetLanguage]
  );

  const swapLanguages = useCallback(() => {
    if (languageControlsDisabled) return;
    logPocket("languages_swapped", {
      sourceLanguage,
      targetLanguage,
    });
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    resetCurrentExchange();
  }, [languageControlsDisabled, resetCurrentExchange, sourceLanguage, targetLanguage]);

  const canRecord = canUsePocket && !translationLocked && status !== "processing";
  const currentTranslationCanReplay = Boolean(translatedText.trim());
  const languagesSummaryLabel = useMemo(
    () => ui.languagesSummary(sourceLanguageLabel, targetLanguageLabel),
    [sourceLanguageLabel, targetLanguageLabel, ui]
  );
  const accessNoticeMessage = useMemo(() => {
    if (effectiveCreditsError) return ui.creditsIssue;
    if (!tokenLoading && !bearerToken) return ui.accountIssue;
    return "";
  }, [bearerToken, effectiveCreditsError, tokenLoading, ui]);
  const runtimeNoticeMessage = useMemo(() => {
    const message = error.trim();
    if (!message) return "";
    if (message === accessNoticeMessage) return "";
    return message;
  }, [accessNoticeMessage, error]);

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.brandRow}>
            <Image source={MOBILE_BRAND_ICON} style={styles.brandLogo} resizeMode="cover" alt="" />
            <View style={styles.heroTextBlock}>
              <Text style={styles.brand}>BFZoom</Text>
              <Text style={styles.brandHint}>{ui.brandSignature}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.title}>{ui.title}</Text>
        <Text style={styles.subtitle}>{ui.subtitle}</Text>
        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>{creditsLoading ? ui.creditsLoading : creditsRemainingLabel}</Text>
          <Text style={styles.statusBannerSubtext}>{ui.sharedMinutes}</Text>
        </View>
        {translationLocked ? (
          <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={onOpenDashboard}>
            <Text style={styles.actionButtonText}>{ui.buyCredits}</Text>
          </Pressable>
        ) : null}
        {accessNoticeMessage ? (
          <View style={[styles.noticeCard, styles.noticeCardWarm]}>
            <Text style={styles.noticeText}>{accessNoticeMessage}</Text>
          </View>
        ) : null}
        {showAccessRetry ? (
          <Pressable
            disabled={tokenLoading || creditsLoading}
            style={[styles.actionButton, styles.retryButton]}
            onPress={() => {
              void retryPocketAccess();
            }}
          >
            <Text style={styles.actionButtonText}>{ui.retryAccess}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setLanguagesPanelOpen((current) => !current)}
        >
          <View style={styles.accordionHeaderText}>
            <Text style={styles.sectionTitle}>{ui.languagesTitle}</Text>
            <Text style={styles.sectionMeta}>{languagesSummaryLabel}</Text>
          </View>
          <Text style={styles.accordionToggle}>{languagesPanelOpen ? "−" : "+"}</Text>
        </Pressable>
        {languagesPanelOpen ? (
          <View style={styles.languagesPanel}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionMeta}>{languagesSummaryLabel}</Text>
              <Pressable
                disabled={languageControlsDisabled}
                style={[styles.swapButton, languageControlsDisabled && styles.controlDisabled]}
                onPress={swapLanguages}
              >
                <Text style={styles.swapButtonText}>{ui.swap}</Text>
              </Pressable>
            </View>
            {languageControlsDisabled ? (
              <Text style={styles.busyHint}>{ui.languagesBusy}</Text>
            ) : null}

            <Text style={styles.selectorLabel}>
              {ui.sourceLanguage}: {sourceLanguageLabel}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = option.code === sourceLanguage;
                return (
                  <Pressable
                    key={`source-${option.code}`}
                    disabled={languageControlsDisabled}
                    style={[
                      styles.chip,
                      selected && styles.chipActive,
                      languageControlsDisabled && styles.controlDisabled,
                    ]}
                    onPress={() => applySourceLanguage(option.code)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {getLanguageUiLabel(option.code, language)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.selectorLabel}>
              {ui.targetLanguage}: {targetLanguageLabel}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = option.code === targetLanguage;
                return (
                  <Pressable
                    key={`target-${option.code}`}
                    disabled={languageControlsDisabled}
                    style={[
                      styles.chip,
                      selected && styles.chipActive,
                      languageControlsDisabled && styles.controlDisabled,
                    ]}
                    onPress={() => applyTargetLanguage(option.code)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {getLanguageUiLabel(option.code, language)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <View style={styles.talkieCard}>
        <View style={styles.statusPillsRow}>
          <View
            style={[
              styles.statusPill,
              status === "idle" && styles.statusPillIdle,
              status === "recording" && styles.statusPillRecording,
              status === "processing" && styles.statusPillProcessing,
              status === "speaking" && styles.statusPillSpeaking,
            ]}
          >
            <Text style={styles.statusPillText}>{statusLabel}</Text>
          </View>
          {currentTranslationCanReplay ? (
            <Pressable style={styles.faceModeButton} onPress={() => setFaceModeVisible(true)}>
              <Text style={styles.faceModeButtonText}>{ui.faceMode}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        <Text style={styles.statusHint}>
          {status === "recording" ? ui.releaseHint : ui.sharedMinutes}
        </Text>
        <Pressable
          disabled={!canRecord}
          onPressIn={() => {
            void startRecording();
          }}
          onPressOut={() => {
            void stopRecording();
          }}
          style={[
            styles.talkieButton,
            status === "recording" && styles.talkieButtonRecording,
            !canRecord && styles.talkieButtonDisabled,
          ]}
        >
          {status === "processing" ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.talkieButtonText}>
              {translationLocked ? ui.holdToTalkLocked : ui.holdToTalk}
            </Text>
          )}
        </Pressable>
        {runtimeNoticeMessage ? (
          <View style={[styles.noticeCard, styles.noticeCardWarm]}>
            <Text style={styles.noticeText}>{runtimeNoticeMessage}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{ui.sourceCard}</Text>
          {currentExchangeCanEdit ? (
            <Pressable style={styles.replayButton} onPress={openSourceEditModal}>
              <Text style={styles.replayButtonText}>{ui.editSource}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text
          style={[
            styles.exchangeText,
            RTL_LANGUAGE_CODES.has(sourceLanguage) && styles.rtlText,
          ]}
        >
          {sourceText || "…"}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{ui.translationCard}</Text>
          <View style={styles.translationActions}>
            {currentTranslationCanReplay ? (
              <>
                <Pressable
                  style={styles.replayButton}
                  onPress={() => {
                    speakTranslation(translatedText, targetLanguage);
                  }}
                >
                  <Text style={styles.replayButtonText}>{ui.replay}</Text>
                </Pressable>
                <Pressable
                  style={styles.replayButton}
                  onPress={() => {
                    speakTranslation(translatedText, targetLanguage, {
                      slow: true,
                    });
                  }}
                >
                  <Text style={styles.replayButtonText}>{ui.replaySlow}</Text>
                </Pressable>
                {currentExchangeCanFavorite ? (
                  <Pressable
                    style={[
                      styles.replayButton,
                      currentExchangeFavorite && styles.replayButtonActive,
                    ]}
                    onPress={() => toggleHistoryFavorite((currentExchangeEntryId || "").trim())}
                  >
                    <Text
                      style={[
                        styles.replayButtonText,
                        currentExchangeFavorite && styles.replayButtonTextActive,
                      ]}
                    >
                      {currentExchangeFavorite ? ui.unfavorite : ui.favorite}
                    </Text>
                  </Pressable>
                ) : null}
                {currentExchangeCanDelete ? (
                  <Pressable
                    style={[styles.replayButton, styles.replayButtonDanger]}
                    onPress={removeCurrentExchange}
                  >
                    <Text style={[styles.replayButtonText, styles.replayButtonTextDanger]}>
                      {ui.delete}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
        <Text
          style={[
            styles.translationText,
            RTL_LANGUAGE_CODES.has(targetLanguage) && styles.rtlText,
          ]}
        >
          {translatedText || "…"}
        </Text>
      </View>

      <View style={styles.card}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setFavoritesPanelOpen((current) => !current)}
        >
          <View style={styles.accordionHeaderText}>
            <Text style={styles.sectionTitle}>{ui.favoritePhrases}</Text>
            <Text style={styles.sectionMeta}>
              {favoriteHistoryCount > 0 ? ui.favoritesSummary(favoriteHistoryCount) : ui.noFavorites}
            </Text>
          </View>
          <Text style={styles.accordionToggle}>{favoritesPanelOpen ? "−" : "+"}</Text>
        </Pressable>
        {favoritesPanelOpen ? (
          <View style={styles.accordionBody}>
            {favoriteHistoryCount > 0 ? (
              <View style={styles.sectionActions}>
                <Pressable
                  style={[
                    styles.replayButton,
                    favoritesPlaybackActive && styles.replayButtonActive,
                  ]}
                  onPress={() => {
                    if (favoritesPlaybackActive) {
                      stopFavoritesPlayback();
                      return;
                    }
                    void playFavoritePlaylist();
                  }}
                >
                  <Text
                    style={[
                      styles.replayButtonText,
                      favoritesPlaybackActive && styles.replayButtonTextActive,
                    ]}
                  >
                    {favoritesPlaybackActive ? ui.stopFavorites : ui.listenFavorites}
                  </Text>
                </Pressable>
                <Pressable style={styles.replayButton} onPress={openFavoriteHistoryModal}>
                  <Text style={styles.replayButtonText}>{ui.viewAll}</Text>
                </Pressable>
              </View>
            ) : null}
            {previewFavoriteHistory.length === 0 ? (
              <Text style={styles.summaryText}>{ui.noFavorites}</Text>
            ) : (
              previewFavoriteHistory.map((entry) => (
                <View
                  key={entry.id}
                  style={[
                    styles.historyRow,
                    favoritesPlaybackEntryId === entry.id && favoritesPlaybackActive && styles.historyRowActive,
                  ]}
                >
                  <Text style={styles.historyMeta}>
                    {getLanguageUiLabel(entry.sourceLanguage, language)} →{" "}
                    {getLanguageUiLabel(entry.targetLanguage, language)}
                  </Text>
                  <Text
                    style={[
                      styles.historySource,
                      RTL_LANGUAGE_CODES.has(entry.sourceLanguage) && styles.rtlText,
                    ]}
                  >
                    {entry.sourceText}
                  </Text>
                  <Text
                    style={[
                      styles.historyTarget,
                      RTL_LANGUAGE_CODES.has(entry.targetLanguage) && styles.rtlText,
                    ]}
                  >
                    {entry.translatedText}
                  </Text>
                  {favoritesPlaybackEntryId === entry.id && favoritesPlaybackActive ? (
                    <Text style={styles.historyNowPlaying}>{ui.favoritesPlayingNow}</Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setRecentHistoryOpen((current) => !current)}
        >
          <View style={styles.accordionHeaderText}>
            <Text style={styles.sectionTitle}>{ui.recentPhrases}</Text>
            <Text style={styles.sectionMeta}>
              {history.length > 0 ? ui.recentSummary(history.length) : ui.noHistory}
            </Text>
          </View>
          <Text style={styles.accordionToggle}>{recentHistoryOpen ? "−" : "+"}</Text>
        </Pressable>
        {recentHistoryOpen ? (
          <>
            {history.length > 0 ? (
              <View style={styles.inlineActionRow}>
                <Pressable style={styles.replayButton} onPress={openRecentHistoryModal}>
                  <Text style={styles.replayButtonText}>{ui.viewAll}</Text>
                </Pressable>
              </View>
            ) : null}
            {previewHistory.length === 0 ? <Text style={styles.summaryText}>{ui.noHistory}</Text> : null}
            {previewHistory.map((entry) => (
              <View key={entry.id} style={styles.historyRow}>
                <Text style={styles.historyMeta}>
                  {getLanguageUiLabel(entry.sourceLanguage, language)} →{" "}
                  {getLanguageUiLabel(entry.targetLanguage, language)}
                </Text>
                <Text
                  style={[
                    styles.historySource,
                    RTL_LANGUAGE_CODES.has(entry.sourceLanguage) && styles.rtlText,
                  ]}
                >
                  {entry.sourceText}
                </Text>
                <Text
                  style={[
                    styles.historyTarget,
                    RTL_LANGUAGE_CODES.has(entry.targetLanguage) && styles.rtlText,
                  ]}
                >
                  {entry.translatedText}
                </Text>
                <Text style={styles.historyAvailability}>
                  {entry.audioUri || entry.sourceAudioUri ? ui.offlineAudioReady : ui.offlineTextOnly}
                </Text>
              </View>
            ))}
          </>
        ) : null}
      </View>

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={sourceEditModalVisible}
        onRequestClose={closeSourceEditModal}
      >
        <View style={styles.faceModeRoot}>
          <View style={styles.faceModeHeader}>
            <View style={styles.faceModeHeaderText}>
              <Text style={styles.faceModeTitle}>{ui.editSourceTitle}</Text>
              <Text style={styles.faceModeHint}>{ui.editSourceHint}</Text>
            </View>
            <Pressable
              disabled={sourceEditBusy}
              style={[styles.faceModeCloseButton, sourceEditBusy && styles.controlDisabled]}
              onPress={closeSourceEditModal}
            >
              <Text style={styles.faceModeCloseButtonText}>{ui.cancel}</Text>
            </Pressable>
          </View>
          <View style={styles.editorModalBody}>
            <Text style={styles.historyMeta}>
              {sourceLanguageLabel} → {targetLanguageLabel}
            </Text>
            <TextInput
              multiline
              autoFocus
              value={sourceEditDraft}
              onChangeText={(nextValue) => {
                setSourceEditDraft(nextValue);
                if (sourceEditError) {
                  setSourceEditError("");
                }
              }}
              editable={!sourceEditBusy}
              placeholder={ui.editSourcePlaceholder}
              placeholderTextColor="#64748b"
              style={[
                styles.editorInput,
                RTL_LANGUAGE_CODES.has(sourceLanguage) && styles.rtlText,
              ]}
            />
            {sourceEditError ? <Text style={styles.errorText}>{sourceEditError}</Text> : null}
          </View>
          <View style={styles.editorActionsRow}>
            <Pressable
              disabled={sourceEditBusy}
              style={[
                styles.actionButton,
                styles.editorSecondaryAction,
                sourceEditBusy && styles.controlDisabled,
              ]}
              onPress={closeSourceEditModal}
            >
              <Text style={styles.faceModeSecondaryActionText}>{ui.cancel}</Text>
            </Pressable>
            <Pressable
              disabled={sourceEditBusy}
              style={[
                styles.actionButton,
                styles.actionPrimary,
                styles.editorPrimaryAction,
                sourceEditBusy && styles.controlDisabled,
              ]}
              onPress={() => {
                void retranslateEditedSource();
              }}
            >
              {sourceEditBusy ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.actionButtonText}>{ui.retranslate}</Text>
              )}
            </Pressable>
          </View>
          {sourceEditBusy ? <Text style={styles.editorBusyText}>{ui.retranslateBusy}</Text> : null}
        </View>
      </Modal>

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={faceModeVisible}
        onRequestClose={() => setFaceModeVisible(false)}
      >
        <View style={styles.faceModeRoot}>
          <View style={styles.faceModeHeader}>
            <View style={styles.faceModeHeaderText}>
              <Text style={styles.faceModeTitle}>{ui.faceModeTitle}</Text>
              <Text style={styles.faceModeHint}>{ui.faceModeHint}</Text>
            </View>
            <Pressable style={styles.faceModeCloseButton} onPress={() => setFaceModeVisible(false)}>
              <Text style={styles.faceModeCloseButtonText}>{ui.closeFaceMode}</Text>
            </Pressable>
          </View>
          <View style={styles.faceModeBody}>
            <Text style={styles.faceModeLanguageMeta}>
              {sourceLanguageLabel} → {targetLanguageLabel}
            </Text>
            <Text
              style={[
                styles.faceModeTranslationText,
                RTL_LANGUAGE_CODES.has(targetLanguage) && styles.rtlText,
              ]}
            >
              {translatedText || "…"}
            </Text>
          </View>
          <View style={styles.faceModeFooter}>
            <Pressable
              style={[styles.actionButton, styles.actionPrimary, styles.faceModeAction]}
              onPress={() => {
                speakTranslation(translatedText, targetLanguage);
              }}
            >
              <Text style={styles.actionButtonText}>{ui.replay}</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.faceModeSecondaryAction]}
              onPress={() => {
                speakTranslation(translatedText, targetLanguage, {
                  slow: true,
                });
              }}
            >
              <Text style={styles.faceModeSecondaryActionText}>{ui.replaySlow}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={historyModalVisible}
        onRequestClose={closeHistoryModal}
      >
        <View style={styles.faceModeRoot}>
          <View style={styles.faceModeHeader}>
            <View style={styles.faceModeHeaderText}>
              <Text style={styles.faceModeTitle}>{ui.recentPhrases}</Text>
              <Text style={styles.faceModeHint}>{ui.historyHint}</Text>
            </View>
            <Pressable style={styles.faceModeCloseButton} onPress={closeHistoryModal}>
              <Text style={styles.faceModeCloseButtonText}>{ui.closeFaceMode}</Text>
            </Pressable>
          </View>

          <View style={styles.historyFilterRow}>
            <Pressable
              style={[
                styles.filterChip,
                !historyFavoritesOnly && styles.filterChipActive,
              ]}
              onPress={() => {
                stopFavoritesPlayback({ bumpInteraction: false });
                setHistoryFavoritesOnly(false);
              }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  !historyFavoritesOnly && styles.filterChipTextActive,
                ]}
              >
                {ui.showAll}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.filterChip,
                historyFavoritesOnly && styles.filterChipActive,
              ]}
              onPress={() => {
                stopFavoritesPlayback({ bumpInteraction: false });
                setHistoryFavoritesOnly(true);
              }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  historyFavoritesOnly && styles.filterChipTextActive,
                ]}
              >
                {ui.favoritesOnly}
              </Text>
            </Pressable>
          </View>
          {historyFavoritesOnly && favoriteHistoryCount > 0 ? (
            <View style={styles.favoritesPlaybackBar}>
              <View style={styles.favoritesPlaybackTextBlock}>
                <Text style={styles.favoritesPlaybackTitle}>
                  {favoritesPlaybackActive && favoritesPlaybackIndex
                    ? ui.favoritesPlaybackProgress(favoritesPlaybackIndex, favoritesPlaybackTotal)
                    : ui.listenFavorites}
                </Text>
                <Text style={styles.favoritesPlaybackHint}>{ui.favoritesPlaybackHint}</Text>
              </View>
              <Pressable
                style={[
                  styles.historyActionButton,
                  favoritesPlaybackActive && styles.historyActionButtonActive,
                ]}
                onPress={() => {
                  if (favoritesPlaybackActive) {
                    stopFavoritesPlayback();
                    return;
                  }
                  void playFavoritePlaylist();
                }}
              >
                <Text style={styles.historyActionButtonText}>
                  {favoritesPlaybackActive ? ui.stopFavorites : ui.listenFavorites}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={styles.historyModalList} showsVerticalScrollIndicator={false}>
            {visibleHistory.length === 0 ? (
              <Text style={styles.summaryText}>{ui.noHistory}</Text>
            ) : null}
            {visibleHistory.map((entry) => (
              <View
                key={entry.id}
                style={[
                  styles.historyModalRow,
                  favoritesPlaybackEntryId === entry.id && styles.historyModalRowActive,
                ]}
              >
                <Text style={styles.historyMeta}>
                  {getLanguageUiLabel(entry.sourceLanguage, language)} →{" "}
                  {getLanguageUiLabel(entry.targetLanguage, language)}
                </Text>
                <Text
                  style={[
                    styles.historySource,
                    RTL_LANGUAGE_CODES.has(entry.sourceLanguage) && styles.rtlText,
                  ]}
                >
                  {entry.sourceText}
                </Text>
                <Text
                  style={[
                    styles.historyTarget,
                    RTL_LANGUAGE_CODES.has(entry.targetLanguage) && styles.rtlText,
                  ]}
                >
                  {entry.translatedText}
                </Text>
                <Text style={styles.historyAvailability}>
                  {entry.audioUri || entry.sourceAudioUri ? ui.offlineAudioReady : ui.offlineTextOnly}
                </Text>
                {favoritesPlaybackEntryId === entry.id && favoritesPlaybackActive ? (
                  <Text style={styles.historyNowPlaying}>{ui.favoritesPlayingNow}</Text>
                ) : null}
                <View style={styles.historyActionsWrap}>
                  <Pressable
                    style={styles.historyActionButton}
                    onPress={() => applyHistoryEntry(entry)}
                  >
                    <Text style={styles.historyActionButtonText}>{ui.usePhrase}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.historyActionButton}
                    onPress={() => {
                      stopFavoritesPlayback({ bumpInteraction: false });
                      void replayHistoryEntry(entry);
                    }}
                  >
                    <Text style={styles.historyActionButtonText}>{ui.replay}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.historyActionButton}
                    onPress={() => {
                      stopFavoritesPlayback({ bumpInteraction: false });
                      void replayHistoryEntry(entry, { slow: true });
                    }}
                  >
                    <Text style={styles.historyActionButtonText}>{ui.replaySlow}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.historyActionButton}
                    onPress={() => toggleHistoryFavorite(entry.id)}
                  >
                    <Text style={styles.historyActionButtonText}>
                      {entry.favorite ? ui.unfavorite : ui.favorite}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.historyActionButton, styles.historyActionButtonDanger]}
                    onPress={() => removeHistoryEntry(entry.id)}
                  >
                    <Text style={styles.historyActionButtonText}>{ui.delete}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 108,
    gap: 12,
    backgroundColor: "#020617",
  },
  heroCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 18,
    backgroundColor: "#0b1220",
    padding: 16,
    gap: 10,
  },
  heroHeader: {
    alignItems: "flex-start",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  brand: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  brandHint: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  heroTextBlock: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: "#e2e8f0",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  statusBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e3a8a",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  statusBannerText: {
    color: "#bfdbfe",
    fontSize: 13,
    fontWeight: "800",
  },
  statusBannerSubtext: {
    color: "#94a3b8",
    fontSize: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 18,
    backgroundColor: "#0b1220",
    padding: 16,
    gap: 10,
  },
  talkieCard: {
    borderWidth: 1,
    borderColor: "#164e63",
    borderRadius: 18,
    backgroundColor: "#082f49",
    padding: 18,
    gap: 10,
    alignItems: "center",
  },
  statusPillsRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  statusPill: {
    flexShrink: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#0f172a",
  },
  statusPillIdle: {
    borderColor: "#1e40af",
  },
  statusPillRecording: {
    borderColor: "#ef4444",
    backgroundColor: "#3f0d12",
  },
  statusPillProcessing: {
    borderColor: "#d97706",
    backgroundColor: "#3b2406",
  },
  statusPillSpeaking: {
    borderColor: "#14b8a6",
    backgroundColor: "#082f2c",
  },
  statusPillText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "800",
  },
  faceModeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#22d3ee",
    backgroundColor: "rgba(6, 95, 70, 0.22)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  faceModeButtonText: {
    color: "#cffafe",
    fontSize: 12,
    fontWeight: "800",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  accordionHeaderText: {
    flex: 1,
    gap: 4,
  },
  accordionBody: {
    gap: 12,
    paddingTop: 12,
  },
  sectionTitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "800",
  },
  sectionMeta: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  accordionToggle: {
    color: "#94a3b8",
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 22,
  },
  languagesPanel: {
    gap: 12,
    paddingTop: 12,
  },
  selectorLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  busyHint: {
    color: "#fcd34d",
    fontSize: 12,
    lineHeight: 17,
  },
  chipsRow: {
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  chipText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
  },
  chipTextActive: {
    color: "#f8fafc",
  },
  controlDisabled: {
    opacity: 0.5,
  },
  swapButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  swapButtonText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  statusLabel: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
  },
  statusHint: {
    color: "#bae6fd",
    fontSize: 12,
    textAlign: "center",
  },
  talkieButton: {
    minWidth: 260,
    borderRadius: 999,
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 22,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  talkieButtonRecording: {
    backgroundColor: "#ef4444",
  },
  talkieButtonDisabled: {
    backgroundColor: "#334155",
  },
  talkieButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  exchangeText: {
    color: "#e2e8f0",
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "600",
  },
  translationText: {
    color: "#f8fafc",
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
  },
  translationActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
    flexShrink: 1,
  },
  sectionActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
  },
  inlineActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 12,
  },
  replayButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1e40af",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  replayButtonActive: {
    borderColor: "#67e8f9",
    backgroundColor: "#0f766e",
  },
  replayButtonDanger: {
    borderColor: "#ef4444",
    backgroundColor: "#1f1114",
  },
  replayButtonText: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "700",
  },
  replayButtonTextActive: {
    color: "#ecfeff",
  },
  replayButtonTextDanger: {
    color: "#fecaca",
  },
  faceModeRoot: {
    flex: 1,
    backgroundColor: "#020617",
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  faceModeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  faceModeHeaderText: {
    flex: 1,
    gap: 6,
  },
  faceModeTitle: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "900",
  },
  faceModeHint: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  faceModeCloseButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  faceModeCloseButtonText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  faceModeBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  faceModeLanguageMeta: {
    color: "#93c5fd",
    fontSize: 15,
    fontWeight: "800",
  },
  faceModeTranslationText: {
    color: "#ffffff",
    fontSize: 42,
    lineHeight: 54,
    fontWeight: "900",
    textAlign: "center",
  },
  faceModeFooter: {
    gap: 10,
  },
  editorModalBody: {
    flex: 1,
    gap: 12,
    paddingTop: 18,
  },
  editorInput: {
    minHeight: 180,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#f8fafc",
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "600",
    textAlignVertical: "top",
  },
  editorActionsRow: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  editorPrimaryAction: {
    flex: 1,
    minHeight: 52,
  },
  editorSecondaryAction: {
    flex: 1,
    minHeight: 52,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
  },
  editorBusyText: {
    color: "#93c5fd",
    fontSize: 12,
    textAlign: "center",
    paddingTop: 8,
  },
  faceModeAction: {
    minHeight: 52,
  },
  faceModeSecondaryAction: {
    minHeight: 52,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
  },
  faceModeSecondaryActionText: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "800",
  },
  summaryText: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  historyRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0f172a",
    padding: 12,
    gap: 6,
  },
  historyRowActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  historyMeta: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  historySource: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  historyTarget: {
    color: "#f8fafc",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  historyAvailability: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 17,
  },
  historyFilterRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  filterChipText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#e0f2fe",
  },
  historyModalList: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 12,
  },
  favoritesPlaybackBar: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#164e63",
    backgroundColor: "#082f49",
    padding: 12,
    gap: 10,
  },
  favoritesPlaybackTextBlock: {
    gap: 4,
  },
  favoritesPlaybackTitle: {
    color: "#e0f2fe",
    fontSize: 13,
    fontWeight: "800",
  },
  favoritesPlaybackHint: {
    color: "#bae6fd",
    fontSize: 12,
    lineHeight: 17,
  },
  historyModalRow: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0b1220",
    padding: 14,
    gap: 8,
  },
  historyModalRowActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  historyActionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  historyActionButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  historyActionButtonActive: {
    borderColor: "#67e8f9",
    backgroundColor: "#0f766e",
  },
  historyActionButtonDanger: {
    borderColor: "#7f1d1d",
    backgroundColor: "#450a0a",
  },
  historyActionButtonText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  historyNowPlaying: {
    color: "#67e8f9",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimary: {
    backgroundColor: "#0ea5e9",
  },
  retryButton: {
    backgroundColor: "#1d4ed8",
  },
  noticeCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeCardWarm: {
    borderColor: "#92400e",
    backgroundColor: "rgba(120, 53, 15, 0.28)",
  },
  noticeText: {
    color: "#fde68a",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 18,
  },
  rtlText: {
    writingDirection: "rtl",
    textAlign: "right",
  },
});
