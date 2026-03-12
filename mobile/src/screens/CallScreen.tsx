import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystemLegacy from "expo-file-system/legacy";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import * as Speech from "expo-speech";
import type { Voice } from "expo-speech";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { ConnectionQuality, RoomEvent, Track, type Participant } from "livekit-client";
import type { TrackReference } from "@livekit/components-core";
import { env } from "../config/env";
import {
  configureNativeVirtualBackground,
  createRealtimePcmBridge,
  isNativeRealtimePcmAvailable,
  type RealtimePcmBridge,
} from "../services/realtimePcm";
import { phoneticText, transcribeAudio, translateText } from "../services/translation";
import type { MobileCallSession } from "../types/session";

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English", speechLocale: "en-US" },
  { code: "fr", label: "Français", speechLocale: "fr-FR" },
  { code: "ar", label: "العربية", speechLocale: "ar-SA" },
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
  { code: "ja", label: "日本語", speechLocale: "ja-JP" },
  { code: "ru", label: "Русский", speechLocale: "ru-RU" },
  { code: "fa", label: "فارسی", speechLocale: "fa-IR" },
  { code: "la", label: "Latin", speechLocale: "la" },
];

const AUTO_VOICE_ID = "__auto_voice__";
const REALTIME_SEGMENT_MS = 1200;
const REALTIME_SEGMENT_GAP_MS = 60;
const REALTIME_MAX_QUEUE = 4;
const REALTIME_MIN_SEGMENT_BYTES = 1300;
const MANUAL_MIN_RECORDING_MS = 700;
const MANUAL_MIN_SEGMENT_BYTES = 1200;
const IOS_SKIP_ROOM_MIC_TOGGLE_DURING_TALKIE = true;
const REALTIME_NATIVE_SAMPLE_RATE = 24_000;
const REALTIME_NATIVE_CHUNK_MS = 80;
const REALTIME_WS_BACKLOG_LIMIT_BYTES = 512_000;
const REALTIME_WS_PROTOCOL = "realtime";
const IOS_RECORDER_START_RETRY_DELAYS_MS = [220, 380, 560, 760];
const REALTIME_TRANSLATION_ENABLED = false;
const CAPTIONS_ALWAYS_ON = true;
const VOICE_TRANSLATION_ENABLED = false;
const AI_TTS_ENABLED = true;
const AI_TTS_DEFAULT_VOICE = "nova";
const AI_TTS_MAX_CHARS = 650;
const IOS_REMOTE_AUDIO_VOLUME_NORMAL = 1;
const IOS_REMOTE_AUDIO_VOLUME_DUCKED_FOR_TTS = 0.62;
const TALKIE_LOCK_TOPIC = "bfzoom-ptt-lock";
const TALKIE_LOCK_TIMEOUT_MS = 10_000;
const TALKIE_LOCK_HEARTBEAT_MS = 2_500;
const CALL_PREFS_STORAGE_KEY_PREFIX = "bfzoom.call.prefs";
const REALTIME_VOICE_STORAGE_KEY_PREFIX = "bfzoom.voice.realtime";
const TTS_VOICE_STORAGE_KEY_PREFIX = "bfzoom.voice.tts";
const TRANSLATOR_IDENTITY_PREFIX = "bfzoom-translator-";
const TRANSLATION_ACCESS_TOPIC = "bfzoom-translation-access";
const TRANSLATION_UNLOCK_HINT =
  "Traduction indisponible: tes 3 minutes d'essai gratuit sont epuisees et tu n'as plus de credits actifs. La visio simple reste disponible.";
const TRANSLATION_WAIT_HOST_HINT =
  "Traduction en attente: l'hote doit disposer de minutes offertes ou de credits actifs.";
const VIRTUAL_BACKGROUND_EFFECT_NAME = "bfzoom_virtual_background";
const REALTIME_OUTPUT_VOICE_OPTIONS = [
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
] as const;

const STAGE_BACKGROUND_PRESETS = [
  { id: "none", label: "Aucun", mode: "none" as const, color: "#020617" },
  { id: "night", label: "Nuit", mode: "solid" as const, color: "#0b1220" },
  { id: "ocean", label: "Ocean", mode: "solid" as const, color: "#10324a" },
  { id: "forest", label: "Forêt", mode: "solid" as const, color: "#12342b" },
  { id: "sunset", label: "Sunset", mode: "solid" as const, color: "#4f2c1a" },
  { id: "ai", label: "DALL·E", mode: "ai" as const, color: "#020617" },
] as const;

type CoachPresetItem = {
  id: string;
  title: string;
  prompt: string;
  local: string;
};

type CoachPresetMode = {
  id: string;
  title: string;
  description: string;
  items: CoachPresetItem[];
};

const COACH_MODES: CoachPresetMode[] = [
  {
    id: "opening",
    title: "Ouverture & cadrage",
    description: "Demarrer la discussion avec clarte.",
    items: [
      {
        id: "opening-60",
        title: "Ouverture 60s",
        prompt: "Genere une ouverture de conversation en 60 secondes pour installer confiance, objectif et cadre.",
        local:
          "Ouverture 60s: salutation claire, contexte en 1 phrase, objectif de l'echange, proposition d'ordre du jour court.",
      },
      {
        id: "framing",
        title: "Cadrer le sujet",
        prompt: "Propose une structure de cadrage en 4 phrases pour eviter la confusion des enjeux.",
        local: "Cadrage: sujet exact, pourquoi maintenant, impact attendu, decision a prendre.",
      },
      {
        id: "agenda",
        title: "Agenda express",
        prompt: "Cree un mini agenda oral (3 points max) pour une reunion internationale.",
        local: "Agenda express: alignement objectif, points bloquants, decisions + prochaines actions.",
      },
    ],
  },
  {
    id: "listening",
    title: "Ecoute & reformulation",
    description: "Comprendre vite sans malentendu.",
    items: [
      {
        id: "active-listening",
        title: "Ecoute active",
        prompt: "Donne une methode d'ecoute active en 4 etapes utilisable en visio.",
        local: "Ecoute active: laisser finir, valider, reformuler, confirmer la suite.",
      },
      {
        id: "reformulate",
        title: "Reformulation",
        prompt: "Propose 5 formulations courtes pour verifier qu'on a bien compris.",
        local:
          "Si je comprends bien..., Vous attendez..., Le point critique est..., On valide que..., Je reformule pour confirmer...",
      },
      {
        id: "misunderstanding",
        title: "Eviter confusion",
        prompt: "Donne une checklist de communication pour eviter les incomprehensions en reunion multilingue.",
        local: "Phrase courte, une idee par phrase, termes cles verifies, action/responsable/delai confirmes.",
      },
    ],
  },
  {
    id: "questions",
    title: "Questions strategiques",
    description: "Questions utiles pour faire avancer.",
    items: [
      {
        id: "discovery",
        title: "Decouverte",
        prompt: "Genere 6 questions de decouverte pour comprendre le besoin reel d'un interlocuteur.",
        local: "Objectif prioritaire, blocage actuel, impact, delai, contraintes, critere de succes.",
      },
      {
        id: "clarification",
        title: "Clarification",
        prompt: "Donne des questions courtes pour clarifier une demande vague sans paraitre agressif.",
        local: "Quel resultat exact visez-vous ? A quel horizon ? Quel est le prioritaire ?",
      },
      {
        id: "decision",
        title: "Decision",
        prompt: "Propose des questions qui accelerent une prise de decision en fin de reunion.",
        local: "Option retenue ? Responsable ? Date ? Risque principal ? Action immediate ?",
      },
    ],
  },
  {
    id: "objections",
    title: "Objections & nego",
    description: "Reponses courtes orientees accord.",
    items: [
      {
        id: "price",
        title: "Objection prix",
        prompt: "Genere 4 reponses courtes et elegantes a une objection sur le prix.",
        local: "Valeur, cout d'inaction, etape pilote, question de validation.",
      },
      {
        id: "timing",
        title: "Objection timing",
        prompt: "Donne des formulations pour traiter 'ce n'est pas le bon moment'.",
        local: "Reconnaissance contrainte, petit pas concret, date de revue.",
      },
      {
        id: "close",
        title: "Clore un accord",
        prompt: "Genere une formulation de cloture d'accord avec recapitulatif et next steps.",
        local: "Resume accord, roles, delais, prochaine etape ecrite.",
      },
    ],
  },
  {
    id: "followup",
    title: "Cloture & suivi",
    description: "Terminer proprement et lancer la suite.",
    items: [
      {
        id: "close-meeting",
        title: "Cloture orale",
        prompt: "Genere une cloture orale de reunion en 5 lignes: synthese, decision, prochaine etape.",
        local: "Recap points valides, decision, responsable, date de suivi.",
      },
      {
        id: "followup-email",
        title: "Email de suivi",
        prompt: "Redige un email de suivi professionnel apres reunion, clair et concis.",
        local: "Merci, resume, actions par personne, echeances, prochain point.",
      },
      {
        id: "action-plan",
        title: "Plan d'action",
        prompt: "Transforme une conversation en plan d'action priorise (3 actions max).",
        local: "3 actions max, proprietaire, delai, critere de validation.",
      },
    ],
  },
] as const;

const COACH_TONES = ["professionnel", "neutre", "diplomatique", "direct"] as const;

type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]["code"];
type RealtimeVoiceId = (typeof REALTIME_OUTPUT_VOICE_OPTIONS)[number];
type StageBackgroundId = (typeof STAGE_BACKGROUND_PRESETS)[number]["id"];
type CameraFacingMode = "user" | "environment";
type AccordionPanelKey = "controls" | "translation";
type CoachModeId = (typeof COACH_MODES)[number]["id"];
type CoachTone = (typeof COACH_TONES)[number];
type TalkieUiState = "idle" | "starting" | "recording" | "stopping";
type CoachReplySuggestion = {
  id: string;
  targetText: string;
  sourceText: string;
  phoneticText: string;
};

type StoredCallPrefs = {
  sourceLanguage?: string;
  targetLanguage?: string;
  captionsEnabled?: boolean;
  ttsEnabled?: boolean;
  realtimeEnabled?: boolean;
};

const LANGUAGE_PROMPT_NAMES: Record<LanguageCode, string> = {
  en: "English",
  fr: "French",
  ar: "Arabic",
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
  ja: "Japanese",
  ru: "Russian",
  fa: "Persian",
  la: "Latin",
};
const RTL_LANGUAGE_CODES = new Set(["ar", "fa", "he"]);

type CaptionPayload = {
  id?: string;
  roomId?: string;
  from?: string;
  text?: string;
  sourceText?: string;
  sourceLang?: string;
  targetLang?: string;
  timestamp?: number;
  durationSeconds?: number;
};

type TranslationAccessPayload = {
  roomId?: string;
  enabled?: boolean;
  reason?: string;
  remainingSeconds?: number;
  from?: string;
  updatedAt?: number;
};

type TranslationEntitlementState = {
  enabled: boolean;
  lockReason: string;
  loading: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
  totalSecondsRemaining: number;
};

const DEFAULT_TRANSLATION_ENTITLEMENT: TranslationEntitlementState = {
  enabled: true,
  lockReason: "",
  loading: true,
  isAdmin: false,
  isPremium: false,
  freeSecondsRemaining: 180,
  paidSecondsRemaining: 0,
  totalSecondsRemaining: 180,
};

type TalkieLockPayload = {
  roomId?: string;
  holder?: string;
  holderName?: string;
  action?: "claim" | "release" | "heartbeat";
  expiresAt?: number;
  timestamp?: number;
};

type RealtimeSegment = {
  id: number;
  uri: string;
  capturedAt: number;
  sourceLang: LanguageCode;
};

type CallScreenProps = {
  session: MobileCallSession;
  onLeave: (reason?: string) => void;
};

const isLanguageCode = (value: string): value is LanguageCode =>
  LANGUAGE_OPTIONS.some((item) => item.code === value);

const isRealtimeVoiceId = (value: string): value is RealtimeVoiceId =>
  REALTIME_OUTPUT_VOICE_OPTIONS.some((voice) => voice === value);

const isTranslatorIdentity = (identity: string) =>
  identity.trim().toLowerCase().startsWith(TRANSLATOR_IDENTITY_PREFIX);

const normalizeTranslationEntitlement = (
  payload: unknown
): TranslationEntitlementState => {
  const raw = (payload || {}) as Record<string, unknown>;
  const freeSecondsRemaining =
    typeof raw.freeSecondsRemaining === "number" && Number.isFinite(raw.freeSecondsRemaining)
      ? Math.max(0, Math.floor(raw.freeSecondsRemaining))
      : 0;
  const paidSecondsRemaining =
    typeof raw.paidSecondsRemaining === "number" && Number.isFinite(raw.paidSecondsRemaining)
      ? Math.max(0, Math.floor(raw.paidSecondsRemaining))
      : 0;
  const totalSecondsRemaining =
    typeof raw.totalSecondsRemaining === "number" && Number.isFinite(raw.totalSecondsRemaining)
      ? Math.max(0, Math.floor(raw.totalSecondsRemaining))
      : freeSecondsRemaining + paidSecondsRemaining;
  const enabled =
    typeof raw.enabled === "boolean" ? raw.enabled : totalSecondsRemaining > 0;
  const lockReason = typeof raw.lockReason === "string" ? raw.lockReason.trim() : "";
  return {
    enabled,
    lockReason: enabled ? "" : lockReason || TRANSLATION_UNLOCK_HINT,
    loading: false,
    isAdmin: raw.isAdmin === true,
    isPremium: raw.isPremium === true,
    freeSecondsRemaining,
    paidSecondsRemaining,
    totalSecondsRemaining,
  };
};

const formatTranslationRemaining = (seconds?: number | null) => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
};

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

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

const toFriendlyAudioError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || "Audio error");
  if (/source language mismatch|script mismatch/i.test(raw)) {
    return "Je n'ai pas bien compris dans la langue choisie. Parle plus lentement ou verifie 'Langue que tu parles'.";
  }
  if (/no speech detected/i.test(raw)) {
    return "Aucune voix detectee. Maintiens 1-2 secondes, parle clairement, puis relache.";
  }
  if (
    /recording not allowed/i.test(raw) ||
    /osstatus error 5610/i.test(raw) ||
    /audio mode/i.test(raw)
  ) {
    return "Micro iOS indisponible temporairement. Coupe puis rallume 'Mic', puis reessaie dans 1-2 secondes.";
  }
  return raw;
};

const isRecoverableIosRecorderError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || "");
  return (
    /recording not allowed/i.test(raw) ||
    /osstatus error 5610/i.test(raw) ||
    /audio mode/i.test(raw) ||
    /session/i.test(raw) ||
    /avfoundation/i.test(raw) ||
    /cannot start/i.test(raw)
  );
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

const normalizeToken = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9']/g, "");

const isRtlLanguageCode = (code?: string) => {
  if (!code) return false;
  return RTL_LANGUAGE_CODES.has(code.toLowerCase());
};

const splitWords = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const parseCoachSuggestions = (value: string) => {
  const cleanRaw = value
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const extractSuggestionArray = (parsed: unknown): string[] => {
    if (!parsed) return [];
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 3);
    }
    if (typeof parsed !== "object") return [];

    const candidate = parsed as {
      suggestions?: unknown;
      data?: { suggestions?: unknown };
      result?: { suggestions?: unknown };
      output?: { suggestions?: unknown };
      choices?: { message?: { content?: string } }[];
    };

    const direct = [
      candidate.suggestions,
      candidate.data?.suggestions,
      candidate.result?.suggestions,
      candidate.output?.suggestions,
    ];
    for (const entry of direct) {
      if (Array.isArray(entry)) {
        const normalized = entry
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 3);
        if (normalized.length > 0) return normalized;
      }
    }

    const nestedContent = candidate.choices?.[0]?.message?.content;
    if (typeof nestedContent === "string" && nestedContent.trim()) {
      return parseCoachSuggestions(nestedContent);
    }

    return [];
  };

  const extractEmbeddedJson = (raw: string) => {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  };

  const parsedJson = (() => {
    try {
      return JSON.parse(cleanRaw) as unknown;
    } catch {
      return extractEmbeddedJson(cleanRaw);
    }
  })();
  const fromJson = extractSuggestionArray(parsedJson);
  if (fromJson.length > 0) return fromJson.slice(0, 3);

  return cleanRaw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(
      (line) =>
        Boolean(line) &&
        !/[{}\[\]"]/.test(line) &&
        !/^(id|object|created|model|usage|prompt_tokens|completion_tokens|total_tokens|message|role|choices?)\s*[:=]/i.test(
          line
        )
    )
    .slice(0, 3);
};

const normalizeNoiseGuardText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const LOW_SIGNAL_TOKENS = new Set(["you", "yeah", "yo", "yup", "ok", "okay", "uh", "huh"]);
const BAD_TRANSCRIPT_PATTERNS = [
  /subtitles created for the amara\.org community/i,
  /legends by the amara\.org community/i,
  /captions by the amara\.org community/i,
  /(?:subtitles|captions|legends)\s+(?:created|provided|by).*(?:amara\.?org)/i,
  /amara\s*\.?\s*org community/i,
  /subtitles (created|provided|by).+amara\.org community/i,
  /amara\.org community/i,
];
const LANGUAGE_SCRIPT_PATTERNS: Partial<Record<LanguageCode, RegExp>> = {
  ar: /[\u0600-\u06FF]/,
  fa: /[\u0600-\u06FF]/,
  he: /[\u0590-\u05FF]/,
  ru: /[\u0400-\u04FF]/,
  zh: /[\u3400-\u9FFF]/,
  ja: /[\u3040-\u30FF\u3400-\u9FFF]/,
  ko: /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/,
  th: /[\u0E00-\u0E7F]/,
  hi: /[\u0900-\u097F]/,
};

const isLikelyLowSignalTranscript = (text: string, sourceLang: LanguageCode) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (sourceLang === "en") return false;
  const words = splitWords(trimmed);
  if (words.length !== 1) return false;
  const token = normalizeToken(words[0] || "");
  if (!token) return true;
  return LOW_SIGNAL_TOKENS.has(token);
};

const isKnownBadTranscript = (text: string) => {
  const value = text.trim();
  if (!value) return true;
  const normalized = normalizeNoiseGuardText(value);
  const compact = normalized.replace(/\s+/g, "");
  if (compact.includes("amaraorg")) return true;
  return BAD_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(value));
};

const isLikelyScriptMismatchTranscript = (text: string, sourceLang?: LanguageCode) => {
  if (!sourceLang) return false;
  const scriptPattern = LANGUAGE_SCRIPT_PATTERNS[sourceLang];
  if (!scriptPattern) return false;
  const value = text.trim();
  if (!value) return false;
  if (scriptPattern.test(value)) return false;
  const words = splitWords(value);
  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(value);
  // For script-heavy languages (Arabic, Hebrew, CJK, etc.), a multi-word latin transcript is
  // usually a bad ASR interpretation when user selected that source language.
  return hasLatin || words.length >= 2;
};

const extractIncrementalSpeech = (previous: string, current: string) => {
  const previousWords = splitWords(previous);
  const currentWords = splitWords(current);
  if (!currentWords.length) return "";
  if (!previousWords.length) return current.trim();

  const previousNorm = previousWords.map(normalizeToken);
  const currentNorm = currentWords.map(normalizeToken);
  if (previousNorm.join(" ") === currentNorm.join(" ")) return "";

  const maxOverlap = Math.min(previousNorm.length, currentNorm.length, 12);
  for (let overlap = maxOverlap; overlap >= 2; overlap -= 1) {
    const previousTail = previousNorm.slice(-overlap).join(" ");
    const currentHead = currentNorm.slice(0, overlap).join(" ");
    if (previousTail && previousTail === currentHead) {
      return currentWords.slice(overlap).join(" ").trim();
    }
  }

  if (
    currentNorm.length <= previousNorm.length &&
    previousNorm.join(" ").includes(currentNorm.join(" "))
  ) {
    return "";
  }

  return current.trim();
};

const getVoicesForLanguage = (voices: Voice[], languageCode: LanguageCode, locale: string) => {
  const exactLocale = locale.toLowerCase();
  const prefix = languageCode.toLowerCase();
  return [...voices]
    .filter((voice) => {
      const lang = (voice.language || "").toLowerCase();
      return lang === exactLocale || lang.startsWith(`${prefix}-`) || lang === prefix;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export function CallScreen({ session, onLeave }: CallScreenProps) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [sessionError, setSessionError] = useState("");
  const [connected, setConnected] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const isChatCall = session.originModule === "chat";
  const isChatAudioCall = session.originModule === "chat" && (session.callMode || "video") === "audio";
  const isHostSession = session.role === "host";
  const roleModeLabel = isHostSession ? "Mode HOTE" : "Mode INVITE";
  const isCompactPhone = viewportWidth <= 430;
  const isVeryCompactPhone = viewportWidth <= 380 || viewportHeight <= 760;

  const roomShareWebUrl = useMemo(() => {
    const rawBase = session.apiBaseUrl.trim().replace(/\/+$/, "");
    if (!rawBase) {
      return `https://www.bfzoom.fr/join/${encodeURIComponent(session.roomId)}`;
    }
    const looksLocal =
      /(^https?:\/\/localhost)|(^https?:\/\/127\.)|(^https?:\/\/0\.0\.0\.0)/i.test(rawBase);
    const publicBase = looksLocal ? "https://www.bfzoom.fr" : rawBase;
    return `${publicBase}/join/${encodeURIComponent(session.roomId)}`;
  }, [session.apiBaseUrl, session.roomId]);

  const shareRoomAccess = useCallback(async () => {
    try {
      await Share.share({
        title: "Salle BFZoom",
        message: `Rejoins ma salle BFZoom en 1 clic : ${roomShareWebUrl}

Si l'app BFZoom est installée, elle s'ouvre automatiquement. Sinon, la version web s'ouvre.`,
        url: roomShareWebUrl,
      });
    } catch (err) {
      setSessionError(
        err instanceof Error ? err.message : "Impossible de partager le lien de salle."
      );
    }
  }, [roomShareWebUrl]);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        await AudioSession.startAudioSession();
        await AudioSession.setDefaultRemoteAudioTrackVolume(1).catch(() => {});
        await AudioSession.selectAudioOutput("force_speaker").catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setSessionError(err instanceof Error ? err.message : "Failed to start audio session.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      Speech.stop();
      void AudioSession.stopAudioSession();
    };
  }, []);

  return (
    <View style={styles.screen}>
      {!immersiveMode ? (
        <View style={[styles.topBar, isCompactPhone && styles.topBarCompact]}>
          <View>
            <Text style={[styles.topTitle, isCompactPhone && styles.topTitleCompact]}>
              {isChatCall ? ((session.callMode || "video") === "video" ? "Appel vidéo" : "Appel audio") : session.roomId}
            </Text>
            <Text style={[styles.topSubtitle, isCompactPhone && styles.topSubtitleCompact]}>
              {isChatCall
                ? `CHAT · ${((session.callMode || "video") === "video" ? "Visio" : "Audio")} · ${session.displayName}`
                : `${session.role.toUpperCase()} · ${session.displayName}`}
            </Text>
            <Text style={[styles.modeBadge, isCompactPhone && styles.modeBadgeCompact]}>
              {roleModeLabel}
            </Text>
          </View>
          <View style={[styles.topActions, isCompactPhone && styles.topActionsCompact]}>
            {!isChatCall && isHostSession ? (
              <Pressable onPress={shareRoomAccess} style={styles.shareButton}>
                <Text style={styles.shareText}>Partager</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => onLeave()} style={styles.leaveButton}>
              <Text style={styles.leaveText}>Quitter</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {!immersiveMode && sessionError ? <Text style={styles.error}>{sessionError}</Text> : null}

      <LiveKitRoom
        serverUrl={session.livekitUrl}
        token={session.livekitToken}
        connect
        audio
        video={!isChatAudioCall}
        onConnected={() => {
          setConnected(true);
          setSessionError("");
        }}
        onDisconnected={() => {
          setConnected(false);
        }}
        onError={(err) => {
          setSessionError(err.message || "LiveKit error");
        }}
        options={{
          adaptiveStream: { pixelDensity: "screen" },
          dynacast: true,
        }}
      >
        <RoomView
          session={session}
          connected={connected}
          immersiveMode={immersiveMode}
          setImmersiveMode={setImmersiveMode}
          isChatCall={isChatCall}
          isChatAudioCall={isChatAudioCall}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    </View>
  );
}

function RoomView({
  session,
  connected,
  immersiveMode,
  setImmersiveMode,
  isChatCall,
  isChatAudioCall,
  onLeave,
}: {
  session: MobileCallSession;
  connected: boolean;
  immersiveMode: boolean;
  setImmersiveMode: (next: boolean | ((value: boolean) => boolean)) => void;
  isChatCall: boolean;
  isChatAudioCall: boolean;
  onLeave: (reason?: string) => void;
}) {
  useKeepAwake();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isCompactPhone = viewportWidth <= 430;
  const isVeryCompactPhone = viewportWidth <= 380 || viewportHeight <= 760;
  const room = useRoomContext();
  const isCoachSession = session.originModule === "coach";
  const isHostSession = session.role === "host";
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const cameraTracks = useTracks([Track.Source.Camera]);
  const remoteAudioTracks = useTracks(
    [
      { source: Track.Source.ScreenShareAudio, withPlaceholder: false },
      { source: Track.Source.Microphone, withPlaceholder: false },
    ],
    {
      onlySubscribed: true,
    }
  );
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [focusedTrackKey, setFocusedTrackKey] = useState<string | null>(null);
  const [videoFullscreen, setVideoFullscreen] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [translationPanelOpen, setTranslationPanelOpen] = useState(false);
  const [showTranslationInfo, setShowTranslationInfo] = useState(false);
  const [followActiveSpeaker, setFollowActiveSpeaker] = useState(true);
  const [pinnedTrackKey, setPinnedTrackKey] = useState<string | null>(null);
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState("");
  const [connectionPhase, setConnectionPhase] = useState<
    "connected" | "reconnecting" | "signal"
  >("connected");
  const [localConnectionQuality, setLocalConnectionQuality] =
    useState<ConnectionQuality>(ConnectionQuality.Unknown);

  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [coachConversationEnabled, setCoachConversationEnabled] = useState(
    session.originModule === "coach"
  );
  const [coachPartnerLoading, setCoachPartnerLoading] = useState(false);
  const [coachPartnerError, setCoachPartnerError] = useState("");
  const [coachPartnerReply, setCoachPartnerReply] = useState("");
  const [coachPartnerReplyTranslation, setCoachPartnerReplyTranslation] = useState("");
  const [coachReplySuggestions, setCoachReplySuggestions] = useState<CoachReplySuggestion[]>([]);
  const [coachReplySuggestionsLoading, setCoachReplySuggestionsLoading] = useState(false);
  const [coachSuggestionSpeakingId, setCoachSuggestionSpeakingId] = useState("");
  const [coachPartnerSpeakActive, setCoachPartnerSpeakActive] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const appWasActiveRef = useRef(AppState.currentState === "active");
  const [coachModeId, setCoachModeId] = useState<CoachModeId>(COACH_MODES[0].id);
  const [coachPrompt, setCoachPrompt] = useState("");
  const [coachLocalText, setCoachLocalText] = useState("");
  const [coachResponse, setCoachResponse] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState("");
  const [coachUseAi, setCoachUseAi] = useState(false);
  const [coachOutputLanguage, setCoachOutputLanguage] = useState<LanguageCode>("fr");
  const [coachTone, setCoachTone] = useState<CoachTone>("professionnel");
  const [coachCultureEnabled, setCoachCultureEnabled] = useState(true);
  const [coachCultureRegion, setCoachCultureRegion] = useState("");
  const [translationEntitlement, setTranslationEntitlement] =
    useState<TranslationEntitlementState>(DEFAULT_TRANSLATION_ENTITLEMENT);
  const [roomTranslationEnabled, setRoomTranslationEnabled] = useState(true);
  const [roomTranslationReason, setRoomTranslationReason] = useState("");
  const [roomTranslationRemainingSeconds, setRoomTranslationRemainingSeconds] =
    useState<number | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [captionPhoneticText, setCaptionPhoneticText] = useState("");
  const [captionPhoneticBusy, setCaptionPhoneticBusy] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [manualDraftVisible, setManualDraftVisible] = useState(false);
  const [manualDraftText, setManualDraftText] = useState("");
  const [manualDraftDurationSeconds, setManualDraftDurationSeconds] = useState(1);
  const [manualDraftSourceLanguage, setManualDraftSourceLanguage] =
    useState<LanguageCode>("fr");
  const [manualDraftSending, setManualDraftSending] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>("en");
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>("fr");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(CAPTIONS_ALWAYS_ON);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"idle" | "running" | "error">("idle");
  const [realtimeEngine, setRealtimeEngine] = useState<"native" | "segmented">("segmented");
  const [forceSegmentedRealtime, setForceSegmentedRealtime] = useState(false);
  const [realtimeQueueDepth, setRealtimeQueueDepth] = useState(0);
  const [realtimeLatencyMs, setRealtimeLatencyMs] = useState<number | null>(null);
  const [talkieUiState, setTalkieUiState] = useState<TalkieUiState>("idle");
  const [recordingError, setRecordingError] = useState("");
  const [voiceLoadError, setVoiceLoadError] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [replayButtonActive, setReplayButtonActive] = useState(false);
  const [retranslateButtonActive, setRetranslateButtonActive] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState(AUTO_VOICE_ID);
  const [realtimeVoiceId, setRealtimeVoiceId] = useState<RealtimeVoiceId>("ash");
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>("user");
  const [backgroundMode, setBackgroundMode] = useState<StageBackgroundId>("none");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBackgroundUrl, setAiBackgroundUrl] = useState("");
  const [aiBackgroundBusy, setAiBackgroundBusy] = useState(false);
  const [aiBackgroundStatus, setAiBackgroundStatus] = useState("");
  const [backgroundError, setBackgroundError] = useState("");
  const [talkieLockHolderIdentity, setTalkieLockHolderIdentity] = useState("");
  const [talkieLockHolderName, setTalkieLockHolderName] = useState("");
  const [talkieLockExpiresAt, setTalkieLockExpiresAt] = useState(0);
  const ttsLockRef = useRef(false);
  const ttsPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const ttsPlayerMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsPlaybackWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsTempFileRef = useRef("");
  const ttsRequestSeqRef = useRef(0);
  const ttsPlaybackSessionRef = useRef(0);
  const ttsRemoteAudioDuckedRef = useRef(false);
  const translationConsumeInFlightRef = useRef(false);
  const sourceTextLanguageRef = useRef<LanguageCode>("fr");
  const incomingTranslationSeqRef = useRef(0);
  const captionPhoneticSeqRef = useRef(0);
  const realtimeLoopRef = useRef(false);
  const realtimeQueueRef = useRef<RealtimeSegment[]>([]);
  const realtimeSegmentIdRef = useRef(0);
  const lastTranscriptRef = useRef("");
  const realtimeBridgeRef = useRef<RealtimePcmBridge | null>(null);
  const realtimeWsRef = useRef<WebSocket | null>(null);
  const realtimeOutputBufferRef = useRef("");
  const realtimeInputTranscriptRef = useRef("");
  const realtimeLatestCaptureAtRef = useRef(0);
  const recorderUrlRef = useRef("");
  const micEnabledRef = useRef(isMicrophoneEnabled);
  const recorderMutedRoomMicRef = useRef(false);
  const callPrefsLoadedRef = useRef(false);
  const realtimeVoiceLoadedRef = useRef(false);
  const ttsVoiceLoadedKeyRef = useRef("");
  const cameraAutoStartedRef = useRef(false);
  const previousRemoteTrackCountRef = useRef(0);
  const autoMicEnsuredRef = useRef(false);
  const manualRecordingStartedAtRef = useRef(0);
  const manualPushToTalkPressedRef = useRef(false);
  const manualStartInFlightRef = useRef(false);
  const pendingStopAfterStartRef = useRef(false);
  const recordingStartUriRef = useRef("");
  const lastProcessedRecordingUriRef = useRef("");
  const stopTranslateInFlightRef = useRef(false);
  const talkieLockHolderRef = useRef("");
  const talkieLockExpiresAtRef = useRef(0);
  const talkieLockTimestampRef = useRef(0);
  const talkieLockExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkiePulseOpacityRef = useRef(new Animated.Value(1));
  const talkiePulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const replayButtonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retranslateButtonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachPartnerRequestSeqRef = useRef(0);
  const coachPartnerLastPromptRef = useRef("");
  const coachPartnerSpeakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderPreset = useMemo(() => {
    if (Platform.OS !== "ios") return RecordingPresets.HIGH_QUALITY;
    // iOS voice-chat sessions are more stable with mono capture for short talkie segments.
    return {
      ...RecordingPresets.HIGH_QUALITY,
      numberOfChannels: 1,
      sampleRate: 24_000,
      bitRate: 64_000,
    };
  }, []);
  const recorder = useAudioRecorder(recorderPreset);
  const recorderState = useAudioRecorderState(recorder, 200);
  const recordingActive = recorderState.isRecording;
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const nativeRealtimeConfigured = useMemo(
    () => isNativeRealtimePcmAvailable() && Boolean(env.realtimeUrl.trim()),
    []
  );
  const realtimeConfigured = useMemo(() => Boolean(env.realtimeUrl.trim()), []);
  const realtimeNativeEnabled = nativeRealtimeConfigured && !forceSegmentedRealtime;
  const voiceStorageIdentity = useMemo(
    () => encodeURIComponent(session.identity || session.displayName || "anonymous"),
    [session.displayName, session.identity]
  );
  const startWithCamera = (session.callMode || "video") !== "audio";
  const callPrefsStorageKey = useMemo(
    () => `${CALL_PREFS_STORAGE_KEY_PREFIX}:${voiceStorageIdentity}`,
    [voiceStorageIdentity]
  );
  const realtimeVoiceStorageKey = useMemo(
    () => `${REALTIME_VOICE_STORAGE_KEY_PREFIX}:${voiceStorageIdentity}`,
    [voiceStorageIdentity]
  );
  const ttsVoiceStorageKey = useMemo(
    () => `${TTS_VOICE_STORAGE_KEY_PREFIX}:${voiceStorageIdentity}:${targetLanguage}`,
    [targetLanguage, voiceStorageIdentity]
  );
  const publicApiBase = useMemo(() => {
    const raw = session.apiBaseUrl.trim().replace(/\/+$/, "");
    if (!raw) return "https://www.bfzoom.fr";
    const looksLocal =
      /(^https?:\/\/localhost)|(^https?:\/\/127\.)|(^https?:\/\/0\.0\.0\.0)/i.test(raw);
    return looksLocal ? "https://www.bfzoom.fr" : raw;
  }, [session.apiBaseUrl]);
  const selectedBackgroundPreset = useMemo(
    () => STAGE_BACKGROUND_PRESETS.find((item) => item.id === backgroundMode) || STAGE_BACKGROUND_PRESETS[0],
    [backgroundMode]
  );
  const currentCoachMode = useMemo(
    () => COACH_MODES.find((mode) => mode.id === coachModeId) || COACH_MODES[0],
    [coachModeId]
  );
  const coachOutputLanguageOption = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === coachOutputLanguage) || LANGUAGE_OPTIONS[0],
    [coachOutputLanguage]
  );
  const effectiveTranslationEnabled = isHostSession
    ? translationEntitlement.enabled
    : roomTranslationEnabled;
  const effectiveTranslationLockMessage = effectiveTranslationEnabled
    ? ""
    : isHostSession
      ? translationEntitlement.lockReason || TRANSLATION_UNLOCK_HINT
      : roomTranslationReason || TRANSLATION_WAIT_HOST_HINT;
  const effectiveTranslationRemainingSeconds = isHostSession
    ? translationEntitlement.totalSecondsRemaining
    : roomTranslationRemainingSeconds;
  const translationRemainingLabel = formatTranslationRemaining(
    effectiveTranslationRemainingSeconds
  );
  const translationControlsDisabled = !effectiveTranslationEnabled;

  const refreshTranslationEntitlement = useCallback(async () => {
    if (!isHostSession) {
      setTranslationEntitlement({
        ...DEFAULT_TRANSLATION_ENTITLEMENT,
        loading: false,
      });
      return;
    }
    const bearerToken = (session.bearerToken || "").trim();
    if (!bearerToken) {
      setTranslationEntitlement({
        ...DEFAULT_TRANSLATION_ENTITLEMENT,
        enabled: false,
        loading: false,
        lockReason: TRANSLATION_UNLOCK_HINT,
      });
      return;
    }
    setTranslationEntitlement((prev) => ({ ...prev, loading: true }));
    try {
      const response = await fetch(`${publicApiBase}/api/translation/entitlement`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setTranslationEntitlement((prev) => ({ ...prev, loading: false }));
        return;
      }
      setTranslationEntitlement(normalizeTranslationEntitlement(payload));
    } catch {
      setTranslationEntitlement((prev) => ({ ...prev, loading: false }));
    }
  }, [isHostSession, publicApiBase, session.bearerToken]);

  const consumeTranslationSeconds = useCallback(
    async (seconds: number, origin: "local" | "remote") => {
      if (!isHostSession) return true;
      const bearerToken = (session.bearerToken || "").trim();
      if (!bearerToken) return false;
      if (translationEntitlement.isAdmin || translationEntitlement.isPremium) return true;
      if (translationConsumeInFlightRef.current) return translationEntitlement.enabled;
      const safeSeconds = Math.max(1, Math.min(300, Math.floor(seconds || 1)));

      translationConsumeInFlightRef.current = true;
      try {
        const response = await fetch(`${publicApiBase}/api/translation/consume`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearerToken}`,
          },
          body: JSON.stringify({
            seconds: safeSeconds,
            origin,
            roomId: session.roomId,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        const hasEntitlementShape =
          payload &&
          typeof payload === "object" &&
          ("enabled" in (payload as Record<string, unknown>) ||
            "freeSecondsRemaining" in (payload as Record<string, unknown>));
        if (hasEntitlementShape) {
          setTranslationEntitlement(normalizeTranslationEntitlement(payload));
        }
        if (response.status === 402) return false;
        if (!response.ok) return true;
        return true;
      } catch {
        return true;
      } finally {
        translationConsumeInFlightRef.current = false;
      }
    },
    [
      isHostSession,
      publicApiBase,
      session.bearerToken,
      session.roomId,
      translationEntitlement.enabled,
      translationEntitlement.isAdmin,
      translationEntitlement.isPremium,
    ]
  );

  const handleCoachGenerate = useCallback(async () => {
    if (!coachPrompt.trim()) return;
    setCoachLoading(true);
    setCoachError("");
    try {
      if (!coachUseAi) {
        const fallback = coachLocalText.trim() || coachPrompt.trim();
        setCoachResponse(fallback || "Aucune reponse locale.");
        return;
      }

      const bearerToken = (session.bearerToken || "").trim();
      if (!bearerToken) {
        throw new Error("Mode IA indisponible en invite. Connecte-toi avec un compte hote.");
      }
      const culturalInstruction = coachCultureEnabled
        ? `Adapte le style, les formulations, la politesse et les usages professionnels a la langue ${coachOutputLanguageOption.label}${
            coachCultureRegion.trim() ? ` dans le contexte ${coachCultureRegion.trim()}` : ""
          }. Evite les stereotypes.`
        : "Utilise un style international neutre sans adaptation culturelle locale.";

      const response = await fetch(`${publicApiBase}/api/openai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          intent: "coach_ai",
          roomId: session.roomId,
          messages: [
            {
              role: "system",
              content:
                "Tu es un coach en communication professionnelle. Tu produis uniquement du contenu actionnable (scripts, questions, objections, formulations). " +
                "Tu ne corriges pas les echanges live de la visio. " +
                "Reponds en 6-8 lignes max, clair, concret et utilisable tout de suite. " +
                culturalInstruction,
            },
            {
              role: "user",
              content: `Mode: ${currentCoachMode.title}\nLangue de sortie: ${coachOutputLanguageOption.label}\nTon: ${coachTone}\nDemande: ${coachPrompt.trim()}\nReponse courte avec 3 astuces pratico-pratiques.`,
            },
          ],
        }),
      });

      const raw = await response.text();
      let payload: unknown = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        if (!response.ok) {
          throw new Error(raw || `Erreur IA (${response.status})`);
        }
      }

      if (!response.ok) {
        const message = (payload as { error?: string } | null)?.error || raw || `Erreur IA (${response.status})`;
        throw new Error(message);
      }
      const choice = (payload as { choices?: { message?: { content?: string }; finish_reason?: string }[] } | null)
        ?.choices?.[0];
      const text = (choice?.message?.content || "").trim();
      if (!text) {
        throw new Error("Aucune reponse IA.");
      }
      setCoachResponse(
        choice?.finish_reason === "length" ? `${text}\n\n[Reponse tronquee]` : text
      );
    } catch (error) {
      setCoachError(error instanceof Error ? error.message : "Erreur coach IA.");
    } finally {
      setCoachLoading(false);
    }
  }, [
    coachCultureEnabled,
    coachCultureRegion,
    coachLocalText,
    coachOutputLanguageOption,
    coachPrompt,
    coachTone,
    coachUseAi,
    currentCoachMode.title,
    publicApiBase,
    session.bearerToken,
    session.roomId,
  ]);

  const broadcastRoomTranslationAccess = useCallback(async () => {
    if (!isHostSession || !localParticipant) return;
    const payload: TranslationAccessPayload = {
      roomId: session.roomId,
      enabled: translationEntitlement.enabled,
      reason: translationEntitlement.lockReason || TRANSLATION_UNLOCK_HINT,
      remainingSeconds:
        typeof translationEntitlement.totalSecondsRemaining === "number" &&
        Number.isFinite(translationEntitlement.totalSecondsRemaining)
          ? Math.max(0, Math.floor(translationEntitlement.totalSecondsRemaining))
          : undefined,
      from: session.identity || "host",
      updatedAt: Date.now(),
    };
    try {
      await localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
        topic: TRANSLATION_ACCESS_TOPIC,
      });
    } catch {}
  }, [
    isHostSession,
    localParticipant,
    session.identity,
    session.roomId,
    translationEntitlement.enabled,
    translationEntitlement.lockReason,
    translationEntitlement.totalSecondsRemaining,
  ]);

  useEffect(() => {
    void refreshTranslationEntitlement();
  }, [refreshTranslationEntitlement]);

  useEffect(() => {
    if (!isHostSession) return;
    void broadcastRoomTranslationAccess();
  }, [broadcastRoomTranslationAccess, isHostSession, remoteParticipantCount]);

  useEffect(() => {
    if (!translationControlsDisabled) return;
    if (!realtimeEnabled) return;
    setRealtimeEnabled(false);
  }, [realtimeEnabled, translationControlsDisabled]);

  const isTalkieLockedByOther = useMemo(() => {
    if (!talkieLockHolderIdentity) return false;
    if (talkieLockExpiresAt <= Date.now()) return false;
    return talkieLockHolderIdentity !== session.identity;
  }, [session.identity, talkieLockExpiresAt, talkieLockHolderIdentity]);
  const talkieLooksRecording =
    talkieUiState === "recording" || recordingActive || manualRecordingStartedAtRef.current > 0;
  const talkieBusyVisual =
    translationBusy || talkieUiState === "starting" || talkieUiState === "stopping";
  const talkiePulseEnabled =
    talkieUiState === "recording" || talkieUiState === "stopping" || translationBusy;
  const talkieButtonLabel =
    talkieUiState === "starting"
      ? "Initialisation micro..."
      : talkieUiState === "stopping" || translationBusy
        ? "Traduction en cours..."
        : talkieLooksRecording
          ? "Parle..."
          : translationControlsDisabled
            ? "Traduction verrouillee"
            : isTalkieLockedByOther
              ? "Interlocuteur parle..."
              : "Presse ici pour parler";

  useEffect(() => {
    const animatedOpacity = talkiePulseOpacityRef.current;
    if (!talkiePulseEnabled) {
      talkiePulseAnimationRef.current?.stop();
      talkiePulseAnimationRef.current = null;
      animatedOpacity.setValue(1);
      return;
    }

    talkiePulseAnimationRef.current?.stop();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedOpacity, {
          toValue: 0.45,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(animatedOpacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ])
    );
    talkiePulseAnimationRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
      if (talkiePulseAnimationRef.current === loop) {
        talkiePulseAnimationRef.current = null;
      }
      animatedOpacity.setValue(1);
    };
  }, [talkiePulseEnabled]);

  const clearTalkieLock = useCallback(() => {
    talkieLockHolderRef.current = "";
    talkieLockExpiresAtRef.current = 0;
    setTalkieLockHolderIdentity("");
    setTalkieLockHolderName("");
    setTalkieLockExpiresAt(0);
    if (talkieLockExpiryTimerRef.current) {
      clearTimeout(talkieLockExpiryTimerRef.current);
      talkieLockExpiryTimerRef.current = null;
    }
  }, []);
  const armTalkieLockExpiry = useCallback((expiresAt: number) => {
    if (talkieLockExpiryTimerRef.current) {
      clearTimeout(talkieLockExpiryTimerRef.current);
      talkieLockExpiryTimerRef.current = null;
    }
    const delay = Math.max(0, expiresAt - Date.now());
    talkieLockExpiryTimerRef.current = setTimeout(() => {
      if (talkieLockExpiresAtRef.current > Date.now()) return;
      clearTalkieLock();
    }, delay + 40);
  }, [clearTalkieLock]);
  const applyTalkieLockPayload = useCallback(
    (payload: TalkieLockPayload) => {
      if (payload.roomId && payload.roomId !== session.roomId) return;
      const nextTimestamp =
        typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
      if (nextTimestamp < talkieLockTimestampRef.current) return;
      talkieLockTimestampRef.current = nextTimestamp;

      const holder = (payload.holder || "").trim();
      const action = payload.action || "claim";
      if (action === "release") {
        if (!holder || holder === talkieLockHolderRef.current) {
          clearTalkieLock();
        }
        return;
      }
      if (!holder) return;
      const expiresAt =
        typeof payload.expiresAt === "number"
          ? payload.expiresAt
          : Date.now() + TALKIE_LOCK_TIMEOUT_MS;
      talkieLockHolderRef.current = holder;
      talkieLockExpiresAtRef.current = expiresAt;
      setTalkieLockHolderIdentity(holder);
      setTalkieLockHolderName((payload.holderName || "").trim());
      setTalkieLockExpiresAt(expiresAt);
      armTalkieLockExpiry(expiresAt);
    },
    [armTalkieLockExpiry, clearTalkieLock, session.roomId]
  );
  const publishTalkieLock = useCallback(
    async (action: "claim" | "release" | "heartbeat") => {
      if (!localParticipant) return;
      const expiresAt =
        action === "release" ? Date.now() : Date.now() + TALKIE_LOCK_TIMEOUT_MS;
      const payload: TalkieLockPayload = {
        roomId: session.roomId,
        holder: session.identity,
        holderName: session.displayName,
        action,
        expiresAt,
        timestamp: Date.now(),
      };
      applyTalkieLockPayload(payload);
      try {
        await localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          reliable: true,
          topic: TALKIE_LOCK_TOPIC,
        });
      } catch {}
    },
    [
      applyTalkieLockPayload,
      localParticipant,
      session.displayName,
      session.identity,
      session.roomId,
    ]
  );
  useEffect(() => {
    if (!recordingActive || !manualPushToTalkPressedRef.current) return;
    const heartbeatId = setInterval(() => {
      void publishTalkieLock("heartbeat");
    }, TALKIE_LOCK_HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeatId);
    };
  }, [publishTalkieLock, recordingActive]);
  useEffect(() => {
    return () => {
      void publishTalkieLock("release");
    };
  }, [publishTalkieLock]);
  useEffect(() => {
    if (recordingActive) return;
    if (manualStartInFlightRef.current) return;
    if (translationBusy) return;
    if (talkieUiState === "idle") return;
    setTalkieUiState("idle");
  }, [recordingActive, talkieUiState, translationBusy]);
  const activeAccordionPanel: AccordionPanelKey | null = controlsOpen
    ? "controls"
    : translationPanelOpen
      ? "translation"
      : null;
  const singlePanelFocusMode = Platform.OS === "ios" && activeAccordionPanel !== null;
  const shouldShowAccordionPanel = useCallback(
    (panelKey: AccordionPanelKey) =>
      !singlePanelFocusMode || activeAccordionPanel === panelKey,
    [activeAccordionPanel, singlePanelFocusMode]
  );
  const closeAllAccordionPanels = useCallback(() => {
    setControlsOpen(false);
    setTranslationPanelOpen(false);
    setShowTranslationInfo(false);
  }, []);
  const toggleAccordionPanel = useCallback(
    (panelKey: AccordionPanelKey) => {
      if (activeAccordionPanel === panelKey) {
        closeAllAccordionPanels();
        return;
      }

      setVideoFullscreen(false);
      setControlsOpen(panelKey === "controls");
      setTranslationPanelOpen(panelKey === "translation");
      if (panelKey !== "translation") {
        setShowTranslationInfo(false);
      }
    },
    [activeAccordionPanel, closeAllAccordionPanels]
  );

  useEffect(() => {
    if (!manualDraftVisible) return;
    setVideoFullscreen(false);
    setControlsOpen(false);
    setTranslationPanelOpen(true);
  }, [manualDraftVisible]);

  useEffect(() => {
    if (!isCoachSession || !coachConversationEnabled || isChatCall) return;
    setVideoFullscreen(false);
    setControlsOpen(false);
    setTranslationPanelOpen(true);
    setShowTranslationInfo(false);
  }, [coachConversationEnabled, isChatCall, isCoachSession]);

  const setIosRemoteAudioTrackVolume = useCallback(async (volume: number) => {
    if (Platform.OS !== "ios") return;
    const safeVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    try {
      await AudioSession.setDefaultRemoteAudioTrackVolume(safeVolume);
    } catch {}
  }, []);

  const duckRemoteAudioForTts = useCallback(
    async (sessionId: number) => {
      if (Platform.OS !== "ios") return;
      if (sessionId !== ttsPlaybackSessionRef.current) return;
      await setIosRemoteAudioTrackVolume(IOS_REMOTE_AUDIO_VOLUME_DUCKED_FOR_TTS);
      ttsRemoteAudioDuckedRef.current = true;
    },
    [setIosRemoteAudioTrackVolume]
  );

  const restoreRemoteAudioAfterTts = useCallback(
    async (sessionId?: number) => {
      if (Platform.OS !== "ios") return;
      if (typeof sessionId === "number" && sessionId !== ttsPlaybackSessionRef.current) return;
      if (!ttsRemoteAudioDuckedRef.current) return;
      ttsRemoteAudioDuckedRef.current = false;
      await setIosRemoteAudioTrackVolume(IOS_REMOTE_AUDIO_VOLUME_NORMAL);
    },
    [setIosRemoteAudioTrackVolume]
  );

  const ensureIosSpeakerOutput = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    try {
      await AudioSession.startAudioSession();
    } catch {}
    await setIosRemoteAudioTrackVolume(IOS_REMOTE_AUDIO_VOLUME_NORMAL);
    try {
      await AudioSession.selectAudioOutput("force_speaker");
    } catch {}
  }, [setIosRemoteAudioTrackVolume]);

  const setPlaybackAudioMode = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: Platform.OS === "ios",
      playsInSilentMode: true,
      interruptionMode: Platform.OS === "ios" ? "doNotMix" : "duckOthers",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    if (Platform.OS === "ios") {
      await ensureIosSpeakerOutput();
      await wait(80);
    }
  }, [ensureIosSpeakerOutput]);

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

  const resetIosAudioSession = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    try {
      await AudioSession.stopAudioSession();
    } catch {}
    await wait(160);
    try {
      await AudioSession.startAudioSession();
    } catch {}
    await wait(220);
  }, []);

  useEffect(() => {
    recorderUrlRef.current = recorderState.url || "";
  }, [recorderState.url]);

  useEffect(() => {
    if (!connected) {
      autoMicEnsuredRef.current = false;
      return;
    }
    if (!localParticipant) return;
    if (autoMicEnsuredRef.current) return;
    autoMicEnsuredRef.current = true;
    if (!isMicrophoneEnabled) {
      void localParticipant.setMicrophoneEnabled(true).catch(() => {
        setRecordingError("Micro iOS indisponible. Autorise le micro puis relance la room.");
      });
    }
    void ensureIosSpeakerOutput();
  }, [connected, ensureIosSpeakerOutput, isMicrophoneEnabled, localParticipant]);

  useEffect(() => {
    micEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!recorderState.mediaServicesDidReset) return;
    void resetIosAudioSession();
  }, [recorderState.mediaServicesDidReset, resetIosAudioSession]);

  const waitForMicState = useCallback(async (expectedEnabled: boolean, timeoutMs = 1200) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (micEnabledRef.current === expectedEnabled) {
        return true;
      }
      await wait(50);
    }
    return micEnabledRef.current === expectedEnabled;
  }, []);

  const pauseRoomMicForRecorder = useCallback(async () => {
    if (!localParticipant) return;
    if (Platform.OS === "ios" && IOS_SKIP_ROOM_MIC_TOGGLE_DURING_TALKIE) {
      recorderMutedRoomMicRef.current = false;
      return;
    }
    const wasMicEnabled = micEnabledRef.current;
    try {
      await localParticipant.setMicrophoneEnabled(false);
      recorderMutedRoomMicRef.current = wasMicEnabled;
      const released = await waitForMicState(false, 1600);
      if (!released) {
        await wait(220);
      }
    } catch {}
  }, [localParticipant, waitForMicState]);

  const restoreRoomMicAfterRecorder = useCallback(async () => {
    if (!localParticipant) return;
    if (Platform.OS === "ios" && IOS_SKIP_ROOM_MIC_TOGGLE_DURING_TALKIE) {
      return;
    }
    if (!recorderMutedRoomMicRef.current) return;
    recorderMutedRoomMicRef.current = false;
    try {
      await localParticipant.setMicrophoneEnabled(true);
      await waitForMicState(true, 1200);
    } catch {}
  }, [localParticipant, waitForMicState]);

  const clearTtsPlayerMonitor = useCallback(() => {
    if (!ttsPlayerMonitorRef.current) return;
    clearInterval(ttsPlayerMonitorRef.current);
    ttsPlayerMonitorRef.current = null;
  }, []);

  const clearTtsPlaybackWatchdog = useCallback(() => {
    if (!ttsPlaybackWatchdogRef.current) return;
    clearTimeout(ttsPlaybackWatchdogRef.current);
    ttsPlaybackWatchdogRef.current = null;
  }, []);

  const stopTtsPlayer = useCallback(
    (options?: { preserveDucking?: boolean }) => {
      clearTtsPlaybackWatchdog();
      clearTtsPlayerMonitor();
      const player = ttsPlayerRef.current;
      if (player) {
        try {
          player.pause();
        } catch {}
        try {
          player.remove();
        } catch {}
      }
      ttsPlayerRef.current = null;
      const tempUri = ttsTempFileRef.current;
      ttsTempFileRef.current = "";
      if (tempUri) {
        void FileSystemLegacy.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      }
      ttsLockRef.current = false;
      if (!options?.preserveDucking) {
        void restoreRemoteAudioAfterTts();
      }
    },
    [clearTtsPlaybackWatchdog, clearTtsPlayerMonitor, restoreRemoteAudioAfterTts]
  );

  const prepareTtsPlayback = useCallback(async () => {
    await setPlaybackAudioMode();
    await setIsAudioActiveAsync(true).catch(() => {});
    if (Platform.OS === "ios") {
      await AudioSession.startAudioSession().catch(() => {});
      await wait(60);
    }
  }, [setPlaybackAudioMode]);

  const blobToBase64 = useCallback((blob: Blob) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => {
        reject(new Error("Impossible de decoder l'audio TTS."));
      };
      reader.readAsDataURL(blob);
    });
  }, []);

  const playTtsUri = useCallback(
    (uri: string) => {
      stopTtsPlayer({ preserveDucking: true });
      const player = createAudioPlayer(
        { uri },
        {
          keepAudioSessionActive: true,
          updateInterval: 120,
        }
      );
      ttsPlayerRef.current = player;
      ttsTempFileRef.current = uri;
      ttsLockRef.current = true;
      try {
        player.volume = 1;
      } catch {}
      player.play();
      clearTtsPlayerMonitor();
      ttsPlayerMonitorRef.current = setInterval(() => {
        const activePlayer = ttsPlayerRef.current;
        if (!activePlayer) {
          clearTtsPlayerMonitor();
          return;
        }
        const ended =
          !activePlayer.playing &&
          activePlayer.duration > 0 &&
          activePlayer.currentTime >= activePlayer.duration - 0.15;
        if (ended) {
          stopTtsPlayer();
        }
      }, 220);
    },
    [clearTtsPlayerMonitor, stopTtsPlayer]
  );

  useEffect(() => {
    void setPlaybackAudioMode().catch(() => {});
    return () => {
      void Speech.stop();
      stopTtsPlayer();
      if (replayButtonTimerRef.current) {
        clearTimeout(replayButtonTimerRef.current);
        replayButtonTimerRef.current = null;
      }
      if (retranslateButtonTimerRef.current) {
        clearTimeout(retranslateButtonTimerRef.current);
        retranslateButtonTimerRef.current = null;
      }
      if (coachPartnerSpeakTimerRef.current) {
        clearTimeout(coachPartnerSpeakTimerRef.current);
        coachPartnerSpeakTimerRef.current = null;
      }
      void configureNativeVirtualBackground({ enabled: false, imageUrl: "" }).catch(() => {});
      if (talkieLockExpiryTimerRef.current) {
        clearTimeout(talkieLockExpiryTimerRef.current);
        talkieLockExpiryTimerRef.current = null;
      }
    };
  }, [setPlaybackAudioMode, stopTtsPlayer]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasActive = appWasActiveRef.current;
      const isActive = nextState === "active";
      appStateRef.current = nextState;
      appWasActiveRef.current = isActive;
      if (!wasActive || isActive) return;

      // iOS can terminate the app for sustained background CPU usage.
      manualPushToTalkPressedRef.current = false;
      manualStartInFlightRef.current = false;
      pendingStopAfterStartRef.current = false;
      setTalkieUiState("idle");
      if (realtimeEnabled) {
        setRealtimeEnabled(false);
      }
      stopTtsPlayer();
      void recorder.stop().catch(() => {});
      void setPlaybackAudioMode().catch(() => {});
      void restoreRoomMicAfterRecorder();
    });

    return () => {
      subscription.remove();
    };
  }, [
    realtimeEnabled,
    recorder,
    restoreRoomMicAfterRecorder,
    setPlaybackAudioMode,
    stopTtsPlayer,
  ]);

  useEffect(() => {
    if (coachConversationEnabled) return;
    coachPartnerRequestSeqRef.current += 1;
    coachPartnerLastPromptRef.current = "";
    setCoachPartnerLoading(false);
    setCoachPartnerError("");
    setCoachPartnerReply("");
    setCoachPartnerReplyTranslation("");
    setCoachReplySuggestions([]);
    setCoachReplySuggestionsLoading(false);
    setCoachPartnerSpeakActive(false);
    if (coachPartnerSpeakTimerRef.current) {
      clearTimeout(coachPartnerSpeakTimerRef.current);
      coachPartnerSpeakTimerRef.current = null;
    }
  }, [coachConversationEnabled]);

  useEffect(() => {
    if (!coachConversationEnabled) return;
    if (isChatCall) return;
    if (!localParticipant || !isCameraEnabled) return;
    void localParticipant.setCameraEnabled(false).catch(() => {});
  }, [coachConversationEnabled, isCameraEnabled, isChatCall, localParticipant]);

  const startRecorderSafely = useCallback(async () => {
    let lastError: unknown;
    const maxAttempts = Platform.OS === "ios" ? IOS_RECORDER_START_RETRY_DELAYS_MS.length : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await Speech.stop();
        try {
          await recorder.stop();
        } catch {}
        await setRecordingAudioMode();
        const settleDelay =
          Platform.OS === "ios"
            ? IOS_RECORDER_START_RETRY_DELAYS_MS[attempt] || 220
            : 80 + attempt * 40;
        await wait(settleDelay);
        await recorder.prepareToRecordAsync(recorderPreset);
        await wait(Platform.OS === "ios" ? 90 : 40);
        await recorder.record();
        return;
      } catch (err) {
        if (Platform.OS === "ios") {
          console.warn("[Talkie][iOS] recorder start failed", {
            attempt: attempt + 1,
            maxAttempts,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        lastError = err;
        try {
          await recorder.stop();
        } catch {}
        if (Platform.OS === "ios" && attempt + 1 < maxAttempts && isRecoverableIosRecorderError(err)) {
          try {
            await setPlaybackAudioMode();
          } catch {}
          await resetIosAudioSession();
          await wait(200 + attempt * 120);
          continue;
        }
        if (attempt + 1 < maxAttempts) {
          await wait(120);
        }
      }
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("Unable to start recorder on this device.");
  }, [recorder, recorderPreset, resetIosAudioSession, setPlaybackAudioMode, setRecordingAudioMode]);

  const stabilizeRecordedAudioUri = useCallback(async (rawUri: string, minBytes: number) => {
    let stableUri = rawUri;
    const cacheDir = FileSystemLegacy.cacheDirectory;
    if (cacheDir) {
      const ext = buildSegmentExtension(rawUri);
      const nextUri =
        `${cacheDir}rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "m4a"}`;
      try {
        await FileSystemLegacy.copyAsync({ from: rawUri, to: nextUri });
        stableUri = nextUri;
      } catch {
        stableUri = rawUri;
      }
    }

    const deadline = Date.now() + 1500;
    let lastSize = -1;
    let stableRounds = 0;
    let currentSize = await getAudioFileSize(stableUri);

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

  const resolveFreshRecordingUri = useCallback(
    async (baselineUri: string) => {
      const baseline = baselineUri.trim();
      const deadline = Date.now() + 1800;
      let fallback = "";
      while (Date.now() < deadline) {
        const candidates = [recorder.uri || "", recorderState.url || "", recorderUrlRef.current || ""]
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        for (const candidate of candidates) {
          if (!fallback) {
            fallback = candidate;
          }
          if (!baseline || candidate !== baseline) {
            return candidate;
          }
          if (
            lastProcessedRecordingUriRef.current &&
            candidate !== lastProcessedRecordingUriRef.current
          ) {
            return candidate;
          }
        }
        await wait(90);
      }
      return fallback;
    },
    [recorder, recorderState.url]
  );

  const targetSpeechLocale = useMemo(
    () => LANGUAGE_OPTIONS.find((opt) => opt.code === targetLanguage)?.speechLocale || "en-US",
    [targetLanguage]
  );

  const voiceOptions = useMemo(
    () => getVoicesForLanguage(availableVoices, targetLanguage, targetSpeechLocale),
    [availableVoices, targetLanguage, targetSpeechLocale]
  );
  const targetVoiceLikelyUnavailable =
    ttsEnabled &&
    voiceOptions.length === 0 &&
    (targetLanguage === "ar" ||
      targetLanguage === "fa" ||
      targetLanguage === "he" ||
      targetLanguage === "zh");

  useEffect(() => {
    let cancelled = false;
    callPrefsLoadedRef.current = false;
    const loadCallPrefs = async () => {
      try {
        const raw = await AsyncStorage.getItem(callPrefsStorageKey);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as StoredCallPrefs;

        const storedSourceLanguage = parsed.sourceLanguage;
        const storedTargetLanguage = parsed.targetLanguage;

        if (storedSourceLanguage && isLanguageCode(storedSourceLanguage)) {
          setSourceLanguage(storedSourceLanguage);
        }
        if (storedTargetLanguage && isLanguageCode(storedTargetLanguage)) {
          setTargetLanguage(storedTargetLanguage);
        }
        if (!CAPTIONS_ALWAYS_ON && typeof parsed.captionsEnabled === "boolean") {
          setCaptionsEnabled(parsed.captionsEnabled);
        }
        if (VOICE_TRANSLATION_ENABLED && typeof parsed.ttsEnabled === "boolean") {
          setTtsEnabled(parsed.ttsEnabled);
        }
        if (REALTIME_TRANSLATION_ENABLED && typeof parsed.realtimeEnabled === "boolean") {
          setRealtimeEnabled(parsed.realtimeEnabled);
        }
      } catch {
      } finally {
        if (!cancelled) {
          callPrefsLoadedRef.current = true;
        }
      }
    };
    void loadCallPrefs();
    return () => {
      cancelled = true;
    };
  }, [callPrefsStorageKey]);

  useEffect(() => {
    if (!callPrefsLoadedRef.current) return;
    const payload: StoredCallPrefs = {
      sourceLanguage,
      targetLanguage,
      captionsEnabled: CAPTIONS_ALWAYS_ON ? true : captionsEnabled,
      ttsEnabled: VOICE_TRANSLATION_ENABLED ? ttsEnabled : false,
      realtimeEnabled: REALTIME_TRANSLATION_ENABLED ? realtimeEnabled : false,
    };
    void AsyncStorage.setItem(callPrefsStorageKey, JSON.stringify(payload)).catch(() => {});
  }, [
    callPrefsStorageKey,
    captionsEnabled,
    realtimeEnabled,
    sourceLanguage,
    targetLanguage,
    ttsEnabled,
  ]);

  useEffect(() => {
    if (REALTIME_TRANSLATION_ENABLED) return;
    if (!realtimeEnabled) return;
    setRealtimeEnabled(false);
  }, [realtimeEnabled]);

  useEffect(() => {
    if (!CAPTIONS_ALWAYS_ON) return;
    if (captionsEnabled) return;
    setCaptionsEnabled(true);
  }, [captionsEnabled]);

  useEffect(() => {
    let cancelled = false;
    const loadVoices = async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (cancelled) return;
        setAvailableVoices(voices);
        setVoiceLoadError("");
      } catch (err) {
        if (cancelled) return;
        setVoiceLoadError(err instanceof Error ? err.message : "Unable to load device voices.");
      }
    };
    void loadVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (voiceId === AUTO_VOICE_ID) return;
    const stillAvailable = voiceOptions.some((voice) => voice.identifier === voiceId);
    if (!stillAvailable) {
      setVoiceId(AUTO_VOICE_ID);
    }
  }, [voiceId, voiceOptions]);

  useEffect(() => {
    let cancelled = false;
    realtimeVoiceLoadedRef.current = false;
    const loadRealtimeVoice = async () => {
      try {
        const stored = (await AsyncStorage.getItem(realtimeVoiceStorageKey))?.trim() || "";
        if (cancelled) return;
        if (isRealtimeVoiceId(stored)) {
          setRealtimeVoiceId(stored);
        } else {
          setRealtimeVoiceId("ash");
        }
      } finally {
        if (!cancelled) {
          realtimeVoiceLoadedRef.current = true;
        }
      }
    };
    void loadRealtimeVoice();
    return () => {
      cancelled = true;
    };
  }, [realtimeVoiceStorageKey]);

  useEffect(() => {
    if (!realtimeVoiceLoadedRef.current) return;
    void AsyncStorage.setItem(realtimeVoiceStorageKey, realtimeVoiceId).catch(() => {});
  }, [realtimeVoiceId, realtimeVoiceStorageKey]);

  useEffect(() => {
    let cancelled = false;
    ttsVoiceLoadedKeyRef.current = "";
    const loadTtsVoice = async () => {
      try {
        const stored = (await AsyncStorage.getItem(ttsVoiceStorageKey))?.trim() || "";
        if (cancelled) return;
        setVoiceId(stored || AUTO_VOICE_ID);
      } finally {
        if (!cancelled) {
          ttsVoiceLoadedKeyRef.current = ttsVoiceStorageKey;
        }
      }
    };
    void loadTtsVoice();
    return () => {
      cancelled = true;
    };
  }, [ttsVoiceStorageKey]);

  useEffect(() => {
    if (ttsVoiceLoadedKeyRef.current !== ttsVoiceStorageKey) return;
    void AsyncStorage.setItem(ttsVoiceStorageKey, voiceId).catch(() => {});
  }, [ttsVoiceStorageKey, voiceId]);

  const localCameraTrack = useMemo<TrackReference | null>(() => {
    if (!localParticipant) return null;
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    if (!publication) return null;
    return {
      participant: localParticipant,
      publication,
      source: publication.source,
    };
  }, [localParticipant, isCameraEnabled]);

  const fallbackRemoteVideoTracks = useMemo<TrackReference[]>(() => {
    if (!room) return [];
    const tracks: TrackReference[] = [];
    room.remoteParticipants.forEach((participant) => {
      const publications = Array.from(participant.trackPublications.values());
      const videoPublications = publications.filter((publication) => publication.kind === Track.Kind.Video);
      if (!videoPublications.length) return;

      const preferredPublication =
        videoPublications.find((publication) => publication.source === Track.Source.Camera) ||
        videoPublications.find((publication) => publication.source === Track.Source.Unknown) ||
        videoPublications[0];
      if (!preferredPublication) return;

      tracks.push({
        participant,
        publication: preferredPublication,
        source: preferredPublication.source,
      });
    });
    return tracks;
  }, [remoteParticipantCount, room]);

  const renderedTracks = useMemo(() => {
    const merged = [...cameraTracks];
    fallbackRemoteVideoTracks.forEach((track) => {
      const exists = merged.some(
        (entry) =>
          entry.participant.identity === track.participant.identity &&
          entry.publication.trackSid === track.publication.trackSid
      );
      if (!exists) {
        merged.push(track);
      }
    });

    const next = merged.filter(
      (track) => !isTranslatorIdentity(track.participant.identity || "")
    );
    if (
      localCameraTrack &&
      !next.some(
        (track) =>
          track.participant.identity === localCameraTrack.participant.identity &&
          track.source === Track.Source.Camera
      )
    ) {
      next.unshift(localCameraTrack);
    }
    return next;
  }, [cameraTracks, fallbackRemoteVideoTracks, localCameraTrack]);

  const trackKey = useCallback((track: TrackReference) => {
    const source = String(track.source ?? "camera");
    const sid = track.publication.trackSid || "nosid";
    return `${track.participant.identity}-${source}-${sid}`;
  }, []);

  const localTrack = useMemo(
    () => renderedTracks.find((track) => track.participant.isLocal) || null,
    [renderedTracks]
  );

  useEffect(() => {
    if (!videoFullscreen) return;
    closeAllAccordionPanels();
  }, [closeAllAccordionPanels, videoFullscreen]);

  useEffect(() => {
    if (!immersiveMode) return;
    setVideoFullscreen(true);
    closeAllAccordionPanels();
  }, [closeAllAccordionPanels, immersiveMode]);

  useEffect(() => {
    if (!connected) {
      setConnectionPhase("signal");
      return;
    }
    setConnectionPhase("connected");
  }, [connected]);

  useEffect(() => {
    if (!pinnedTrackKey) return;
    if (renderedTracks.some((track) => trackKey(track) === pinnedTrackKey)) return;
    setPinnedTrackKey(null);
  }, [pinnedTrackKey, renderedTracks, trackKey]);

  useEffect(() => {
    if (!renderedTracks.length) {
      if (focusedTrackKey !== null) setFocusedTrackKey(null);
      return;
    }
    if (focusedTrackKey && renderedTracks.some((track) => trackKey(track) === focusedTrackKey)) {
      return;
    }
    const preferred = renderedTracks.find((track) => !track.participant.isLocal) || renderedTracks[0];
    setFocusedTrackKey(trackKey(preferred));
  }, [focusedTrackKey, renderedTracks, trackKey]);

  const focusedTrack = useMemo(() => {
    if (!renderedTracks.length) return null;
    if (!focusedTrackKey) return renderedTracks[0] || null;
    return renderedTracks.find((track) => trackKey(track) === focusedTrackKey) || renderedTracks[0];
  }, [focusedTrackKey, renderedTracks, trackKey]);

  useEffect(() => {
    const remoteTracks = renderedTracks.filter((track) => !track.participant.isLocal);
    const remoteCount = remoteTracks.length;
    const hadNoRemoteBefore = previousRemoteTrackCountRef.current === 0;
    previousRemoteTrackCountRef.current = remoteCount;
    if (!remoteCount || !hadNoRemoteBefore) return;

    if (!focusedTrack || focusedTrack.participant.isLocal) {
      setFocusedTrackKey(trackKey(remoteTracks[0]));
    }
  }, [focusedTrack, renderedTracks, trackKey]);

  useEffect(() => {
    if (!followActiveSpeaker) return;
    if (pinnedTrackKey) return;
    if (!focusedTrack || !focusedTrack.participant.isLocal) return;
    const firstRemote = renderedTracks.find((track) => !track.participant.isLocal);
    if (!firstRemote) return;
    setFocusedTrackKey(trackKey(firstRemote));
  }, [followActiveSpeaker, focusedTrack, pinnedTrackKey, renderedTracks, trackKey]);

  const previewTrack = useMemo(() => {
    if (!focusedTrack) return null;
    const focusedKey = trackKey(focusedTrack);
    const others = renderedTracks.filter((track) => trackKey(track) !== focusedKey);
    if (!others.length) return null;
    if (focusedTrack.participant.isLocal) {
      return others.find((track) => !track.participant.isLocal) || others[0];
    }
    return others.find((track) => track.participant.isLocal) || others[0];
  }, [focusedTrack, renderedTracks, trackKey]);

  const switchTracks = useMemo(() => {
    if (!focusedTrack) return [];
    const focusedKey = trackKey(focusedTrack);
    const previewKey = previewTrack ? trackKey(previewTrack) : null;
    return renderedTracks.filter((track) => {
      const key = trackKey(track);
      if (key === focusedKey) return false;
      if (previewKey && key === previewKey) return false;
      return true;
    });
  }, [focusedTrack, previewTrack, renderedTracks, trackKey]);

  const remoteTracks = useMemo(
    () => renderedTracks.filter((track) => !track.participant.isLocal),
    [renderedTracks]
  );
  const hadRemoteParticipantRef = useRef(false);
  const noAnswerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteHangupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLeavingRef = useRef(false);

  const clearNoAnswerTimeout = useCallback(() => {
    if (!noAnswerTimeoutRef.current) return;
    clearTimeout(noAnswerTimeoutRef.current);
    noAnswerTimeoutRef.current = null;
  }, []);

  const clearRemoteHangupTimeout = useCallback(() => {
    if (!remoteHangupTimeoutRef.current) return;
    clearTimeout(remoteHangupTimeoutRef.current);
    remoteHangupTimeoutRef.current = null;
  }, []);

  const triggerAutoLeave = useCallback(
    (message: string, reason: string) => {
      if (autoLeavingRef.current) return;
      autoLeavingRef.current = true;
      setTranslationError(message);
      setTimeout(() => {
        onLeave(reason);
      }, 260);
    },
    [onLeave]
  );

  useEffect(() => {
    if (!room) {
      setRemoteParticipantCount(0);
      return;
    }
    const sync = () => {
      setRemoteParticipantCount(room.remoteParticipants.size);
    };
    sync();
    room.on(RoomEvent.ParticipantConnected, sync);
    room.on(RoomEvent.ParticipantDisconnected, sync);
    return () => {
      room.off(RoomEvent.ParticipantConnected, sync);
      room.off(RoomEvent.ParticipantDisconnected, sync);
    };
  }, [room]);

  useEffect(() => {
    if (remoteParticipantCount > 0) return;
    setActiveSpeakerIdentity("");
  }, [remoteParticipantCount]);

  useEffect(() => {
    if (!isChatCall || !connected) {
      clearNoAnswerTimeout();
      return;
    }
    if (remoteParticipantCount > 0) {
      hadRemoteParticipantRef.current = true;
      clearNoAnswerTimeout();
      return;
    }
    if (hadRemoteParticipantRef.current) {
      clearNoAnswerTimeout();
      return;
    }

    clearNoAnswerTimeout();
    noAnswerTimeoutRef.current = setTimeout(() => {
      triggerAutoLeave("Le correspondant est occupe ou ne repond pas.", "no_answer");
    }, 30000);

    return () => {
      clearNoAnswerTimeout();
    };
  }, [
    clearNoAnswerTimeout,
    connected,
    isChatCall,
    remoteParticipantCount,
    triggerAutoLeave,
  ]);

  useEffect(() => {
    if (!isChatCall || !connected) {
      clearRemoteHangupTimeout();
      return;
    }
    if (!hadRemoteParticipantRef.current) {
      clearRemoteHangupTimeout();
      return;
    }
    if (remoteParticipantCount > 0) {
      clearRemoteHangupTimeout();
      return;
    }

    clearRemoteHangupTimeout();
    remoteHangupTimeoutRef.current = setTimeout(() => {
      triggerAutoLeave("Le correspondant a raccroche.", "ended_by_remote");
    }, 2200);

    return () => {
      clearRemoteHangupTimeout();
    };
  }, [
    clearRemoteHangupTimeout,
    connected,
    isChatCall,
    remoteParticipantCount,
    triggerAutoLeave,
  ]);

  useEffect(() => {
    return () => {
      clearNoAnswerTimeout();
      clearRemoteHangupTimeout();
    };
  }, [clearNoAnswerTimeout, clearRemoteHangupTimeout]);

  useEffect(() => {
    if (!room) return;
    const onReconnecting = () => setConnectionPhase("reconnecting");
    const onSignalReconnecting = () => setConnectionPhase("signal");
    const onReconnected = () => setConnectionPhase("connected");
    const onQualityChanged = (quality: ConnectionQuality, participant: Participant) => {
      if (participant.isLocal) {
        setLocalConnectionQuality(quality);
      }
    };
    const onMediaDeviceError = (error: Error) => {
      setTranslationError(error?.message || "LiveKit media device error.");
    };

    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ConnectionQualityChanged, onQualityChanged);
    room.on(RoomEvent.MediaDevicesError, onMediaDeviceError);

    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ConnectionQualityChanged, onQualityChanged);
      room.off(RoomEvent.MediaDevicesError, onMediaDeviceError);
    };
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const onActiveSpeakersChanged = (speakers: Participant[]) => {
      const mainSpeaker = speakers.find((speaker) => !speaker.isLocal) || null;
      setActiveSpeakerIdentity(mainSpeaker?.identity || "");

      if (!mainSpeaker || pinnedTrackKey || !followActiveSpeaker) return;
      const targetTrack =
        renderedTracks.find(
          (track) =>
            track.participant.identity === mainSpeaker.identity &&
            track.source === Track.Source.Camera
        ) || renderedTracks.find((track) => track.participant.identity === mainSpeaker.identity);
      if (!targetTrack) return;
      const nextKey = trackKey(targetTrack);
      setFocusedTrackKey((current) => (current === nextKey ? current : nextKey));
    };

    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    };
  }, [followActiveSpeaker, pinnedTrackKey, renderedTracks, room, trackKey]);

  const getLabel = useCallback((track: TrackReference) => {
    return `${track.participant.identity}${track.participant.isLocal ? " (me)" : ""}`;
  }, []);

  const getLanguageLabel = useCallback(
    (code: LanguageCode) => LANGUAGE_PROMPT_NAMES[code] || "English",
    []
  );
  const getLanguageChipLabel = useCallback(
    (lang: (typeof LANGUAGE_OPTIONS)[number]) => `${getLanguageLabel(lang.code)} (${lang.code})`,
    [getLanguageLabel]
  );
  const showLanguageInfo = useCallback(
    (lang: (typeof LANGUAGE_OPTIONS)[number]) => {
      Alert.alert("Language", `${getLanguageLabel(lang.code)} (${lang.code})`);
    },
    [getLanguageLabel]
  );
  const sourceLanguageLabel = getLanguageLabel(sourceLanguage);
  const targetLanguageLabel = getLanguageLabel(targetLanguage);
  const sourceLanguageIsRtl = isRtlLanguageCode(sourceLanguage);
  const targetLanguageIsRtl = isRtlLanguageCode(targetLanguage);
  const coachPartnerReplyLanguageIsRtl = isRtlLanguageCode(targetLanguage);
  const coachPartnerTranslationLanguageIsRtl = isRtlLanguageCode(sourceLanguage);
  const canUseCoachConversation =
    isCoachSession && Boolean((session.bearerToken || "").trim());

  const getPromptLanguageName = useCallback(
    (code: LanguageCode) => LANGUAGE_PROMPT_NAMES[code] || "English",
    []
  );

  useEffect(() => {
    const input = captionText.trim();
    if (!input) {
      setCaptionPhoneticBusy(false);
      setCaptionPhoneticText("");
      return;
    }
    const requestId = ++captionPhoneticSeqRef.current;
    setCaptionPhoneticBusy(true);
    void (async () => {
      try {
        const generated = await phoneticText({
          apiBaseUrl: publicApiBase,
          bearerToken: session.bearerToken,
          guestTtsToken: session.guestTtsToken,
          text: input,
          languageName: getPromptLanguageName(targetLanguage),
        });
        if (requestId !== captionPhoneticSeqRef.current) return;
        const cleaned = generated.trim();
        const sourceNormalized = input.replace(/\s+/g, " ").trim().toLowerCase();
        const phoneticNormalized = cleaned.replace(/\s+/g, " ").trim().toLowerCase();
        const finalPhonetic =
          cleaned && phoneticNormalized !== sourceNormalized ? cleaned : "";
        setCaptionPhoneticText(finalPhonetic);
      } catch {
        if (requestId !== captionPhoneticSeqRef.current) return;
        setCaptionPhoneticText("");
      } finally {
        if (requestId === captionPhoneticSeqRef.current) {
          setCaptionPhoneticBusy(false);
        }
      }
    })();
  }, [
    captionText,
    getPromptLanguageName,
    publicApiBase,
    session.bearerToken,
    session.guestTtsToken,
    targetLanguage,
  ]);

  const stopNativeRealtimeSession = useCallback(async () => {
    const ws = realtimeWsRef.current;
    realtimeWsRef.current = null;
    if (ws) {
      try {
        ws.close();
      } catch {}
    }

    const bridge = realtimeBridgeRef.current;
    realtimeBridgeRef.current = null;
    if (bridge) {
      try {
        await bridge.clearPlaybackQueue();
      } catch {}
      try {
        await bridge.stop();
      } catch {}
      bridge.dispose();
    }

    realtimeOutputBufferRef.current = "";
    realtimeInputTranscriptRef.current = "";
    realtimeLatestCaptureAtRef.current = 0;
  }, []);

  const buildNativeRealtimeSessionUpdate = useCallback(() => {
    const sourcePromptLanguage = getPromptLanguageName(sourceLanguage);
    const targetPromptLanguage = getPromptLanguageName(targetLanguage);
    return {
      type: "session.update",
      session: {
        instructions: `You are a real-time interpreter. Translate ${sourcePromptLanguage} to ${targetPromptLanguage}. Output only the translated speech in ${targetPromptLanguage}.`,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: realtimeVoiceId,
        modalities: ["audio", "text"],
        turn_detection: {
          type: "server_vad",
          threshold: 0.45,
          prefix_padding_ms: 120,
          silence_duration_ms: 260,
        },
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
        },
      },
    };
  }, [getPromptLanguageName, realtimeVoiceId, sourceLanguage, targetLanguage]);

  useEffect(() => {
    if (!connected) {
      cameraAutoStartedRef.current = false;
      return;
    }
    if (!startWithCamera) return;
    if (!localParticipant || cameraAutoStartedRef.current) return;
    cameraAutoStartedRef.current = true;
    if (isCameraEnabled) return;
    void localParticipant.setCameraEnabled(true, { facingMode: cameraFacingMode }).catch((err) => {
      setTranslationError(err instanceof Error ? err.message : "Camera startup failed.");
    });
  }, [cameraFacingMode, connected, isCameraEnabled, localParticipant, startWithCamera]);

  const startRecording = useCallback(async () => {
    if (realtimeEnabled) {
      setRecordingError("Realtime actif. Coupe Realtime pour utiliser le mode manuel.");
      return false;
    }
    if (recordingActive) return true;
    setRecordingError("");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone permission denied.");
      }
      await setIsAudioActiveAsync(true).catch(() => {});
      if (Platform.OS === "ios") {
        await ensureIosSpeakerOutput();
      }
      if (Platform.OS === "ios") {
        await resetIosAudioSession();
      }
      recordingStartUriRef.current = (recorder.uri || recorderUrlRef.current || "").trim();

      let lastError: unknown = null;
      const maxAttempts = Platform.OS === "ios" ? IOS_RECORDER_START_RETRY_DELAYS_MS.length : 2;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          await pauseRoomMicForRecorder();
          const startupDelay =
            Platform.OS === "ios"
              ? IOS_RECORDER_START_RETRY_DELAYS_MS[attempt] || 220
              : 120 + attempt * 120;
          await wait(startupDelay);
          await startRecorderSafely();
          manualRecordingStartedAtRef.current = Date.now();
          return true;
        } catch (error) {
          if (Platform.OS === "ios") {
            console.warn("[Talkie][iOS] startRecording attempt failed", {
              attempt: attempt + 1,
              maxAttempts,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          lastError = error;
          try {
            await setPlaybackAudioMode();
          } catch {}
          await restoreRoomMicAfterRecorder();
          if (
            Platform.OS === "ios" &&
            attempt + 1 < maxAttempts &&
            isRecoverableIosRecorderError(error)
          ) {
            await resetIosAudioSession();
            await wait(240 + attempt * 160);
            continue;
          }
          if (attempt + 1 < maxAttempts) {
            await wait(160);
            continue;
          }
          break;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("Unable to start recorder on this device.");
    } catch (err) {
      setRecordingError(toFriendlyAudioError(err));
      manualRecordingStartedAtRef.current = 0;
      recordingStartUriRef.current = "";
      try {
        await setPlaybackAudioMode();
      } catch {}
      await restoreRoomMicAfterRecorder();
      return false;
    }
  }, [
    ensureIosSpeakerOutput,
    pauseRoomMicForRecorder,
    realtimeEnabled,
    recordingActive,
    restoreRoomMicAfterRecorder,
    resetIosAudioSession,
    recorder,
    setPlaybackAudioMode,
    startRecorderSafely,
  ]);

  const speakText = useCallback(
    async (text: string, languageOverride?: LanguageCode) => {
      if (!ttsEnabled || !text.trim()) return;
      if (realtimeEnabled) return;
      if (recordingActive && !realtimeEnabled) {
        setTranslationError("Stop recording before voice playback.");
        return;
      }

      const effectiveLanguage = languageOverride || targetLanguage;
      const effectiveLocale =
        LANGUAGE_OPTIONS.find((opt) => opt.code === effectiveLanguage)?.speechLocale ||
        targetSpeechLocale;
      const useSelectedVoice = !languageOverride || languageOverride === targetLanguage;

      const textToSpeak = text.trim().slice(0, AI_TTS_MAX_CHARS);
      const ttsSessionId = ++ttsPlaybackSessionRef.current;
      const finalizeTtsSession = (sessionId: number) => {
        if (sessionId !== ttsPlaybackSessionRef.current) return;
        clearTtsPlaybackWatchdog();
        ttsLockRef.current = false;
        void restoreRemoteAudioAfterTts(sessionId);
      };
      const speakWithDeviceVoice = (fallback: boolean) => {
        const locale = fallback
          ? (effectiveLanguage || "en").trim().toLowerCase() || "en"
          : effectiveLocale;
        const selectedVoice = fallback
          ? undefined
          : !useSelectedVoice
            ? undefined
            : voiceId === AUTO_VOICE_ID
            ? undefined
            : voiceId;

        try {
          Speech.speak(textToSpeak, {
            language: locale,
            rate: 0.96,
            pitch: 1,
            voice: selectedVoice,
            useApplicationAudioSession: Platform.OS === "ios",
            onDone: () => {
              finalizeTtsSession(ttsSessionId);
            },
            onStopped: () => {
              finalizeTtsSession(ttsSessionId);
            },
            onError: (error) => {
              if (!fallback) {
                speakWithDeviceVoice(true);
                return;
              }
              finalizeTtsSession(ttsSessionId);
              if (!realtimeEnabled) {
                setTranslationError(
                  toFriendlyAudioError(error?.message || "Voice playback failed.")
                );
              }
            },
          });
        } catch (error) {
          if (!fallback) {
            speakWithDeviceVoice(true);
            return;
          }
          finalizeTtsSession(ttsSessionId);
          if (!realtimeEnabled) {
            setTranslationError(toFriendlyAudioError(error));
          }
        }
      };

      try {
        await prepareTtsPlayback();
        await duckRemoteAudioForTts(ttsSessionId);
        if (ttsLockRef.current) {
          await Speech.stop();
          stopTtsPlayer({ preserveDucking: true });
        }
        ttsLockRef.current = true;
        setTranslationError("");
        if (AI_TTS_ENABLED && publicApiBase) {
          const requestSeq = ++ttsRequestSeqRef.current;
          try {
            const response = await fetch(`${publicApiBase}/api/tts`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(session.bearerToken?.trim()
                  ? { Authorization: `Bearer ${session.bearerToken.trim()}` }
                  : {}),
                ...(session.guestTtsToken?.trim()
                  ? { "x-bfzoom-guest-tts-token": session.guestTtsToken.trim() }
                  : {}),
              },
              body: JSON.stringify({
                text: textToSpeak,
                voice: AI_TTS_DEFAULT_VOICE,
                format: "mp3",
              }),
            });
            if (!response.ok) {
              throw new Error(await readHttpError(response));
            }
            const audioBlob = await response.blob();
            const audioBase64 = await blobToBase64(audioBlob);
            const cacheBase = FileSystemLegacy.cacheDirectory || FileSystemLegacy.documentDirectory;
            if (!cacheBase) {
              throw new Error("Audio cache unavailable on this device.");
            }
            const tempUri = `${cacheBase}bfzoom-tts-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}.mp3`;
            await FileSystemLegacy.writeAsStringAsync(tempUri, audioBase64, {
              encoding: "base64" as never,
            });
            if (requestSeq !== ttsRequestSeqRef.current) {
              void FileSystemLegacy.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
              finalizeTtsSession(ttsSessionId);
              return;
            }
            playTtsUri(tempUri);
            if (Platform.OS === "ios") {
              clearTtsPlaybackWatchdog();
              ttsPlaybackWatchdogRef.current = setTimeout(() => {
                const activePlayer = ttsPlayerRef.current;
                if (!activePlayer) return;
                const likelyStalled =
                  !activePlayer.playing &&
                  (activePlayer.duration <= 0 || activePlayer.currentTime <= 0.02);
                if (!likelyStalled) return;
                stopTtsPlayer({ preserveDucking: true });
                if (!realtimeEnabled) {
                  setTranslationError(
                    "Lecture voix IA instable sur iOS. Fallback voix appareil."
                  );
                }
                speakWithDeviceVoice(false);
              }, 900);
            }
            return;
          } catch (ttsError) {
            const ttsReason =
              ttsError instanceof Error ? ttsError.message.trim() : String(ttsError || "").trim();
            if (!realtimeEnabled) {
              setTranslationError(
                ttsReason
                  ? `Voix IA indisponible: ${ttsReason}. Fallback voix appareil.`
                  : "Voix IA indisponible temporairement. Fallback voix appareil."
              );
            }
          }
        }
        speakWithDeviceVoice(false);
      } catch (err) {
        finalizeTtsSession(ttsSessionId);
        if (!realtimeEnabled) {
          setTranslationError(toFriendlyAudioError(err));
        }
      }
    },
    [
      recordingActive,
      blobToBase64,
      playTtsUri,
      publicApiBase,
      realtimeEnabled,
      restoreRemoteAudioAfterTts,
      session.bearerToken,
      session.guestTtsToken,
      prepareTtsPlayback,
      duckRemoteAudioForTts,
      stopTtsPlayer,
      targetLanguage,
      targetSpeechLocale,
      ttsEnabled,
      setCoachSuggestionSpeakingId,
      voiceId,
      clearTtsPlaybackWatchdog,
    ]
  );

  const replayCaption = useCallback(() => {
    const text = captionText.trim();
    if (!text) return;
    if (replayButtonTimerRef.current) {
      clearTimeout(replayButtonTimerRef.current);
      replayButtonTimerRef.current = null;
    }
    setReplayButtonActive(true);
    replayButtonTimerRef.current = setTimeout(() => {
      setReplayButtonActive(false);
      replayButtonTimerRef.current = null;
    }, 900);
    void speakText(text);
  }, [captionText, speakText]);

  const playCoachPartnerReply = useCallback(() => {
    const text = coachPartnerReply.trim();
    if (!text) return;
    if (coachPartnerSpeakTimerRef.current) {
      clearTimeout(coachPartnerSpeakTimerRef.current);
      coachPartnerSpeakTimerRef.current = null;
    }
    setCoachPartnerSpeakActive(true);
    coachPartnerSpeakTimerRef.current = setTimeout(() => {
      setCoachPartnerSpeakActive(false);
      coachPartnerSpeakTimerRef.current = null;
    }, 1100);
    void speakText(text);
  }, [coachPartnerReply, speakText]);

  const playCoachSuggestion = useCallback(
    (entry: CoachReplySuggestion) => {
      const text = entry.targetText.trim();
      if (!text) return;
      setCoachSuggestionSpeakingId(entry.id);
      if (coachPartnerSpeakTimerRef.current) {
        clearTimeout(coachPartnerSpeakTimerRef.current);
        coachPartnerSpeakTimerRef.current = null;
      }
      coachPartnerSpeakTimerRef.current = setTimeout(() => {
        setCoachSuggestionSpeakingId((current) => (current === entry.id ? "" : current));
        coachPartnerSpeakTimerRef.current = null;
      }, 1100);
      void speakText(text, targetLanguage).finally(() => {
        setCoachSuggestionSpeakingId((current) => (current === entry.id ? "" : current));
      });
    },
    [speakText, targetLanguage]
  );

  const requestCoachPartnerReply = useCallback(
    async (userMessage: string, userLang: LanguageCode) => {
      if (!coachConversationEnabled) return;
      const prompt = userMessage.trim();
      if (!prompt) return;
      const dedupKey = `${userLang}:${prompt}`;
      if (coachPartnerLastPromptRef.current === dedupKey && coachPartnerReply.trim()) return;

      const bearerToken = (session.bearerToken || "").trim();
      if (!bearerToken) {
        setCoachPartnerError(
          "Coach conversation IA indisponible en invite. Connecte-toi en hote."
        );
        return;
      }

      const requestId = ++coachPartnerRequestSeqRef.current;
      setCoachPartnerLoading(true);
      setCoachPartnerError("");
      try {
        const response = await fetch(`${publicApiBase}/api/openai`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearerToken}`,
          },
          body: JSON.stringify({
            intent: "coach_conversation_mobile",
            roomId: session.roomId,
            messages: [
              {
                role: "system",
                content:
                  `Tu es un partenaire de conversation de langue. Tu reponds uniquement en ${getPromptLanguageName(
                    targetLanguage
                  )}. ` +
                  "Reponse courte (1 a 2 phrases), naturelle, puis une question simple pour relancer l'echange. " +
                  "Ton bienveillant, sans meta-commentaire.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        });

        const raw = await response.text();
        let payload: unknown = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          if (!response.ok) throw new Error(raw || `Erreur IA (${response.status})`);
        }

        if (!response.ok) {
          const message =
            (payload as { error?: string } | null)?.error || raw || `Erreur IA (${response.status})`;
          throw new Error(message);
        }

        const choice = (
          payload as { choices?: { message?: { content?: string }; finish_reason?: string }[] } | null
        )?.choices?.[0];
        const text = (choice?.message?.content || "").trim();
        if (!text) throw new Error("Aucune reponse IA.");
        if (requestId !== coachPartnerRequestSeqRef.current) return;

        setCoachReplySuggestions([]);
        setCoachReplySuggestionsLoading(true);
        setCoachPartnerReply(
          choice?.finish_reason === "length" ? `${text}\n\n[Reponse tronquee]` : text
        );
        coachPartnerLastPromptRef.current = dedupKey;
        setCoachPartnerReplyTranslation("");

        if (userLang !== targetLanguage) {
          try {
            const translated = await translateText({
              apiBaseUrl: publicApiBase,
              bearerToken: session.bearerToken,
              guestTtsToken: session.guestTtsToken,
              text,
              fromLanguage: getPromptLanguageName(targetLanguage),
              toLanguage: getPromptLanguageName(userLang),
            });
            if (requestId !== coachPartnerRequestSeqRef.current) return;
            const cleanTranslated = translated.trim();
            if (cleanTranslated) {
              setCoachPartnerReplyTranslation(cleanTranslated);
            }
          } catch {
            if (requestId !== coachPartnerRequestSeqRef.current) return;
          }
        }

        try {
            const suggestionsResponse = await fetch(`${publicApiBase}/api/openai`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${bearerToken}`,
              },
              body: JSON.stringify({
                intent: "coach_conversation_suggestions_mobile",
                roomId: session.roomId,
                messages: [
                  {
                    role: "system",
                    content:
                      `Tu proposes 3 reponses courtes que l'utilisateur peut dire ensuite. ` +
                      `Ecris UNIQUEMENT en ${getPromptLanguageName(targetLanguage)}. ` +
                      'Retourne strictement du JSON: {"suggestions":["...","...","..."]}.',
                  },
                  {
                    role: "user",
                    content: `Message du partenaire IA: ${text}`,
                  },
                ],
              }),
            });

            const suggestionsRaw = await suggestionsResponse.text();
            if (!suggestionsResponse.ok) {
              throw new Error(suggestionsRaw || `Erreur suggestions (${suggestionsResponse.status})`);
            }
            if (requestId !== coachPartnerRequestSeqRef.current) return;

            const suggestionTargets = parseCoachSuggestions(suggestionsRaw).slice(0, 3);
            if (suggestionTargets.length === 0) {
              setCoachReplySuggestions([]);
              return;
            }

            const translatedSuggestions = await Promise.all(
              suggestionTargets.map(async (entry, index) => {
                const phonetic = await phoneticText({
                  apiBaseUrl: publicApiBase,
                  bearerToken: session.bearerToken,
                  guestTtsToken: session.guestTtsToken,
                  text: entry,
                  languageName: getPromptLanguageName(targetLanguage),
                }).catch(() => "");
                const normalizedSuggestion = entry.replace(/\s+/g, " ").trim().toLowerCase();
                const normalizedPhonetic = phonetic.replace(/\s+/g, " ").trim().toLowerCase();
                const finalPhonetic =
                  normalizedPhonetic && normalizedPhonetic !== normalizedSuggestion
                    ? phonetic.trim()
                    : "";

                if (userLang === targetLanguage) {
                  return {
                    id: `${requestId}-${index}`,
                    targetText: entry,
                    sourceText: entry,
                    phoneticText: finalPhonetic,
                  };
                }
                const translated = await translateText({
                  apiBaseUrl: publicApiBase,
                  bearerToken: session.bearerToken,
                  guestTtsToken: session.guestTtsToken,
                  text: entry,
                  fromLanguage: getPromptLanguageName(targetLanguage),
                  toLanguage: getPromptLanguageName(userLang),
                }).catch(() => "");
                return {
                  id: `${requestId}-${index}`,
                  targetText: entry,
                  sourceText: translated.trim() || entry,
                  phoneticText: finalPhonetic,
                };
              })
            );
            if (requestId !== coachPartnerRequestSeqRef.current) return;
            setCoachReplySuggestions(translatedSuggestions);
          } catch {
            if (requestId !== coachPartnerRequestSeqRef.current) return;
            setCoachReplySuggestions([]);
        }
      } catch (error) {
        if (requestId !== coachPartnerRequestSeqRef.current) return;
        const rawMessage = error instanceof Error ? error.message : "Erreur coach conversation IA.";
        if (/unauthorized|401|forbidden|403/i.test(rawMessage)) {
          setCoachPartnerError("Coach conversation IA indisponible pour ce profil.");
        } else {
          setCoachPartnerError(rawMessage);
        }
        setCoachReplySuggestions([]);
      } finally {
        if (requestId === coachPartnerRequestSeqRef.current) {
          setCoachPartnerLoading(false);
          setCoachReplySuggestionsLoading(false);
        }
      }
    },
    [
      coachPartnerReply,
      coachConversationEnabled,
      getPromptLanguageName,
      publicApiBase,
      session.bearerToken,
      session.guestTtsToken,
      session.roomId,
      targetLanguage,
    ]
  );

  const retranslateCurrentSource = useCallback(async () => {
    const cleanSource = sourceText.trim();
    if (!cleanSource || translationBusy) return;
    if (translationControlsDisabled) {
      setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
      return;
    }

    setTranslationBusy(true);
    setTranslationError("");
    try {
      if (isHostSession) {
        const consumed = await consumeTranslationSeconds(1, "local");
        if (!consumed) {
          setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
          return;
        }
      }

      const sourceLang = sourceTextLanguageRef.current || sourceLanguage;
      let translated = "";
      try {
        translated = await translateText({
          apiBaseUrl: publicApiBase,
          bearerToken: session.bearerToken,
          guestTtsToken: session.guestTtsToken,
          text: cleanSource,
          fromLanguage: getPromptLanguageName(sourceLang),
          toLanguage: getPromptLanguageName(targetLanguage),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Traduction indisponible.";
        setTranslationError(
          /forbidden|403|acces refuse|accès refusé/i.test(message)
            ? "Traduction refusée pour ce compte. Le texte source reste visible."
            : `Traduction indisponible, fallback texte source: ${message}`
        );
      }

      const finalCaption = translated.trim() || cleanSource;
      if (!finalCaption) {
        throw new Error("Empty translation.");
      }
      setCaptionText(finalCaption);
      if (ttsEnabled) {
        void speakText(finalCaption);
      }
    } catch (error) {
      setTranslationError(toFriendlyAudioError(error));
    } finally {
      setTranslationBusy(false);
    }
  }, [
    consumeTranslationSeconds,
    effectiveTranslationLockMessage,
    getPromptLanguageName,
    isHostSession,
    publicApiBase,
    session.bearerToken,
    session.guestTtsToken,
    sourceLanguage,
    sourceText,
    speakText,
    targetLanguage,
    translationBusy,
    translationControlsDisabled,
    ttsEnabled,
  ]);

  const triggerRetranslate = useCallback(() => {
    if (translationBusy || !sourceText.trim()) return;
    if (retranslateButtonTimerRef.current) {
      clearTimeout(retranslateButtonTimerRef.current);
      retranslateButtonTimerRef.current = null;
    }
    setRetranslateButtonActive(true);
    retranslateButtonTimerRef.current = setTimeout(() => {
      setRetranslateButtonActive(false);
      retranslateButtonTimerRef.current = null;
    }, 900);
    void retranslateCurrentSource();
  }, [retranslateCurrentSource, sourceText, translationBusy]);

  const handleIncomingCaption = useCallback(
    (payload: CaptionPayload) => {
      if (!payload.text && !payload.sourceText) return;
      if (payload.roomId && payload.roomId !== session.roomId) return;
      const fallbackSource = (payload.sourceText || payload.text || "").trim();
      const fallbackCaption = (payload.text || fallbackSource).trim();
      if (!fallbackCaption) return;

      sourceTextLanguageRef.current =
        payload.sourceLang && isLanguageCode(payload.sourceLang)
          ? payload.sourceLang
          : sourceLanguage;
      setSourceText(fallbackSource);

      if (payload.from === session.identity) {
        setCaptionText(fallbackCaption);
        return;
      }

      const remoteDurationSeconds =
        typeof payload.durationSeconds === "number" && Number.isFinite(payload.durationSeconds)
          ? Math.max(1, Math.min(300, Math.floor(payload.durationSeconds)))
          : 1;

      void (async () => {
        if (isHostSession) {
          const consumed = await consumeTranslationSeconds(remoteDurationSeconds, "remote");
          if (!consumed) {
            setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
            return;
          }
        }
        if (!payload.sourceText || !payload.sourceLang || payload.targetLang === targetLanguage) {
          setCaptionText(fallbackCaption);
          if (ttsEnabled) {
            void speakText(fallbackCaption);
          }
          return;
        }

        const sourceLangCode = payload.sourceLang;
        if (!isLanguageCode(sourceLangCode)) {
          setCaptionText(fallbackCaption);
          if (ttsEnabled) {
            void speakText(fallbackCaption);
          }
          return;
        }

        const sequence = ++incomingTranslationSeqRef.current;
        try {
          const personalized = await translateText({
            apiBaseUrl: publicApiBase,
            bearerToken: session.bearerToken,
            guestTtsToken: session.guestTtsToken,
            text: payload.sourceText || "",
            fromLanguage: getPromptLanguageName(sourceLangCode),
            toLanguage: getPromptLanguageName(targetLanguage),
          });
          if (sequence !== incomingTranslationSeqRef.current) return;
          const caption = personalized.trim() || fallbackCaption;
          setCaptionText(caption);
          setTranslationError("");
          if (ttsEnabled) {
            void speakText(caption);
          }
        } catch {
          if (sequence !== incomingTranslationSeqRef.current) return;
          setCaptionText(fallbackCaption);
          if (ttsEnabled) {
            void speakText(fallbackCaption);
          }
        }
      })();
    },
    [
      consumeTranslationSeconds,
      effectiveTranslationLockMessage,
      getPromptLanguageName,
      isHostSession,
      session.bearerToken,
      session.guestTtsToken,
      session.identity,
      session.roomId,
      publicApiBase,
      sourceLanguage,
      speakText,
      targetLanguage,
      ttsEnabled,
    ]
  );

  useEffect(() => {
    if (!room) return;
    const onData = (data: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (!topic) return;
      try {
        const raw = new TextDecoder().decode(data);
        if (topic === "bfzoom-captions") {
          const parsed = JSON.parse(raw) as CaptionPayload;
          handleIncomingCaption(parsed);
          return;
        }
        if (topic === TALKIE_LOCK_TOPIC) {
          const parsed = JSON.parse(raw) as TalkieLockPayload;
          applyTalkieLockPayload(parsed);
          return;
        }
        if (topic === TRANSLATION_ACCESS_TOPIC) {
          if (isHostSession) return;
          const parsed = JSON.parse(raw) as TranslationAccessPayload;
          if (parsed.roomId && parsed.roomId !== session.roomId) return;
          setRoomTranslationEnabled(Boolean(parsed.enabled));
          const normalizedReason = String(parsed.reason || "").trim();
          setRoomTranslationReason(normalizedReason || TRANSLATION_UNLOCK_HINT);
          if (
            typeof parsed.remainingSeconds === "number" &&
            Number.isFinite(parsed.remainingSeconds)
          ) {
            setRoomTranslationRemainingSeconds(Math.max(0, Math.floor(parsed.remainingSeconds)));
          } else {
            setRoomTranslationRemainingSeconds(null);
          }
        }
      } catch {}
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [applyTalkieLockPayload, handleIncomingCaption, isHostSession, room, session.roomId]);

  const publishCaption = useCallback(
    async (payload: CaptionPayload) => {
      if (!localParticipant) return;
      const text = JSON.stringify(payload);
      await localParticipant.publishData(new TextEncoder().encode(text), {
        reliable: true,
        topic: "bfzoom-captions",
      });
    },
    [localParticipant]
  );

  const flushNativeRealtimeOutput = useCallback(async () => {
    const text = realtimeOutputBufferRef.current.trim();
    realtimeOutputBufferRef.current = "";
    if (!text) return;

    setCaptionText(text);
    if (!captionsEnabled) return;
    await publishCaption({
      roomId: session.roomId,
      from: session.identity,
      text,
      sourceText: realtimeInputTranscriptRef.current || undefined,
      sourceLang: sourceLanguage,
      targetLang: targetLanguage,
      timestamp: Date.now(),
    });
  }, [
    captionsEnabled,
    publishCaption,
    session.identity,
    session.roomId,
    sourceLanguage,
    targetLanguage,
  ]);

  const runNativeRealtimeSession = useCallback(
    async (isCancelled: () => boolean) => {
      const realtimeUrl = env.realtimeUrl.trim();
      if (!realtimeUrl) {
        throw new Error("EXPO_PUBLIC_REALTIME_URL is missing.");
      }

      await stopNativeRealtimeSession();
      setRealtimeStatus("running");
      setRealtimeQueueDepth(0);
      setTranslationError("");
      realtimeOutputBufferRef.current = "";
      realtimeInputTranscriptRef.current = "";

      const bridge = createRealtimePcmBridge({
        onChunk: (chunk) => {
          const ws = realtimeWsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;

          if (ws.bufferedAmount > REALTIME_WS_BACKLOG_LIMIT_BYTES) {
            setTranslationError(
              "Realtime WS surcharge: reduction automatique des paquets audio en cours."
            );
            return;
          }

          realtimeLatestCaptureAtRef.current = chunk.capturedAt;
          ws.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: chunk.audio,
            })
          );
          setRealtimeQueueDepth(Math.max(0, Math.ceil(ws.bufferedAmount / 8192)));
        },
        onError: (message) => {
          setTranslationError(message);
          setRealtimeStatus("error");
        },
      });
      realtimeBridgeRef.current = bridge;

      let ws: WebSocket;
      try {
        ws = new WebSocket(realtimeUrl, REALTIME_WS_PROTOCOL);
      } catch {
        ws = new WebSocket(realtimeUrl);
      }
      realtimeWsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        let opened = false;
        let settled = false;
        const completeResolve = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const completeReject = (reason: Error) => {
          if (settled) return;
          settled = true;
          reject(reason);
        };

        ws.onopen = () => {
          opened = true;
          if (isCancelled()) {
            ws.close();
            completeResolve();
            return;
          }
          setRealtimeStatus("running");
          setTranslationError("");
          ws.send(JSON.stringify(buildNativeRealtimeSessionUpdate()));
          ws.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
          completeResolve();
        };

        ws.onmessage = (event) => {
          if (isCancelled()) return;
          const raw = typeof event.data === "string" ? event.data : "";
          if (!raw) return;

          let message: Record<string, unknown>;
          try {
            message = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return;
          }

          const type = typeof message.type === "string" ? message.type : "";
          if (!type) return;

          if (type === "response.audio.delta") {
            const delta = typeof message.delta === "string" ? message.delta : "";
            if (!delta) return;
            void bridge.appendPcmBase64(delta).catch((err) => {
              setTranslationError(
                err instanceof Error ? err.message : "Native audio playback failed."
              );
            });
            return;
          }

          if (
            type === "response.audio_transcript.delta" ||
            type === "response.output_text.delta" ||
            type === "response.text.delta"
          ) {
            const delta =
              typeof message.delta === "string"
                ? message.delta
                : typeof message.text === "string"
                  ? message.text
                  : "";
            if (!delta) return;
            realtimeOutputBufferRef.current += delta;
            setCaptionText(realtimeOutputBufferRef.current.trim());
            if (realtimeLatestCaptureAtRef.current > 0) {
              setRealtimeLatencyMs(Date.now() - realtimeLatestCaptureAtRef.current);
            }
            return;
          }

          if (type === "conversation.item.input_audio_transcription.completed") {
            const rootTranscript =
              typeof message.transcript === "string" ? message.transcript : "";
            let nestedTranscript = "";
            if (typeof message.item === "object" && message.item) {
              const item = message.item as { transcript?: unknown };
              if (typeof item.transcript === "string") {
                nestedTranscript = item.transcript;
              }
            }
            const transcript = (rootTranscript || nestedTranscript).trim();
            if (!transcript) return;
            realtimeInputTranscriptRef.current = transcript;
            sourceTextLanguageRef.current = sourceLanguage;
            setSourceText(transcript);
            return;
          }

          if (type === "response.done") {
            void (async () => {
              await flushNativeRealtimeOutput();
              if (isCancelled()) return;
              if (ws.readyState !== WebSocket.OPEN) return;
              ws.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
            })();
            return;
          }

          if (type === "error") {
            let messageText = "Realtime WS error.";
            if (typeof message.error === "object" && message.error) {
              const errorObj = message.error as { message?: unknown };
              if (typeof errorObj.message === "string" && errorObj.message.trim()) {
                messageText = errorObj.message;
              }
            }
            setTranslationError(messageText);
            setRealtimeStatus("error");
          }
        };

        ws.onerror = () => {
          if (isCancelled()) return;
          setTranslationError("Realtime WS connection failed.");
          setRealtimeStatus("error");
          setForceSegmentedRealtime(true);
          setRealtimeEnabled(false);
          if (!opened) {
            completeReject(new Error("Realtime websocket connection failed."));
          }
        };

        ws.onclose = (event) => {
          if (isCancelled()) return;
          setRealtimeQueueDepth(0);
          if (event.code !== 1000) {
            setRealtimeStatus("error");
            setTranslationError(`Realtime WS closed (${event.code}).`);
            setForceSegmentedRealtime(true);
            setRealtimeEnabled(false);
          }
          if (!opened) {
            completeReject(new Error(`Realtime websocket closed before open (${event.code}).`));
          }
        };
      });

      if (isCancelled()) return;
      await bridge.start({
        sampleRate: REALTIME_NATIVE_SAMPLE_RATE,
        chunkMs: REALTIME_NATIVE_CHUNK_MS,
      });
    },
    [
      buildNativeRealtimeSessionUpdate,
      flushNativeRealtimeOutput,
      stopNativeRealtimeSession,
    ]
  );

  useEffect(() => {
    if (!realtimeEnabled || !realtimeNativeEnabled) return;
    const ws = realtimeWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(buildNativeRealtimeSessionUpdate()));
  }, [buildNativeRealtimeSessionUpdate, realtimeEnabled, realtimeNativeEnabled]);

  const processTranscript = useCallback(
    async (
      transcribedText: string,
      sourceLang: LanguageCode = sourceLanguage,
      durationSeconds = 1
    ) => {
      const clean = transcribedText.trim();
      if (!clean) return;
      sourceTextLanguageRef.current = sourceLang;
      setSourceText(clean);
      setTranslationError("");

      let translated = "";
      try {
        translated = await translateText({
          apiBaseUrl: publicApiBase,
          bearerToken: session.bearerToken,
          guestTtsToken: session.guestTtsToken,
          text: clean,
          fromLanguage: getPromptLanguageName(sourceLang),
          toLanguage: getPromptLanguageName(targetLanguage),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Traduction indisponible.";
        setTranslationError(
          /forbidden|403|acces refuse|accès refusé/i.test(message)
            ? "Traduction refusée pour ce compte. Le texte source reste visible."
            : `Traduction indisponible, fallback texte source: ${message}`
        );
      }
      const finalCaption = translated.trim() || clean;
      if (!finalCaption) {
        throw new Error("Empty translation.");
      }

      setCaptionText(finalCaption);
      setTranslationError("");
      if (ttsEnabled) {
        void speakText(finalCaption);
      }
      if (captionsEnabled) {
        await publishCaption({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roomId: session.roomId,
          from: session.identity,
          text: finalCaption,
          sourceText: clean,
          sourceLang,
          targetLang: targetLanguage,
          durationSeconds: Math.max(1, Math.min(300, Math.floor(durationSeconds || 1))),
          timestamp: Date.now(),
        });
      }
      if (coachConversationEnabled) {
        void requestCoachPartnerReply(clean, sourceLang);
      }
    },
    [
      captionsEnabled,
      coachConversationEnabled,
      getPromptLanguageName,
      publishCaption,
      requestCoachPartnerReply,
      session.bearerToken,
      session.guestTtsToken,
      session.identity,
      session.roomId,
      publicApiBase,
      isHostSession,
      sourceLanguage,
      speakText,
      targetLanguage,
      ttsEnabled,
    ]
  );

  const transcribeWithFallbackLanguage = useCallback(
    async (audioUri: string, sourceLang?: LanguageCode) => {
      let sawScriptMismatch = false;
      const normalize = (candidate: string) => {
        const trimmed = candidate.trim();
        if (!trimmed) return "";
        if (isKnownBadTranscript(trimmed)) return "";
        if (sourceLang && isLikelyLowSignalTranscript(trimmed, sourceLang)) return "";
        if (sourceLang && isLikelyScriptMismatchTranscript(trimmed, sourceLang)) {
          sawScriptMismatch = true;
          return "";
        }
        return trimmed;
      };

      const firstPass = await transcribeAudio({
        apiBaseUrl: publicApiBase,
        bearerToken: session.bearerToken,
        guestTtsToken: session.guestTtsToken,
        audioUri,
        language: sourceLang,
      });
      const normalizedFirstPass = normalize(firstPass);
      if (normalizedFirstPass) return normalizedFirstPass;

      // Fallback sans hint langue pour éviter les faux "No speech detected" sur iOS.
      const secondPass = await transcribeAudio({
        apiBaseUrl: publicApiBase,
        bearerToken: session.bearerToken,
        guestTtsToken: session.guestTtsToken,
        audioUri,
      });
      const normalizedSecondPass = normalize(secondPass);
      if (normalizedSecondPass) return normalizedSecondPass;
      if (sawScriptMismatch) {
        throw new Error("Source language mismatch.");
      }
      return "";
    },
    [publicApiBase, session.bearerToken, session.guestTtsToken]
  );

  const stopRecordingAndTranslate = useCallback(async () => {
    if (stopTranslateInFlightRef.current) return;
    stopTranslateInFlightRef.current = true;
    try {
      if (realtimeEnabled) {
        await publishTalkieLock("release");
        return;
      }
      const hasManualRecordingStarted = manualRecordingStartedAtRef.current > 0;
      const recorderLooksActive = recordingActive || hasManualRecordingStarted;
      if (!recorderLooksActive) {
        await publishTalkieLock("release");
        return;
      }
      setTalkieUiState("stopping");
      if (translationControlsDisabled) {
        setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
        await publishTalkieLock("release");
        return;
      }
      setTranslationError("");
      setTranslationBusy(true);
      const elapsedMs = manualRecordingStartedAtRef.current
        ? Date.now() - manualRecordingStartedAtRef.current
        : 0;
      const durationMs = Math.max(recorderState.durationMillis || 0, elapsedMs);
      if (durationMs > 0 && durationMs < MANUAL_MIN_RECORDING_MS) {
        throw new Error("Parle au moins une seconde avant de lancer la traduction.");
      }
      const baselineUri =
        recordingStartUriRef.current || recorder.uri || recorderUrlRef.current || "";
      try {
        await recorder.stop();
      } catch {}
      await wait(280);
      const uri = await resolveFreshRecordingUri(baselineUri);
      await setPlaybackAudioMode();
      if (!uri) {
        throw new Error("Recording URI missing.");
      }
      if (baselineUri && uri === baselineUri) {
        throw new Error("Audio non finalise. Relache puis reessaie.");
      }
      lastProcessedRecordingUriRef.current = uri;
      const stable = await stabilizeRecordedAudioUri(uri, MANUAL_MIN_SEGMENT_BYTES);
      if (stable.size < MANUAL_MIN_SEGMENT_BYTES) {
        throw new Error("Audio invalide ou trop court. Parle 1-2 secondes puis réessaie.");
      }

      const transcribed = await transcribeWithFallbackLanguage(
        stable.uri,
        sourceLanguage
      );
      if (!transcribed || isLikelyLowSignalTranscript(transcribed, sourceLanguage)) {
        throw new Error("No speech detected.");
      }
      const usageSeconds = Math.max(1, Math.min(300, Math.floor(durationMs / 1000) || 1));
      const draft = transcribed.trim();
      if (!draft || isKnownBadTranscript(draft)) {
        throw new Error("No speech detected.");
      }
      setSourceText(draft);
      sourceTextLanguageRef.current = sourceLanguage;
      setManualDraftText(draft);
      setManualDraftDurationSeconds(usageSeconds);
      setManualDraftSourceLanguage(sourceLanguage);
      setManualDraftVisible(true);
      setTranslationPanelOpen(true);
      setTranslationError("");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err || "");
      if (/no speech detected/i.test(raw)) {
        setSourceText("");
        sourceTextLanguageRef.current = sourceLanguage;
        setCaptionText("");
        setManualDraftVisible(false);
        setManualDraftText("");
        setManualDraftDurationSeconds(1);
        setManualDraftSourceLanguage(sourceLanguage);
        setManualDraftSending(false);
      }
      setTranslationError(toFriendlyAudioError(err));
    } finally {
      manualRecordingStartedAtRef.current = 0;
      manualStartInFlightRef.current = false;
      pendingStopAfterStartRef.current = false;
      recordingStartUriRef.current = "";
      try {
        await setPlaybackAudioMode();
      } catch {}
      await restoreRoomMicAfterRecorder();
      await publishTalkieLock("release");
      setTranslationBusy(false);
      setTalkieUiState("idle");
      stopTranslateInFlightRef.current = false;
    }
  }, [
    publishTalkieLock,
    effectiveTranslationLockMessage,
    recorder,
    resolveFreshRecordingUri,
    realtimeEnabled,
    recordingActive,
    restoreRoomMicAfterRecorder,
    recorderState.durationMillis,
    setPlaybackAudioMode,
    sourceLanguage,
    stabilizeRecordedAudioUri,
    translationControlsDisabled,
    transcribeWithFallbackLanguage,
  ]);

  const cancelManualDraft = useCallback(() => {
    setManualDraftVisible(false);
    setManualDraftText("");
    setManualDraftDurationSeconds(1);
    setManualDraftSourceLanguage(sourceLanguage);
    setManualDraftSending(false);
  }, [sourceLanguage]);

  const confirmManualDraftSend = useCallback(async () => {
    const draft = manualDraftText.trim();
    if (!draft || manualDraftSending) return;
    if (translationControlsDisabled) {
      setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
      return;
    }
    const usageSeconds = Math.max(1, Math.min(300, Math.floor(manualDraftDurationSeconds || 1)));

    setManualDraftSending(true);
    setTranslationBusy(true);
    setTranslationError("");
    try {
      const consumed = await consumeTranslationSeconds(usageSeconds, "local");
      if (!consumed) {
        setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
        return;
      }
      await processTranscript(draft, manualDraftSourceLanguage, usageSeconds);
      setManualDraftVisible(false);
      setManualDraftText("");
      setManualDraftDurationSeconds(1);
      setManualDraftSourceLanguage(sourceLanguage);
    } catch (err) {
      setTranslationError(toFriendlyAudioError(err));
    } finally {
      setManualDraftSending(false);
      setTranslationBusy(false);
    }
  }, [
    consumeTranslationSeconds,
    effectiveTranslationLockMessage,
    manualDraftDurationSeconds,
    manualDraftSending,
    manualDraftSourceLanguage,
    manualDraftText,
    processTranscript,
    sourceLanguage,
    translationControlsDisabled,
  ]);

  const handleManualPushToTalkPressIn = useCallback(() => {
    if (realtimeEnabled || translationBusy) return;
    if (talkieUiState !== "idle") return;
    if (translationControlsDisabled) {
      setRecordingError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
      return;
    }
    if (isTalkieLockedByOther) {
      const holder = talkieLockHolderName || "un interlocuteur";
      setRecordingError(`Talkie occupé: ${holder} parle en ce moment.`);
      return;
    }
    setManualDraftVisible(false);
    setManualDraftText("");
    setManualDraftDurationSeconds(1);
    setManualDraftSourceLanguage(sourceLanguage);
    setManualDraftSending(false);
    manualPushToTalkPressedRef.current = true;
    pendingStopAfterStartRef.current = false;
    manualStartInFlightRef.current = true;
    setTalkieUiState("starting");
    void (async () => {
      await publishTalkieLock("claim");
      const started = await startRecording();
      manualStartInFlightRef.current = false;
      if (!started) {
        manualPushToTalkPressedRef.current = false;
        pendingStopAfterStartRef.current = false;
        setTalkieUiState("idle");
        await publishTalkieLock("release");
        return;
      }
      setTalkieUiState("recording");
      if (!manualPushToTalkPressedRef.current || pendingStopAfterStartRef.current) {
        pendingStopAfterStartRef.current = false;
        await stopRecordingAndTranslate();
      }
    })();
  }, [
    effectiveTranslationLockMessage,
    isTalkieLockedByOther,
    publishTalkieLock,
    realtimeEnabled,
    startRecording,
    stopRecordingAndTranslate,
    talkieLockHolderName,
    talkieUiState,
    sourceLanguage,
    translationControlsDisabled,
    translationBusy,
  ]);

  const toggleRealtimeMode = useCallback(() => {
    if (translationControlsDisabled) {
      setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
      return;
    }
    if (!REALTIME_TRANSLATION_ENABLED) {
      setTranslationError("Mode voix naturelle desactive dans cette version.");
      return;
    }
    if (!realtimeEnabled && !realtimeConfigured) {
      setTranslationError(
        "Voix naturelle indisponible: configure EXPO_PUBLIC_REALTIME_URL."
      );
      return;
    }
    setRecordingError("");
    setTranslationError("");
    if (!realtimeEnabled) {
      if (forceSegmentedRealtime) {
        setForceSegmentedRealtime(false);
      }
      manualPushToTalkPressedRef.current = false;
      void publishTalkieLock("release");
    }
    setRealtimeEnabled((current) => !current);
  }, [
    effectiveTranslationLockMessage,
    forceSegmentedRealtime,
    publishTalkieLock,
    realtimeEnabled,
    realtimeConfigured,
    translationControlsDisabled,
  ]);

  const handleManualPushToTalkPressOut = useCallback(() => {
    manualPushToTalkPressedRef.current = false;
    if (manualStartInFlightRef.current) {
      pendingStopAfterStartRef.current = true;
      setTalkieUiState("stopping");
      return;
    }
    if (!recordingActive && manualRecordingStartedAtRef.current <= 0) {
      setTalkieUiState("idle");
      return;
    }
    setTalkieUiState("stopping");
    void stopRecordingAndTranslate();
  }, [recordingActive, stopRecordingAndTranslate]);

  const enqueueRealtimeSegment = useCallback(
    (uri: string) => {
      const next: RealtimeSegment = {
        id: ++realtimeSegmentIdRef.current,
        uri,
        capturedAt: Date.now(),
        sourceLang: sourceLanguage,
      };
      realtimeQueueRef.current.push(next);
      if (realtimeQueueRef.current.length > REALTIME_MAX_QUEUE) {
        realtimeQueueRef.current.shift();
        setTranslationError("Realtime surcharge: un segment audio a ete ignore pour garder une faible latence.");
      }
      setRealtimeQueueDepth(realtimeQueueRef.current.length);
    },
    [sourceLanguage]
  );

  const processRealtimeQueue = useCallback(
    async (isCancelled: () => boolean) => {
      while (!isCancelled() && (realtimeLoopRef.current || realtimeQueueRef.current.length > 0)) {
        const segment = realtimeQueueRef.current.shift() || null;
        setRealtimeQueueDepth(realtimeQueueRef.current.length);
        if (!segment) {
          await wait(50);
          continue;
        }

        try {
          const transcribed = await transcribeWithFallbackLanguage(
            segment.uri,
            segment.sourceLang
          );
          const clean = transcribed.trim();
          if (!clean) continue;
          const incremental = extractIncrementalSpeech(lastTranscriptRef.current, clean);
          lastTranscriptRef.current = clean;
          if (!incremental) continue;

          if (isHostSession) {
            const consumed = await consumeTranslationSeconds(1, "local");
            if (!consumed) {
              setTranslationError(effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT);
              setRealtimeEnabled(false);
              break;
            }
          }
          await processTranscript(incremental, segment.sourceLang, 1);
          setRealtimeLatencyMs(Date.now() - segment.capturedAt);
          setRealtimeStatus("running");
        } catch (err) {
          const friendlyError = toFriendlyAudioError(err);
          if (/audio invalide|trop court|no speech/i.test(friendlyError)) {
            setRealtimeStatus("running");
            continue;
          }
          setRealtimeStatus("error");
          setTranslationError(friendlyError);
        }
      }
    },
    [
      consumeTranslationSeconds,
      effectiveTranslationLockMessage,
      isHostSession,
      processTranscript,
      transcribeWithFallbackLanguage,
    ]
  );

  const captureRealtimeLoop = useCallback(
    async (isCancelled: () => boolean) => {
      while (!isCancelled() && realtimeLoopRef.current) {
        const queueDepth = realtimeQueueRef.current.length;
        const segmentMs =
          queueDepth >= 3 ? Math.max(500, REALTIME_SEGMENT_MS - 200) : REALTIME_SEGMENT_MS;
        const gapMs =
          queueDepth >= 3 ? Math.max(10, REALTIME_SEGMENT_GAP_MS - 20) : REALTIME_SEGMENT_GAP_MS;

        await startRecorderSafely();

        await wait(segmentMs);
        try {
          await recorder.stop();
        } catch {}

        const uri = recorder.uri || recorderUrlRef.current || "";
        if (uri) {
          const stable = await stabilizeRecordedAudioUri(uri, REALTIME_MIN_SEGMENT_BYTES);
          if (stable.size < REALTIME_MIN_SEGMENT_BYTES) {
            setRealtimeStatus("running");
          } else {
            enqueueRealtimeSegment(stable.uri);
          }
        }

        if (!isCancelled() && realtimeLoopRef.current) {
          await wait(gapMs);
        }
      }
    },
    [enqueueRealtimeSegment, recorder, stabilizeRecordedAudioUri, startRecorderSafely]
  );

  useEffect(() => {
    if (!realtimeEnabled) {
      realtimeLoopRef.current = false;
      realtimeQueueRef.current = [];
      setRealtimeQueueDepth(0);
      setRealtimeStatus("idle");
      setRealtimeEngine(realtimeNativeEnabled ? "native" : "segmented");
      setRealtimeLatencyMs(null);
      setTranslationBusy(false);
      void stopNativeRealtimeSession();
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    realtimeLoopRef.current = false;
    realtimeQueueRef.current = [];
    lastTranscriptRef.current = "";
    setRealtimeQueueDepth(0);
    setRealtimeLatencyMs(null);
    setRealtimeStatus("running");
    setTranslationError("");
    setRecordingError("");
    setTranslationBusy(true);

    const runRealtime = async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone permission denied.");
      }
      await pauseRoomMicForRecorder();
      if (realtimeNativeEnabled) {
        setRealtimeEngine("native");
        try {
          await runNativeRealtimeSession(isCancelled);
          return;
        } catch (nativeError) {
          if (isCancelled()) return;
          await stopNativeRealtimeSession().catch(() => {});
          setForceSegmentedRealtime(true);
          setTranslationError(
            `Live natif indisponible, bascule en mode compatibilite: ${toFriendlyAudioError(
              nativeError
            )}`
          );
          setRealtimeStatus("running");
        }
      }
      setRealtimeEngine("segmented");
      realtimeLoopRef.current = true;
      await Promise.all([captureRealtimeLoop(isCancelled), processRealtimeQueue(isCancelled)]);
    };

    void runRealtime().catch((err) => {
      if (cancelled) return;
      setRealtimeStatus("error");
      setTranslationError(toFriendlyAudioError(err));
      setRealtimeEnabled(false);
    });

    return () => {
      cancelled = true;
      realtimeLoopRef.current = false;
      void stopNativeRealtimeSession();
      void recorder.stop().catch(() => {});
      void setPlaybackAudioMode().catch(() => {});
      void restoreRoomMicAfterRecorder();
      setTranslationBusy(false);
    };
  }, [
    captureRealtimeLoop,
    pauseRoomMicForRecorder,
    processRealtimeQueue,
    realtimeNativeEnabled,
    realtimeEnabled,
    recorder,
    restoreRoomMicAfterRecorder,
    setPlaybackAudioMode,
    stopNativeRealtimeSession,
  ]);

  useEffect(() => {
    if (!isHostSession || !realtimeEnabled) return;
    if (captionsEnabled) return;
    setCaptionsEnabled(true);
  }, [captionsEnabled, isHostSession, realtimeEnabled]);

  useEffect(() => {
    if (!isHostSession) return;
    if (!session.roomId?.trim()) return;
    if (!session.bearerToken?.trim()) return;

    let cancelled = false;
    const action = realtimeEnabled ? "ensure" : "release";

    const syncTranslatorWorker = async () => {
      try {
        const response = await fetch(
          `${publicApiBase}/api/livekit/translator/session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.bearerToken!.trim()}`,
            },
            body: JSON.stringify({
              action,
              room: session.roomId,
              sourceLanguage,
              targetLanguage,
              voice: realtimeVoiceId,
            }),
          }
        );
        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(raw || `Translator orchestrator error (${response.status})`);
        }
      } catch (error) {
        if (cancelled) return;
        if (realtimeEnabled) {
          setTranslationError(
            error instanceof Error
              ? `Worker traducteur indisponible: ${error.message}`
              : "Worker traducteur indisponible."
          );
        }
      }
    };

    void syncTranslatorWorker();

    return () => {
      cancelled = true;
      if (!realtimeEnabled) return;
      void (async () => {
        try {
          await fetch(
            `${publicApiBase}/api/livekit/translator/session`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.bearerToken!.trim()}`,
              },
              body: JSON.stringify({
                action: "release",
                room: session.roomId,
              }),
            }
          );
        } catch {}
      })();
    };
  }, [
    realtimeEnabled,
    realtimeVoiceId,
    session.bearerToken,
    isHostSession,
    session.roomId,
    publicApiBase,
    sourceLanguage,
    targetLanguage,
  ]);

  const cancelRecording = useCallback(async () => {
    manualPushToTalkPressedRef.current = false;
    manualStartInFlightRef.current = false;
    pendingStopAfterStartRef.current = false;
    stopTranslateInFlightRef.current = false;
    setTalkieUiState("idle");
    await publishTalkieLock("release");
    if (realtimeEnabled) {
      setRealtimeEnabled(false);
      return;
    }
    if (!recordingActive) return;
    try {
      await recorder.stop();
    } catch {}
    manualRecordingStartedAtRef.current = 0;
    recordingStartUriRef.current = "";
    await setPlaybackAudioMode();
    await restoreRoomMicAfterRecorder();
  }, [
    realtimeEnabled,
    recordingActive,
    recorder,
    publishTalkieLock,
    restoreRoomMicAfterRecorder,
    setPlaybackAudioMode,
  ]);

  const toggleMicrophone = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : "Mic toggle failed.");
    }
  }, [isMicrophoneEnabled, localParticipant]);

  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    try {
      if (isCameraEnabled) {
        await localParticipant.setCameraEnabled(false);
      } else {
        await localParticipant.setCameraEnabled(true, { facingMode: cameraFacingMode });
      }
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : "Camera toggle failed.");
    }
  }, [cameraFacingMode, isCameraEnabled, localParticipant]);

  const toggleCameraFacing = useCallback(async () => {
    if (!localParticipant) return;
    const nextFacingMode: CameraFacingMode =
      cameraFacingMode === "user" ? "environment" : "user";

    setCameraFacingMode(nextFacingMode);
    setTranslationError("");

    if (!isCameraEnabled) {
      return;
    }
    try {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const videoTrack = publication?.videoTrack;
      if (videoTrack) {
        await videoTrack.restartTrack({ facingMode: nextFacingMode });
      } else {
        await localParticipant.setCameraEnabled(true, { facingMode: nextFacingMode });
      }
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : "Camera lens switch failed.");
    }
  }, [cameraFacingMode, isCameraEnabled, localParticipant]);

  const applyVirtualBackgroundEffect = useCallback(async () => {
    if (!localParticipant) return false;

    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    const localVideoTrack = publication?.videoTrack as unknown as {
      mediaStreamTrack?: {
        _setVideoEffects?: (names: string[]) => void;
      };
    };
    const mediaStreamTrack = localVideoTrack?.mediaStreamTrack;
    const setVideoEffects =
      mediaStreamTrack &&
      typeof mediaStreamTrack._setVideoEffects === "function"
        ? mediaStreamTrack._setVideoEffects.bind(mediaStreamTrack)
        : null;
    if (!setVideoEffects) return false;

    const enableVirtualBackground = backgroundMode === "ai" && Boolean(aiBackgroundUrl.trim());

    try {
      await configureNativeVirtualBackground({
        enabled: enableVirtualBackground,
        imageUrl: enableVirtualBackground ? aiBackgroundUrl.trim() : "",
      });
      setVideoEffects(enableVirtualBackground ? [VIRTUAL_BACKGROUND_EFFECT_NAME] : []);
      return true;
    } catch (err) {
      setBackgroundError(
        err instanceof Error
          ? err.message
          : "Impossible d'appliquer le fond virtuel sur le flux video."
      );
      return false;
    }
  }, [aiBackgroundUrl, backgroundMode, localParticipant]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Retry briefly while camera publication is still initializing/restarting.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (cancelled) return;
        const applied = await applyVirtualBackgroundEffect();
        if (applied) return;
        await wait(150);
      }
    };

    if (!isCameraEnabled) {
      void configureNativeVirtualBackground({ enabled: false, imageUrl: "" });
      return;
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    aiBackgroundUrl,
    applyVirtualBackgroundEffect,
    backgroundMode,
    cameraFacingMode,
    isCameraEnabled,
  ]);

  const generateAiBackground = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setBackgroundError("Prompt fond DALL·E manquant.");
      return;
    }

    setBackgroundError("");
    setAiBackgroundBusy(true);
    setAiBackgroundStatus("Creation du fond DALL·E...");
    try {
      const createRes = await fetch(`${publicApiBase}/api/dalle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      if (!createRes.ok) {
        throw new Error(await readHttpError(createRes));
      }
      const createBody = (await createRes.json()) as { jobId?: string };
      const jobId = createBody.jobId?.trim() || "";
      if (!jobId) {
        throw new Error("Job DALL·E invalide.");
      }

      let done = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await wait(2000);
        const statusRes = await fetch(
          `${publicApiBase}/api/dalle?jobId=${encodeURIComponent(jobId)}`
        );
        if (!statusRes.ok) {
          throw new Error(await readHttpError(statusRes));
        }
        const statusBody = (await statusRes.json()) as {
          status?: string;
          errorMessage?: string;
        };
        const status = (statusBody.status || "pending").toLowerCase();
        if (status === "complete") {
          done = true;
          break;
        }
        if (status === "error") {
          throw new Error(statusBody.errorMessage || "Generation DALL·E en erreur.");
        }
        setAiBackgroundStatus(`DALL·E ${status}...`);
      }

      if (!done) {
        throw new Error("Generation DALL·E trop longue. Reessaie.");
      }

      const nextUrl =
        `${publicApiBase}/api/dalle/image?jobId=${encodeURIComponent(jobId)}&t=${Date.now()}`;
      setAiBackgroundUrl(nextUrl);
      setBackgroundMode("ai");
      setAiBackgroundStatus("Fond DALL·E prêt.");
    } catch (err) {
      setBackgroundError(err instanceof Error ? err.message : "Echec generation fond DALL·E.");
      setAiBackgroundStatus("");
    } finally {
      setAiBackgroundBusy(false);
    }
  }, [aiPrompt, publicApiBase]);

  const connectionPhaseLabel =
    connectionPhase === "connected"
      ? "Stable"
      : connectionPhase === "reconnecting"
        ? "Reconnecting"
        : "Signal...";
  const qualityLabel = localConnectionQuality.toUpperCase();
  const focusModeLabel = pinnedTrackKey
    ? "Pinned"
    : followActiveSpeaker
      ? "Auto speaker"
      : "Manual";
  const isChatVideoCall = isChatCall && !isChatAudioCall;
  const coachConversationLayoutActive = coachConversationEnabled && !isChatCall;
  const useManualDraftFullscreen = Platform.OS === "ios";

  if (isChatAudioCall) {
    return (
      <View style={styles.roomRoot}>
        <View style={styles.audioCallStage}>
          <View style={styles.audioCallCard}>
            <Text style={styles.audioCallTitle}>Appel audio chat</Text>
            <Text style={styles.audioCallSubtitle}>
              {connected ? "Connecté" : "Connexion..."} · Q:{qualityLabel}
            </Text>
            <Text style={styles.audioCallSubtitle}>
              Interlocuteur{remoteParticipantCount > 1 ? "s" : ""}: {remoteParticipantCount}
            </Text>
            <Text style={styles.audioCallHint}>
              {remoteParticipantCount
                ? "Canal audio actif. Tu peux parler normalement."
                : "En attente de l’interlocuteur..."}
            </Text>
          </View>

          <View style={styles.audioCallControls}>
            <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
              <Text style={styles.controlButtonText}>{isMicrophoneEnabled ? "Mic on" : "Mic off"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (isChatVideoCall) {
    const focusedKey = focusedTrack ? trackKey(focusedTrack) : "";
    const showPreview =
      Boolean(previewTrack) &&
      (!focusedTrack || trackKey(previewTrack!) !== focusedKey);

    return (
      <View style={styles.roomRoot}>
        <View style={styles.chatVideoStage}>
          {focusedTrack ? (
            <Pressable
              style={styles.chatVideoMain}
              onPress={() => setFocusedTrackKey(trackKey(focusedTrack))}
            >
              <VideoTrack
                trackRef={focusedTrack}
                style={styles.chatVideoTrack}
                mirror={focusedTrack.participant.isLocal}
              />
              <View style={styles.focusedBadge}>
                <Text style={styles.focusedBadgeText}>{getLabel(focusedTrack)}</Text>
              </View>
            </Pressable>
          ) : (
            <View style={styles.videoPlaceholder}>
              <Text style={styles.placeholderText}>Aucune piste camera pour le moment.</Text>
            </View>
          )}

          {showPreview && previewTrack ? (
            <Pressable
              style={styles.chatVideoPreview}
              onPress={() => setFocusedTrackKey(trackKey(previewTrack))}
            >
              <VideoTrack
                trackRef={previewTrack}
                style={styles.chatVideoPreviewTrack}
                mirror={previewTrack.participant.isLocal}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.chatVideoStatusRow}>
          <Text style={styles.audioCallSubtitle}>
            {connected ? "Connecté" : "Connexion..."} · Q:{qualityLabel}
          </Text>
          <Text style={styles.audioCallSubtitle}>
            Interlocuteur{remoteParticipantCount > 1 ? "s" : ""}: {remoteParticipantCount}
          </Text>
        </View>

        <View style={styles.audioCallControls}>
          <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
            <Text style={styles.controlButtonText}>{isMicrophoneEnabled ? "Mic on" : "Mic off"}</Text>
          </Pressable>
          <Pressable style={styles.controlButton} onPress={toggleCamera}>
            <Text style={styles.controlButtonText}>{isCameraEnabled ? "Cam on" : "Cam off"}</Text>
          </Pressable>
          <Pressable style={styles.controlButton} onPress={toggleCameraFacing}>
            <Text style={styles.controlButtonText}>
              {cameraFacingMode === "user" ? "Front camera" : "Back camera"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.roomRoot}>
      {!immersiveMode && !coachConversationLayoutActive ? (
        <View style={[styles.connectionBadge, videoFullscreen && styles.connectionBadgeFloating]}>
          <View style={styles.connectionRow}>
            <Text style={styles.connectionText}>
              {connected ? "Connected" : "Connecting..."} · {connectionPhaseLabel} · Q:{qualityLabel} ·
              Camera {isCameraEnabled ? "on" : "off"} · Tracks {renderedTracks.length} · {focusModeLabel}
              {activeSpeakerIdentity ? ` · Speaker ${activeSpeakerIdentity}` : ""}
            </Text>
            <Pressable
              style={styles.stageModeButton}
              onPress={() => setImmersiveMode(true)}
            >
              <Text style={styles.stageModeButtonText}>Plein ecran</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {!coachConversationLayoutActive ? (
      <View
        style={[
          styles.videoStage,
          videoFullscreen && styles.videoStageFullscreen,
          immersiveMode && styles.videoStageImmersive,
          isVeryCompactPhone && styles.videoStageCompact,
        ]}
      >
        <View
          style={[
            styles.stageBackgroundLayer,
            { backgroundColor: selectedBackgroundPreset.color },
          ]}
        >
          {backgroundMode === "ai" && aiBackgroundUrl ? (
            <Image
              source={{ uri: aiBackgroundUrl }}
              style={styles.stageBackgroundImage}
              resizeMode="cover"
            />
          ) : null}
        </View>

        {focusedTrack ? (
          <View style={[styles.focusedVideoCard, immersiveMode && styles.focusedVideoCardImmersive]}>
            <Pressable
              style={styles.focusedVideoPressable}
              onPress={() => {
                setFocusedTrackKey(trackKey(focusedTrack));
                setImmersiveMode((value) => !value);
              }}
              onLongPress={() => {
                const key = trackKey(focusedTrack);
                setPinnedTrackKey((current) => (current === key ? null : key));
              }}
            >
              <VideoTrack
                trackRef={focusedTrack}
                style={isVeryCompactPhone ? styles.focusedVideoTrackCompact : styles.focusedVideoTrack}
                mirror={focusedTrack.participant.isLocal}
              />
              {!immersiveMode ? (
                <View style={styles.focusedBadge}>
                  <Text style={styles.focusedBadgeText}>
                    {getLabel(focusedTrack)}
                    {pinnedTrackKey === trackKey(focusedTrack) ? " · PIN" : ""}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            {previewTrack && !immersiveMode ? (
              <Pressable
                style={[
                  styles.localPreviewCard,
                  activeSpeakerIdentity === previewTrack.participant.identity &&
                    styles.trackCardActiveSpeaker,
                  pinnedTrackKey === trackKey(previewTrack) && styles.trackCardPinned,
                ]}
                onPress={() => setFocusedTrackKey(trackKey(previewTrack))}
                onLongPress={() => {
                  const key = trackKey(previewTrack);
                  setPinnedTrackKey((current) => (current === key ? null : key));
                }}
              >
                <VideoTrack
                  trackRef={previewTrack}
                  style={styles.localPreviewTrack}
                  mirror={previewTrack.participant.isLocal}
                />
                <Text style={styles.localPreviewText}>{getLabel(previewTrack)}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.placeholderText}>Aucune piste camera pour le moment.</Text>
          </View>
        )}

        {(sourceText || captionText) && (
          <View
            pointerEvents="none"
            style={[
              styles.subtitleOverlay,
              immersiveMode && styles.subtitleOverlayImmersive,
            ]}
          >
            {sourceText ? (
              <View style={styles.subtitleSourceBubble}>
                <Text style={styles.subtitleLabel}>Source ({sourceLanguageLabel})</Text>
                <Text style={[styles.subtitleSourceText, sourceLanguageIsRtl && styles.rtlText]}>
                  {sourceText}
                </Text>
              </View>
            ) : null}
            {captionText ? (
              <View style={styles.subtitleTargetBubble}>
                <Text style={styles.subtitleLabel}>Traduction ({targetLanguageLabel})</Text>
                <Text style={[styles.subtitleTargetText, targetLanguageIsRtl && styles.rtlText]}>
                  {captionText}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
      ) : null}

      {!immersiveMode ? (
        <View
          style={[
            styles.panelDock,
            videoFullscreen &&
              !keyboardVisible &&
              !manualDraftVisible &&
              !coachConversationLayoutActive &&
              styles.panelDockFloating,
            isCompactPhone && styles.panelDockCompact,
            keyboardVisible &&
              !coachConversationLayoutActive &&
              !manualDraftVisible &&
              styles.panelDockKeyboardRaised,
            coachConversationLayoutActive && styles.panelDockCoachMode,
          ]}
        >
        {switchTracks.length && !coachConversationLayoutActive ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.quickStrip}
            contentContainerStyle={styles.quickStripRow}
          >
            {switchTracks.map((item) => {
              const key = trackKey(item);
              return (
                <Pressable
                  key={`quick-${key}`}
                  style={[
                    styles.quickThumbCard,
                    activeSpeakerIdentity === item.participant.identity &&
                      styles.trackCardActiveSpeaker,
                    pinnedTrackKey === key && styles.trackCardPinned,
                  ]}
                  onPress={() => setFocusedTrackKey(key)}
                  onLongPress={() =>
                    setPinnedTrackKey((current) => (current === key ? null : key))
                  }
                >
                  <VideoTrack
                    trackRef={item}
                    style={styles.quickThumbTrack}
                    mirror={item.participant.isLocal}
                  />
                  <Text style={styles.quickThumbText}>{getLabel(item)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {!coachConversationLayoutActive && shouldShowAccordionPanel("controls") ? (
        <View style={styles.accordionCard}>
          <Pressable
            style={styles.accordionHeader}
            onPress={() => toggleAccordionPanel("controls")}
          >
            <View style={styles.accordionHeaderText}>
              <Text style={styles.accordionTitle}>Controles</Text>
              <Text style={styles.accordionMeta}>
                {coachConversationLayoutActive
                  ? `${isMicrophoneEnabled ? "Mic on" : "Mic off"} · Coach IA actif`
                  : `${isMicrophoneEnabled ? "Mic on" : "Mic off"} · ${isCameraEnabled ? "Cam on" : "Cam off"} · ${
                      cameraFacingMode === "user" ? "Front camera" : "Back camera"
                    }`}
              </Text>
            </View>
            <Text style={styles.accordionIcon}>{controlsOpen ? "−" : "+"}</Text>
          </Pressable>

          {controlsOpen ? (
            <View style={styles.controls}>
              <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
                <Text style={styles.controlButtonText}>{isMicrophoneEnabled ? "Mic on" : "Mic off"}</Text>
              </Pressable>
              {!coachConversationLayoutActive ? (
                <Pressable style={styles.controlButton} onPress={toggleCamera}>
                  <Text style={styles.controlButtonText}>{isCameraEnabled ? "Cam on" : "Cam off"}</Text>
                </Pressable>
              ) : null}
              {!coachConversationLayoutActive ? (
                <Pressable style={styles.controlButton} onPress={toggleCameraFacing}>
                  <Text style={styles.controlButtonText}>
                    {cameraFacingMode === "user" ? "Front camera" : "Back camera"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.controlButton, followActiveSpeaker && styles.realtimeButton]}
                onPress={() => setFollowActiveSpeaker((value) => !value)}
              >
                <Text style={styles.controlButtonText}>
                  Auto Speaker {followActiveSpeaker ? "On" : "Off"}
                </Text>
              </Pressable>
              {isCoachSession ? (
                <Pressable
                  onPress={() => setCoachConversationEnabled((value) => !value)}
                  disabled={!canUseCoachConversation}
                  style={[
                    styles.controlButton,
                    coachConversationEnabled && styles.realtimeButton,
                    !canUseCoachConversation && styles.controlButtonDisabled,
                  ]}
                >
                  <Text style={styles.controlButtonText}>
                    Coach conversation IA {coachConversationEnabled ? "On" : "Off"}
                  </Text>
                </Pressable>
              ) : null}
              {focusedTrack ? (
                <Pressable
                  style={[styles.controlButton, pinnedTrackKey && styles.realtimeButton]}
                  onPress={() => {
                    const key = trackKey(focusedTrack);
                    setPinnedTrackKey((current) => (current === key ? null : key));
                  }}
                >
                  <Text style={styles.controlButtonText}>
                    {pinnedTrackKey === trackKey(focusedTrack) ? "Unpin Focus" : "Pin Focus"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        ) : null}

        {shouldShowAccordionPanel("translation") ? (
        <View
          style={[
            styles.accordionCard,
            coachConversationLayoutActive && styles.accordionCardCoachMode,
          ]}
        >
          {!coachConversationLayoutActive ? (
            <Pressable
              style={styles.accordionHeader}
              onPress={() => toggleAccordionPanel("translation")}
            >
              <View style={styles.accordionHeaderText}>
                <Text style={styles.accordionTitle}>Traduction</Text>
                <Text style={styles.accordionMeta}>{sourceLanguageLabel} → {targetLanguageLabel} · Talkie</Text>
              </View>
              <Text style={styles.accordionIcon}>{translationPanelOpen ? "−" : "+"}</Text>
            </Pressable>
          ) : null}

          {translationPanelOpen || coachConversationLayoutActive ? (
            <ScrollView
              style={[
                styles.translationPanelScroll,
                coachConversationLayoutActive && styles.translationPanelScrollCoach,
              ]}
              contentContainerStyle={styles.translationPanel}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {!coachConversationLayoutActive ? (
                <>
                  <Text style={styles.panelTitle}>Traduction</Text>
                  <View style={styles.translationInfoHeader}>
                    <Text style={styles.realtimeStatus}>Talkie traduction actif</Text>
                    <Pressable
                      onPress={() => setShowTranslationInfo((current) => !current)}
                      style={styles.translationInfoButton}
                    >
                      <Text style={styles.translationInfoButtonText}>i</Text>
                    </Pressable>
                  </View>
                  {showTranslationInfo ? (
                    <View style={styles.translationInfoBox}>
                      <Text style={styles.realtimeStatus}>
                        Maintiens "Maintenir pour parler", parle, puis relache pour traduire.
                      </Text>
                      <Text style={styles.realtimeStatus}>
                        Les sous-titres sont partages avec tous les participants.
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {isCoachSession ? (
              <View style={styles.coachConversationCard}>
                <View style={styles.coachConversationHeader}>
                  <Text style={styles.panelTitle}>Coach conversation IA</Text>
                  <Text style={styles.realtimeStatus}>
                    {coachConversationEnabled ? "Actif" : "Inactif"}
                  </Text>
                </View>
                <Text style={styles.realtimeStatus}>
                  Entrainement avec Coach conversation IA (reponse courte + relance).
                </Text>
                {!canUseCoachConversation ? (
                  <Text style={styles.realtimeStatus}>
                    Disponible en mode hote connecte.
                  </Text>
                ) : null}
                {coachConversationEnabled ? (
                  <View style={styles.coachPartnerCard}>
                    <View style={styles.coachPartnerHeader}>
                      <View style={styles.coachAvatarBadge}>
                        <Text style={styles.coachAvatarText}>AI</Text>
                      </View>
                      <View style={styles.coachPartnerHeaderText}>
                        <Text style={styles.coachPartnerTitle}>
                          Partenaire IA ({targetLanguageLabel})
                        </Text>
                        <Text style={styles.realtimeStatus}>
                          Parle puis relache: l'IA repond dans la langue de travail.
                        </Text>
                      </View>
                    </View>
                    {coachPartnerLoading ? (
                      <View style={styles.coachPartnerLoadingRow}>
                        <ActivityIndicator size="small" color="#93c5fd" />
                        <Text style={styles.realtimeStatus}>Le partenaire IA prepare sa reponse...</Text>
                      </View>
                    ) : null}
                    {coachPartnerReply ? (
                      <Text
                        style={[
                          styles.coachPartnerReplyText,
                          coachPartnerReplyLanguageIsRtl && styles.rtlText,
                        ]}
                      >
                        {coachPartnerReply}
                      </Text>
                    ) : (
                      <Text style={styles.coachPartnerPlaceholder}>
                        Aucune reponse IA pour le moment.
                      </Text>
                    )}
                    {coachPartnerReplyTranslation ? (
                      <View style={styles.coachPartnerTranslationBox}>
                        <Text style={styles.coachPartnerTranslationLabel}>
                          Traduction rapide ({sourceLanguageLabel})
                        </Text>
                        <Text
                          style={[
                            styles.coachPartnerTranslationText,
                            coachPartnerTranslationLanguageIsRtl && styles.rtlText,
                          ]}
                        >
                          {coachPartnerReplyTranslation}
                        </Text>
                      </View>
                    ) : null}
                    {coachReplySuggestionsLoading ? (
                      <Text style={styles.realtimeStatus}>Suggestions de reponse en cours...</Text>
                    ) : null}
                    {coachReplySuggestions.length > 0 ? (
                      <View style={styles.infoStack}>
                        <Text style={styles.realtimeStatus}>
                          Suggestions de reponse ({targetLanguageLabel})
                        </Text>
                        {coachReplySuggestions.map((entry) => (
                          <View key={entry.id} style={styles.coachSuggestionCard}>
                            <Text
                              style={[
                                styles.coachPartnerReplyText,
                                coachPartnerReplyLanguageIsRtl && styles.rtlText,
                              ]}
                            >
                              {entry.targetText}
                            </Text>
                            {entry.sourceText.trim() ? (
                              <Text
                                style={[
                                  styles.coachPartnerTranslationText,
                                  coachPartnerTranslationLanguageIsRtl && styles.rtlText,
                                ]}
                              >
                                {entry.sourceText}
                              </Text>
                            ) : null}
                            {entry.phoneticText.trim() ? (
                              <View style={styles.coachPartnerTranslationBox}>
                                <Text style={styles.coachPartnerTranslationLabel}>
                                  Phonetique ({targetLanguageLabel})
                                </Text>
                                <Text style={styles.coachPartnerTranslationText}>
                                  {entry.phoneticText}
                                </Text>
                              </View>
                            ) : null}
                            <View style={styles.row}>
                              <Pressable
                                style={({ pressed }) => [
                                  styles.controlButton,
                                  styles.controlButtonSecondary,
                                  coachSuggestionSpeakingId === entry.id && styles.controlButtonActive,
                                  pressed && styles.controlButtonPressed,
                                ]}
                                onPress={() => playCoachSuggestion(entry)}
                              >
                                <View style={styles.controlButtonContent}>
                                  <View style={styles.controlButtonSpinnerSlot}>
                                    {coachSuggestionSpeakingId === entry.id ? (
                                      <ActivityIndicator size="small" color="#ffffff" />
                                    ) : null}
                                  </View>
                                  <Text style={styles.controlButtonText} numberOfLines={1}>
                                    {coachSuggestionSpeakingId === entry.id
                                      ? "Lecture..."
                                      : `Lire (${targetLanguageLabel})`}
                                  </Text>
                                </View>
                              </Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {coachPartnerError ? <Text style={styles.error}>{coachPartnerError}</Text> : null}
                    <View style={styles.row}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.controlButton,
                          styles.controlButtonSecondary,
                          coachPartnerSpeakActive && styles.controlButtonActive,
                          pressed && styles.controlButtonPressed,
                          (!coachPartnerReply.trim() || coachPartnerLoading) && styles.controlButtonDisabled,
                        ]}
                        onPress={playCoachPartnerReply}
                        disabled={!coachPartnerReply.trim() || coachPartnerLoading}
                      >
                        <View style={styles.controlButtonContent}>
                          <View style={styles.controlButtonSpinnerSlot}>
                            {coachPartnerSpeakActive ? (
                              <ActivityIndicator size="small" color="#ffffff" />
                            ) : null}
                          </View>
                          <Text style={styles.controlButtonText} numberOfLines={1}>
                            {coachPartnerSpeakActive ? "Lecture..." : "Lire la reponse IA"}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.realtimeStatus}>
                    Active le mode pour t'entrainer en conversation directe avec un avatar IA.
                  </Text>
                )}
              </View>
              ) : null}

              {isHostSession ? (
                <>
                  <Text style={styles.langSelectorLabel}>Langue que tu parles: {sourceLanguageLabel}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.langScroller}
                    contentContainerStyle={styles.langScrollerContent}
                  >
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <Pressable
                        key={`src-${lang.code}`}
                        onPress={() => setSourceLanguage(lang.code)}
                        onLongPress={() => showLanguageInfo(lang)}
                        style={[
                          styles.langChip,
                          sourceLanguage === lang.code && styles.langChipActive,
                        ]}
                      >
                        <Text style={styles.langChipText}>{getLanguageChipLabel(lang)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={styles.langSelectorLabel}>
                    {coachConversationLayoutActive
                      ? `Langue du coach: ${targetLanguageLabel}`
                      : `Langue de reception: ${targetLanguageLabel}`}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.langScroller}
                    contentContainerStyle={styles.langScrollerContent}
                  >
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <Pressable
                        key={`dst-${lang.code}`}
                        onPress={() => setTargetLanguage(lang.code)}
                        onLongPress={() => showLanguageInfo(lang)}
                        style={[
                          styles.langChip,
                          targetLanguage === lang.code && styles.langChipActive,
                        ]}
                      >
                        <Text style={styles.langChipText}>{getLanguageChipLabel(lang)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  {translationEntitlement.loading ? (
                    <Text style={styles.realtimeStatus}>Verification des credits traduction...</Text>
                  ) : null}
                  {translationRemainingLabel ? (
                    <Text style={styles.realtimeStatus}>
                      Temps traduction restant (hote): {translationRemainingLabel}
                    </Text>
                  ) : null}
                  {!effectiveTranslationEnabled ? (
                    <Text style={styles.translationLockNotice}>
                      {effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT}
                    </Text>
                  ) : null}

                  <View style={styles.row}>
                    <Animated.View
                      style={talkiePulseEnabled ? { opacity: talkiePulseOpacityRef.current } : undefined}
                    >
                    <Pressable
                      style={({ pressed }) => [
                        styles.talkieButton,
                        isCompactPhone && styles.talkieButtonCompact,
                        talkieUiState === "starting" && styles.talkieButtonStarting,
                        talkieLooksRecording && styles.talkieButtonRecording,
                        (talkieUiState === "stopping" || translationBusy) && styles.talkieButtonBusy,
                        translationControlsDisabled && styles.talkieButtonLocked,
                        isTalkieLockedByOther && styles.talkieButtonLocked,
                        pressed &&
                          !talkieBusyVisual &&
                          !translationControlsDisabled &&
                          !isTalkieLockedByOther &&
                          talkieUiState === "idle" &&
                          styles.talkieButtonPressed,
                      ]}
                      onPressIn={handleManualPushToTalkPressIn}
                      onPressOut={handleManualPushToTalkPressOut}
                      disabled={
                        translationBusy ||
                        isTalkieLockedByOther ||
                        translationControlsDisabled
                      }
                    >
                      <View style={styles.talkieButtonContent}>
                        {(talkieUiState === "starting" ||
                          talkieUiState === "stopping" ||
                          translationBusy) && <ActivityIndicator size="small" color="#ffffff" />}
                        <Text style={styles.talkieButtonText}>{talkieButtonLabel}</Text>
                      </View>
                      </Pressable>
                    </Animated.View>
                  </View>

                  {recordingActive ? (
                    <View style={styles.row}>
                      <Pressable style={styles.controlButton} onPress={cancelRecording}>
                        <Text style={styles.controlButtonText}>Annuler</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {isTalkieLockedByOther && (
                    <Text style={styles.realtimeStatus}>
                      Talkie occupé par {talkieLockHolderName || "un interlocuteur"}.
                    </Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.langSelectorLabel}>
                    Langue que tu parles: {sourceLanguageLabel}
                  </Text>
                  {translationRemainingLabel ? (
                    <Text style={styles.realtimeStatus}>
                      Temps traduction restant (hote): {translationRemainingLabel}
                    </Text>
                  ) : null}
                  {!effectiveTranslationEnabled ? (
                    <Text style={styles.translationLockNotice}>
                      {effectiveTranslationLockMessage || TRANSLATION_WAIT_HOST_HINT}
                    </Text>
                  ) : null}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.langScroller}
                    contentContainerStyle={styles.langScrollerContent}
                  >
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <Pressable
                        key={`guest-src-${lang.code}`}
                        onPress={() => setSourceLanguage(lang.code)}
                        onLongPress={() => showLanguageInfo(lang)}
                        style={[
                          styles.langChip,
                          sourceLanguage === lang.code && styles.langChipActive,
                        ]}
                      >
                        <Text style={styles.langChipText}>{getLanguageChipLabel(lang)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={styles.langSelectorLabel}>
                    {coachConversationLayoutActive
                      ? `Langue du coach: ${targetLanguageLabel}`
                      : `Langue de reception: ${targetLanguageLabel}`}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.langScroller}
                    contentContainerStyle={styles.langScrollerContent}
                  >
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <Pressable
                        key={`guest-dst-${lang.code}`}
                        onPress={() => setTargetLanguage(lang.code)}
                        onLongPress={() => showLanguageInfo(lang)}
                        style={[
                          styles.langChip,
                          targetLanguage === lang.code && styles.langChipActive,
                        ]}
                      >
                        <Text style={styles.langChipText}>{getLanguageChipLabel(lang)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <View style={styles.row}>
                    <Animated.View
                      style={talkiePulseEnabled ? { opacity: talkiePulseOpacityRef.current } : undefined}
                    >
                    <Pressable
                      style={({ pressed }) => [
                        styles.talkieButton,
                        isCompactPhone && styles.talkieButtonCompact,
                        talkieUiState === "starting" && styles.talkieButtonStarting,
                        talkieLooksRecording && styles.talkieButtonRecording,
                        (talkieUiState === "stopping" || translationBusy) && styles.talkieButtonBusy,
                        translationControlsDisabled && styles.talkieButtonLocked,
                        isTalkieLockedByOther && styles.talkieButtonLocked,
                        pressed &&
                          !talkieBusyVisual &&
                          !translationControlsDisabled &&
                          !isTalkieLockedByOther &&
                          talkieUiState === "idle" &&
                          styles.talkieButtonPressed,
                      ]}
                      onPressIn={handleManualPushToTalkPressIn}
                      onPressOut={handleManualPushToTalkPressOut}
                      disabled={
                        translationBusy ||
                        isTalkieLockedByOther ||
                        translationControlsDisabled
                      }
                    >
                      <View style={styles.talkieButtonContent}>
                        {(talkieUiState === "starting" ||
                          talkieUiState === "stopping" ||
                          translationBusy) && <ActivityIndicator size="small" color="#ffffff" />}
                        <Text style={styles.talkieButtonText}>{talkieButtonLabel}</Text>
                      </View>
                      </Pressable>
                    </Animated.View>
                  </View>

                  {recordingActive ? (
                    <View style={styles.row}>
                      <Pressable style={styles.controlButton} onPress={cancelRecording}>
                        <Text style={styles.controlButtonText}>Annuler</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {isTalkieLockedByOther && (
                    <Text style={styles.realtimeStatus}>
                      Talkie occupé par {talkieLockHolderName || "un interlocuteur"}.
                    </Text>
                  )}
                </>
              )}

              {targetVoiceLikelyUnavailable ? (
                <Text style={styles.realtimeStatus}>
                  Voix traduite: aucune voix {targetLanguageLabel} installee sur cet iPhone.
                  Installe-la dans Reglages {'>'} Accessibilite {'>'} Contenu enonce {'>'} Voix.
                </Text>
              ) : null}

              {manualDraftVisible && !useManualDraftFullscreen ? (
                <View style={styles.manualDraftCard}>
                  <Text style={styles.realtimeStatus}>Verifie ton texte avant envoi</Text>
                  <TextInput
                    style={[styles.aiPromptInput, styles.manualDraftInput]}
                    value={manualDraftText}
                    onChangeText={setManualDraftText}
                    editable={!manualDraftSending}
                    multiline
                    textAlignVertical="top"
                    placeholder="Corrige ton texte si besoin..."
                    placeholderTextColor="#64748b"
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={dismissKeyboard}
                  />
                  <View style={styles.row}>
                    {keyboardVisible ? (
                      <Pressable style={styles.controlButton} onPress={dismissKeyboard}>
                        <Text style={styles.controlButtonText}>Fermer clavier</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.controlButton, manualDraftSending && styles.controlButtonDisabled]}
                      onPress={cancelManualDraft}
                      disabled={manualDraftSending}
                    >
                      <Text style={styles.controlButtonText}>Annuler</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.controlButton,
                        styles.realtimeButton,
                        (!manualDraftText.trim() || manualDraftSending) && styles.controlButtonDisabled,
                      ]}
                      onPress={() => {
                        void confirmManualDraftSend();
                      }}
                      disabled={!manualDraftText.trim() || manualDraftSending}
                    >
                      {manualDraftSending ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.controlButtonText}>Envoyer</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {sourceText ? (
                <View style={styles.infoStack}>
                  <Text style={styles.realtimeStatus}>Source ({sourceLanguageLabel})</Text>
                  <Text style={[styles.sourceLine, sourceLanguageIsRtl && styles.rtlText]}>{sourceText}</Text>
                </View>
              ) : null}
              {captionText ? (
                <View style={styles.infoStack}>
                  <Text style={styles.realtimeStatus}>
                    {coachConversationLayoutActive
                      ? `Reponse en langue du coach (${targetLanguageLabel})`
                      : `Traduction (${targetLanguageLabel})`}
                  </Text>
                  <Text style={[styles.captionLine, targetLanguageIsRtl && styles.rtlText]}>
                    {captionText}
                  </Text>
                  <View style={styles.rowSplit}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.controlButton,
                        styles.controlButtonSplit,
                        isCompactPhone && styles.controlButtonSplitStack,
                        styles.realtimeButton,
                        retranslateButtonActive && styles.controlButtonPrimaryActive,
                        pressed && styles.controlButtonPrimaryPressed,
                        (translationBusy || !sourceText.trim()) && styles.controlButtonDisabled,
                      ]}
                      onPress={triggerRetranslate}
                      disabled={translationBusy || !sourceText.trim()}
                    >
                      <View style={styles.controlButtonContent}>
                        <View style={styles.controlButtonSpinnerSlot}>
                          {(translationBusy || retranslateButtonActive) ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : null}
                        </View>
                        <Text style={styles.controlButtonText} numberOfLines={1}>
                          {translationBusy || retranslateButtonActive
                            ? "Retraduction..."
                            : "Retraduire"}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.controlButton,
                        styles.controlButtonSplit,
                        isCompactPhone && styles.controlButtonSplitStack,
                        styles.controlButtonSecondary,
                        replayButtonActive && styles.controlButtonActive,
                        pressed && styles.controlButtonPressed,
                        (translationBusy || !captionText.trim()) && styles.controlButtonDisabled,
                      ]}
                      onPress={replayCaption}
                      disabled={translationBusy || !captionText.trim()}
                    >
                      <View style={styles.controlButtonContent}>
                        <View style={styles.controlButtonSpinnerSlot}>
                          {replayButtonActive ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : null}
                        </View>
                        <Text style={styles.controlButtonText} numberOfLines={1}>
                          {replayButtonActive ? "Reecoute..." : "Reecouter"}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                  {captionPhoneticBusy ? (
                    <Text style={styles.captionPhoneticLine}>Phonetique: generation...</Text>
                  ) : captionPhoneticText ? (
                    <Text style={styles.captionPhoneticLine}>Phonetique: {captionPhoneticText}</Text>
                  ) : null}
                </View>
              ) : null}
              {recordingError ? <Text style={styles.error}>{recordingError}</Text> : null}
              {translationError ? <Text style={styles.error}>{translationError}</Text> : null}
              {voiceLoadError ? <Text style={styles.error}>{voiceLoadError}</Text> : null}
            </ScrollView>
          ) : null}
        </View>
        ) : null}
      </View>
      ) : null}
      {useManualDraftFullscreen ? (
        <Modal
          visible={manualDraftVisible}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => {
            if (manualDraftSending) return;
            cancelManualDraft();
          }}
        >
          <KeyboardAvoidingView
            style={styles.manualDraftSheetRoot}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={8}
          >
            <View style={styles.manualDraftSheetHeader}>
              <Text style={styles.manualDraftSheetTitle}>Corriger avant envoi</Text>
              <View style={styles.manualDraftSheetActions}>
                {keyboardVisible ? (
                  <Pressable style={styles.manualDraftSheetActionGhost} onPress={dismissKeyboard}>
                    <Text style={styles.manualDraftSheetActionGhostText}>Clavier</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.manualDraftSheetActionGhost, manualDraftSending && styles.controlButtonDisabled]}
                  onPress={cancelManualDraft}
                  disabled={manualDraftSending}
                >
                  <Text style={styles.manualDraftSheetActionGhostText}>Annuler</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.manualDraftSheetActionPrimary,
                    (!manualDraftText.trim() || manualDraftSending) && styles.controlButtonDisabled,
                  ]}
                  onPress={() => {
                    void confirmManualDraftSend();
                  }}
                  disabled={!manualDraftText.trim() || manualDraftSending}
                >
                  {manualDraftSending ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.manualDraftSheetActionPrimaryText}>Envoyer</Text>
                  )}
                </Pressable>
              </View>
            </View>

            <View style={styles.manualDraftSheetBody}>
              <Text style={styles.realtimeStatus}>
                Verifie ton texte, puis envoie la version corrigee.
              </Text>
              <TextInput
                style={[styles.aiPromptInput, styles.manualDraftSheetInput]}
                value={manualDraftText}
                onChangeText={setManualDraftText}
                editable={!manualDraftSending}
                multiline
                textAlignVertical="top"
                autoFocus
                placeholder="Corrige ton texte si besoin..."
                placeholderTextColor="#64748b"
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={dismissKeyboard}
              />
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
  },
  topBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: "#1e293b",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topActionsCompact: {
    gap: 6,
  },
  topTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "700",
  },
  topTitleCompact: {
    fontSize: 15,
  },
  topSubtitle: {
    color: "#94a3b8",
    fontSize: 12,
  },
  topSubtitleCompact: {
    fontSize: 11,
  },
  modeBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "#0f172a",
  },
  modeBadgeCompact: {
    fontSize: 9,
    paddingHorizontal: 7,
  },
  shareButton: {
    backgroundColor: "#0c4a6e",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  shareText: {
    color: "#bae6fd",
    fontSize: 12,
    fontWeight: "700",
  },
  leaveButton: {
    backgroundColor: "#7f1d1d",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  leaveText: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "700",
  },
  roomRoot: {
    flex: 1,
  },
  audioCallStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    gap: 14,
  },
  audioCallCard: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 16,
    backgroundColor: "#0b1220",
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 8,
  },
  audioCallTitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "700",
  },
  audioCallSubtitle: {
    color: "#93c5fd",
    fontSize: 13,
    fontWeight: "600",
  },
  audioCallHint: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  audioCallControls: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  chatVideoStage: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    position: "relative",
  },
  chatVideoMain: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0b1220",
    position: "relative",
  },
  chatVideoTrack: {
    width: "100%",
    height: "100%",
    backgroundColor: "#0b1220",
  },
  chatVideoPreview: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 112,
    height: 156,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
  },
  chatVideoPreviewTrack: {
    width: "100%",
    height: "100%",
    backgroundColor: "#0b1220",
  },
  chatVideoStatusRow: {
    paddingHorizontal: 12,
    paddingBottom: 6,
    gap: 4,
  },
  connectionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 30,
  },
  connectionBadgeFloating: {
    position: "absolute",
    top: 8,
    left: 10,
    right: 10,
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    backgroundColor: "rgba(2,6,23,0.72)",
  },
  connectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  connectionText: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  stageModeButton: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 999,
    backgroundColor: "#0b1220",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  stageModeButtonText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
  },
  videoStage: {
    flex: 1,
    paddingHorizontal: 10,
    paddingBottom: 6,
    position: "relative",
  },
  videoStageCompact: {
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  videoStageFullscreen: {
    paddingTop: 58,
    paddingBottom: 8,
  },
  videoStageImmersive: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  stageBackgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  stageBackgroundImage: {
    width: "100%",
    height: "100%",
  },
  subtitleOverlay: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    gap: 6,
    zIndex: 12,
  },
  subtitleOverlayImmersive: {
    left: 8,
    right: 8,
    bottom: 14,
  },
  subtitleSourceBubble: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "rgba(2,6,23,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  subtitleTargetBubble: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "rgba(12,74,110,0.76)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  subtitleLabel: {
    color: "#bfdbfe",
    fontSize: 10,
    fontWeight: "700",
  },
  subtitleSourceText: {
    color: "#e2e8f0",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  subtitleTargetText: {
    color: "#f8fafc",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  focusedVideoCard: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#1e293b",
    position: "relative",
    zIndex: 1,
  },
  focusedVideoCardImmersive: {
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  focusedVideoPressable: {
    flex: 1,
  },
  focusedVideoTrack: {
    width: "100%",
    height: "100%",
    minHeight: 240,
    backgroundColor: "#020617",
  },
  focusedVideoTrackCompact: {
    width: "100%",
    height: "100%",
    minHeight: 170,
    backgroundColor: "#020617",
  },
  focusedBadge: {
    position: "absolute",
    left: 10,
    bottom: 10,
    backgroundColor: "rgba(2,6,23,0.75)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  focusedBadgeText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  localPreviewCard: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 110,
    height: 160,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#020617",
  },
  localPreviewTrack: {
    width: "100%",
    height: "100%",
  },
  localPreviewText: {
    position: "absolute",
    right: 6,
    bottom: 6,
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: "rgba(2,6,23,0.6)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  thumbnailStrip: {
    maxHeight: 130,
  },
  thumbnailRow: {
    paddingHorizontal: 10,
    gap: 8,
    paddingBottom: 8,
  },
  thumbCard: {
    width: 120,
    height: 110,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
  },
  thumbTrack: {
    width: "100%",
    height: 82,
    backgroundColor: "#020617",
  },
  thumbText: {
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingTop: 4,
  },
  videoPlaceholder: {
    flex: 1,
    minHeight: 220,
    borderRadius: 14,
    backgroundColor: "#0b1120",
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  panelDock: {
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  panelDockCoachMode: {
    flex: 1,
    paddingTop: 8,
    paddingBottom: 12,
  },
  panelDockCompact: {
    gap: 6,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  quickStrip: {
    maxHeight: 110,
  },
  quickStripRow: {
    gap: 8,
    paddingHorizontal: 2,
  },
  quickThumbCard: {
    width: 120,
    height: 100,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
  },
  quickThumbTrack: {
    width: "100%",
    height: 74,
    backgroundColor: "#020617",
  },
  quickThumbText: {
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingTop: 4,
  },
  trackCardActiveSpeaker: {
    borderColor: "#22c55e",
  },
  trackCardPinned: {
    borderColor: "#38bdf8",
    borderWidth: 2,
  },
  panelDockFloating: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    zIndex: 35,
  },
  panelDockKeyboardRaised: {
    bottom: 260,
  },
  accordionCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 14,
    backgroundColor: "rgba(2,6,23,0.88)",
    overflow: "hidden",
  },
  accordionCardCoachMode: {
    flex: 1,
    minHeight: 260,
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  accordionHeaderText: {
    flex: 1,
    gap: 2,
  },
  accordionTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "800",
  },
  accordionMeta: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600",
  },
  accordionIcon: {
    color: "#cbd5e1",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 20,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  controlButton: {
    borderRadius: 999,
    backgroundColor: "#1f2937",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#475569",
    minWidth: 140,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  controlButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  controlButtonSpinnerSlot: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  controlButtonPressed: {
    backgroundColor: "#334155",
    borderColor: "#64748b",
  },
  controlButtonPrimaryPressed: {
    backgroundColor: "#0b5a86",
    borderColor: "#67e8f9",
  },
  controlButtonSecondary: {
    backgroundColor: "#0f172a",
    borderColor: "#38bdf8",
  },
  controlButtonActive: {
    backgroundColor: "#0c4a6e",
    borderColor: "#38bdf8",
  },
  controlButtonPrimaryActive: {
    backgroundColor: "#0369a1",
    borderColor: "#7dd3fc",
  },
  controlButtonSplit: {
    flex: 1,
    flexBasis: "48%",
    minWidth: 0,
  },
  controlButtonSplitStack: {
    flexBasis: "100%",
  },
  controlButtonDisabled: {
    opacity: 0.6,
  },
  talkieButton: {
    borderRadius: 999,
    minHeight: 48,
    minWidth: 230,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#22c55e",
    backgroundColor: "#14532d",
    shadowColor: "#22c55e",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  talkieButtonCompact: {
    width: "100%",
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  talkieButtonPressed: {
    backgroundColor: "#166534",
    borderColor: "#86efac",
  },
  talkieButtonStarting: {
    backgroundColor: "#1e3a8a",
    borderColor: "#93c5fd",
  },
  talkieButtonRecording: {
    backgroundColor: "#15803d",
    borderColor: "#86efac",
  },
  talkieButtonBusy: {
    backgroundColor: "#7f1d1d",
    borderColor: "#fca5a5",
  },
  talkieButtonLocked: {
    backgroundColor: "#1e293b",
    borderColor: "#64748b",
  },
  talkieButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  talkieButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  recordingButton: {
    backgroundColor: "#7f1d1d",
  },
  realtimeButton: {
    backgroundColor: "#0c4a6e",
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  controlButtonText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  translationPanel: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  translationPanelScroll: {
    maxHeight: 380,
  },
  translationPanelScrollCoach: {
    minHeight: 260,
  },
  translationInfoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  translationInfoButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#38bdf8",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c4a6e",
  },
  translationInfoButtonText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "800",
  },
  translationInfoBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  coachConversationCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e3a5f",
    backgroundColor: "#061425",
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  coachConversationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  coachPartnerCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  coachPartnerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coachAvatarBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c4a6e",
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  coachAvatarText: {
    color: "#e0f2fe",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  coachPartnerHeaderText: {
    flex: 1,
    gap: 2,
  },
  coachPartnerTitle: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "800",
  },
  coachPartnerLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachPartnerReplyText: {
    color: "#e2e8f0",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  coachPartnerPlaceholder: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  coachPartnerTranslationBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 4,
  },
  coachPartnerTranslationLabel: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
  },
  coachPartnerTranslationText: {
    color: "#f8fafc",
    fontSize: 12,
    lineHeight: 18,
  },
  coachSuggestionCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 4,
  },
  panelTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  rowSplit: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  langScroller: {
    maxHeight: 48,
  },
  langScrollerContent: {
    gap: 6,
    paddingRight: 2,
  },
  langSelectorLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  aiPromptInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    color: "#e2e8f0",
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  coachPromptInput: {
    minHeight: 96,
  },
  coachResponseBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  coachResponseText: {
    color: "#e2e8f0",
    fontSize: 12,
    lineHeight: 18,
  },
  mutedLine: {
    color: "#94a3b8",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  langChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#020617",
  },
  toggleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#020617",
  },
  langChipActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  langChipText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600",
  },
  realtimeStatus: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "600",
  },
  voiceLabel: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "600",
  },
  voiceRow: {
    gap: 8,
  },
  voiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#020617",
  },
  voiceChipActive: {
    borderColor: "#0ea5e9",
    backgroundColor: "#0c4a6e",
  },
  voiceChipText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "600",
  },
  infoStack: {
    gap: 3,
  },
  sourceLine: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 18,
  },
  captionLine: {
    color: "#a7f3d0",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  captionPhoneticLine: {
    color: "#ddd6fe",
    fontSize: 12,
    lineHeight: 18,
    fontStyle: "italic",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  error: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 18,
  },
  translationLockNotice: {
    color: "#fde68a",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  manualDraftCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  manualDraftInput: {
    minHeight: 64,
  },
  manualDraftSheetRoot: {
    flex: 1,
    backgroundColor: "#020617",
  },
  manualDraftSheetHeader: {
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: "#1e293b",
    gap: 10,
  },
  manualDraftSheetTitle: {
    color: "#e2e8f0",
    fontSize: 17,
    fontWeight: "800",
  },
  manualDraftSheetActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  manualDraftSheetActionGhost: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    minHeight: 36,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  manualDraftSheetActionGhostText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  manualDraftSheetActionPrimary: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#0c4a6e",
    minHeight: 36,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 86,
  },
  manualDraftSheetActionPrimaryText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  manualDraftSheetBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
  },
  manualDraftSheetInput: {
    flex: 1,
    minHeight: 200,
  },
});
