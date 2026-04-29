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
  PanResponder,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Speech from "expo-speech";
import type { Voice } from "expo-speech";
import {
  AudioSession,
  RoomContext,
  VideoTrack,
  getDefaultAppleAudioConfigurationForMode,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import {
  AudioPresets,
  ConnectionState,
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
} from "livekit-client";
import type { TrackReference } from "@livekit/components-core";
import { LanguageSwitcher, useI18n, type AppLanguage } from "../i18n";
import { env } from "../config/env";
import { auth } from "../services/firebase";
import { createLiveKitInvite } from "../services/livekit";
import {
  configureNativeVirtualBackground,
  createRealtimePcmBridge,
  isNativeRealtimePcmAvailable,
  type RealtimePcmBridge,
} from "../services/realtimePcm";
import {
  fetchTtsAudio,
  phoneticText,
  transcribeAudio,
  translateText,
} from "../services/translation";
import type { MobileCallSession } from "../types/session";
import { detectTabletLayout } from "../utils/layout";
import { buildCanonicalLivekitInviteUrl } from "../utils/livekitInviteLinks";
import {
  buildAiTtsInstructions,
  getVoicesForLanguage,
  selectPreferredDeviceVoiceId,
  selectPreferredEnhancedDeviceVoiceId,
  shouldPreferNativeTtsLanguage,
  shouldWarnAboutMissingNativeTtsVoice,
} from "../utils/ttsPolicy";

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
];

const AUTO_VOICE_ID = "__auto_voice__";
const REALTIME_SEGMENT_MS = 1200;
const REALTIME_SEGMENT_GAP_MS = 60;
const REALTIME_MAX_QUEUE = 4;
const REALTIME_MIN_SEGMENT_BYTES = 1300;
const MANUAL_MIN_RECORDING_MS = 600;
const MANUAL_MIN_SEGMENT_BYTES = 1200;
const MANUAL_POST_STOP_SETTLE_MS = Platform.OS === "ios" ? 80 : 240;
// On iOS, toggling the LiveKit room mic around recorder start is unstable and
// can lead to silent captures ("No speech detected"). Keep the room mic lifecycle
// unchanged during talkie until we implement a safer isolation strategy.
const IOS_SKIP_ROOM_MIC_TOGGLE_DURING_TALKIE = true;
const REALTIME_NATIVE_SAMPLE_RATE = 24_000;
const REALTIME_NATIVE_CHUNK_MS = 80;
const REALTIME_WS_BACKLOG_LIMIT_BYTES = 512_000;
const REALTIME_WS_PROTOCOL = "realtime";
const IOS_RECORDER_START_RETRY_DELAYS_MS = [220, 380, 560, 760];
const REALTIME_TRANSLATION_ENABLED = false;
const CAPTIONS_ALWAYS_ON = true;
const VOICE_TRANSLATION_ENABLED = true;
const AI_TTS_ENABLED = true;
const AI_TTS_DEFAULT_VOICE = "nova";
const AI_TTS_MAX_CHARS = 650;
const IOS_AI_TTS_FORMAT_PREFERENCE: ReadonlyArray<"wav" | "mp3"> = ["mp3", "wav"];
const DEFAULT_AI_TTS_FORMAT: "mp3" = "mp3";
const IOS_AI_TTS_PLAYBACK_START_TIMEOUT_MS = 1800;
const CAPTION_PHONETIC_IDLE_DELAY_MS = 650;
const IOS_REMOTE_AUDIO_VOLUME_NORMAL = 1;
const IOS_REMOTE_AUDIO_VOLUME_DUCKED_FOR_TTS = 0.62;
const TALKIE_REMOTE_AUDIO_MUTED_VOLUME = 0;
const MEDIA_ERROR_AUTO_LEAVE_GRACE_MS = 30_000;
const ROOM_RECOVERY_RETRY_DELAYS_MS = [900, 1800, 3200] as const;
const ROOM_CONNECT_TIMEOUT_MS = 12_000;
const ROOM_HEARTBEAT_INTERVAL_MS = 30_000;
const ROOM_HEARTBEAT_TIMEOUT_MS = 8_000;
const IOS_VISIO_BALANCED_VIDEO_RESOLUTION = VideoPresets.h540.resolution;
const IOS_VISIO_LOW_SIGNAL_VIDEO_RESOLUTION = VideoPresets.h360.resolution;
const IOS_CAMERA_FOREGROUND_RECOVERY_DELAY_MS = 260;
const IOS_CAMERA_FOREGROUND_RECOVERY_COOLDOWN_MS = 1_500;
const IOS_CAMERA_HEALTH_RECOVERY_DELAY_MS = 420;
const IOS_CAMERA_HEALTH_RECOVERY_COOLDOWN_MS = 2_500;
const IOS_PREVIEW_CARD_WIDTH = 110;
const IOS_PREVIEW_CARD_HEIGHT = 160;
const IOS_PREVIEW_CARD_WIDTH_COMPACT = 96;
const IOS_PREVIEW_CARD_HEIGHT_COMPACT = 136;
const IOS_PREVIEW_CARD_WIDTH_TABLET = 148;
const IOS_PREVIEW_CARD_HEIGHT_TABLET = 210;
const IOS_PREVIEW_CARD_MARGIN = 10;
const IOS_PREVIEW_DEFAULT_CORNER: PreviewCorner = "topRight";
const IOS_PREVIEW_DOUBLE_TAP_DELAY_MS = 220;
const TALKIE_LOCK_TOPIC = "bfzoom-ptt-lock";
const TALKIE_LOCK_TIMEOUT_MS = 10_000;
const TALKIE_LOCK_RELEASE_GRACE_MS = 4_000;
const TALKIE_LOCK_HEARTBEAT_MS = 2_500;
const CALL_KEEP_AWAKE_TAG = "bfzoom-call-room";
const CALL_PREFS_STORAGE_KEY_PREFIX = "bfzoom.call.prefs";
const REALTIME_VOICE_STORAGE_KEY_PREFIX = "bfzoom.voice.realtime";
const TTS_VOICE_STORAGE_KEY_PREFIX = "bfzoom.voice.tts";
const TRANSLATOR_IDENTITY_PREFIX = "bfzoom-translator-";
const TRANSLATION_ACCESS_TOPIC = "bfzoom-translation-access";
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

type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]["code"];
type RealtimeVoiceId = (typeof REALTIME_OUTPUT_VOICE_OPTIONS)[number];
type StageBackgroundId = (typeof STAGE_BACKGROUND_PRESETS)[number]["id"];
type CameraFacingMode = "user" | "environment";
type AccordionPanelKey = "controls" | "translation";
type TalkieUiState = "idle" | "starting" | "recording" | "stopping" | "review";
type SubtitleDisplayMode = "dual" | "translationOnly";
type ExpandedSubtitleKind = "source" | "target" | null;
type PreviewCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
type TtsTrigger = "auto" | "replay";
type TtsPlaybackMeta = {
  sessionId: number;
  trigger: TtsTrigger;
  source: "server";
  format: "wav" | "mp3";
  language: string;
  textChars: number;
  fileBytes: number;
  requestStartedAt: number;
  playbackStartedAt?: number;
};

type CaptionPhoneticJob = {
  text: string;
  targetLanguage: LanguageCode;
};

type StoredCallPrefs = {
  sourceLanguage?: string;
  targetLanguage?: string;
  subtitleDisplayMode?: SubtitleDisplayMode;
  localPreviewCorner?: PreviewCorner;
  captionsEnabled?: boolean;
  ttsEnabled?: boolean;
  realtimeEnabled?: boolean;
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

let sharedCallAudioTransitionChain: Promise<void> = Promise.resolve();
let sharedExpoAudioMode: "idle" | "playback" | "recording" = "idle";
let sharedActiveCallAudioOwnerKey = "";

const runSharedCallAudioTransition = async (task: () => Promise<void>) => {
  const previous = sharedCallAudioTransitionChain.catch(() => {});
  let resolveNext!: () => void;
  sharedCallAudioTransitionChain = new Promise<void>((resolve) => {
    resolveNext = resolve;
  });
  try {
    await previous;
    await task();
  } finally {
    resolveNext();
  }
};

const formatTtsLogValue = (value: unknown) => {
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NaN";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
};

const logTtsEvent = (
  event: string,
  details: Record<string, unknown> = {},
  level: "info" | "warn" = "info"
) => {
  const suffix = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatTtsLogValue(value)}`)
    .join(" ");
  const message = suffix ? `[BFZoom][TTS] ${event} ${suffix}` : `[BFZoom][TTS] ${event}`;
  if (level === "warn") {
    console.warn(message);
    return;
  }
  console.info(message);
};

const logCallLatencyEvent = (
  event: string,
  details: Record<string, unknown> = {},
  level: "info" | "warn" = "info"
) => {
  const suffix = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatTtsLogValue(value)}`)
    .join(" ");
  const message = suffix
    ? `[BFZoom][CALL][LATENCY] ${event} ${suffix}`
    : `[BFZoom][CALL][LATENCY] ${event}`;
  if (level === "warn") {
    console.warn(message);
    return;
  }
  console.info(message);
};
const RTL_LANGUAGE_CODES = new Set(["ar", "ar-ma", "fa", "he"]);

type CaptionPayload = {
  id?: string;
  roomId?: string;
  from?: string;
  speakerName?: string;
  text?: string;
  sourceText?: string;
  sourceLang?: string;
  targetLang?: string;
  timestamp?: number;
  durationSeconds?: number;
};

const estimateCaptionUsageSeconds = (payload: CaptionPayload) => {
  const source = String(payload.sourceText || payload.text || "").trim();
  if (!source) return 1;
  const wordCount = source.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(30, Math.ceil(wordCount / 3)));
};

const estimateTalkieUsageSeconds = (startedAt: number, endedAt: number) => {
  const elapsedMs = Math.max(0, endedAt - startedAt);
  return Math.max(1, Math.min(300, Math.ceil(elapsedMs / 1000) || 1));
};

type RoomParticipantRole = "host" | "guest" | "translator" | null;

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
  enabled: false,
  lockReason: "",
  loading: true,
  isAdmin: false,
  isPremium: false,
  freeSecondsRemaining: 0,
  paidSecondsRemaining: 0,
  totalSecondsRemaining: 0,
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

type ManualDraftLatencyState = {
  traceId: string;
  stopStartedAt: number;
  reviewOpenedAt: number;
  draftReadyMs: number;
  transcribeMs: number;
  recordingMs: number;
  usageSeconds: number;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  draftChars: number;
};

type ProcessTranscriptTrace = {
  traceId?: string;
  path: "manual_send" | "realtime";
  stopStartedAt?: number;
  reviewOpenedAt?: number;
  confirmStartedAt?: number;
  consumeMs?: number;
  lockClaimMs?: number;
  transcribeMs?: number;
  draftReadyMs?: number;
  segmentCapturedAt?: number;
};

type CallScreenProps = {
  session: MobileCallSession;
  onLeave: (reason?: string) => void;
};

const isLanguageCode = (value: string): value is LanguageCode =>
  LANGUAGE_OPTIONS.some((item) => item.code === value);

const isRealtimeVoiceId = (value: string): value is RealtimeVoiceId =>
  REALTIME_OUTPUT_VOICE_OPTIONS.some((voice) => voice === value);

const isSubtitleDisplayMode = (value: string): value is SubtitleDisplayMode =>
  value === "dual" || value === "translationOnly";

const isPreviewCorner = (value: string): value is PreviewCorner =>
  value === "topLeft" ||
  value === "topRight" ||
  value === "bottomLeft" ||
  value === "bottomRight";

const isTranslatorIdentity = (identity: string) =>
  identity.trim().toLowerCase().startsWith(TRANSLATOR_IDENTITY_PREFIX);

const getParticipantRoleFromMetadata = (metadata?: string | null): RoomParticipantRole => {
  const raw = String(metadata || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { role?: string };
    const role = String(parsed?.role || "").trim().toLowerCase();
    if (role === "host" || role === "guest" || role === "translator") {
      return role;
    }
    return null;
  } catch {
    return null;
  }
};

const getTranslatorTargetLanguageFromIdentity = (identity: string): LanguageCode | null => {
  const normalized = identity.trim().toLowerCase();
  if (!normalized.startsWith(TRANSLATOR_IDENTITY_PREFIX)) return null;
  const lang = normalized.slice(TRANSLATOR_IDENTITY_PREFIX.length).split("-")[0]?.trim() || "";
  return isLanguageCode(lang) ? lang : null;
};

type InspectableVideoTrack = {
  isMuted?: boolean;
  mediaStreamTrack?: {
    readyState?: string;
    enabled?: boolean;
    muted?: boolean;
  } | null;
  mediaStream?: {
    getVideoTracks?: () => ArrayLike<unknown>;
  } | null;
} | null;

const isUsableVideoTrack = (track?: InspectableVideoTrack) => {
  if (!track || track.isMuted) return false;

  const mediaStreamTrack = track.mediaStreamTrack;
  if (!mediaStreamTrack) return false;

  const readyState = String(mediaStreamTrack.readyState || "").trim().toLowerCase();
  if (readyState && readyState !== "live") return false;
  if (mediaStreamTrack.enabled === false) return false;
  if (mediaStreamTrack.muted === true) return false;

  const mediaStream = track.mediaStream;
  if (mediaStream && typeof mediaStream.getVideoTracks === "function") {
    const videoTracks = Array.from(mediaStream.getVideoTracks());
    if (!videoTracks.length) return false;
  }

  return true;
};

const isUsableVideoPublication = (
  publication?:
    | {
        kind?: Track.Kind;
        isMuted?: boolean;
        videoTrack?: InspectableVideoTrack;
        track?: InspectableVideoTrack;
      }
    | null
) => {
  if (!publication || publication.kind !== Track.Kind.Video || publication.isMuted) return false;
  return isUsableVideoTrack(publication.videoTrack || publication.track);
};

const isRenderableTrackReference = (trackRef?: TrackReference | null) =>
  isUsableVideoPublication(trackRef?.publication);

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
    lockReason: enabled ? "" : lockReason,
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

const toFriendlyAudioError = (error: unknown, language: AppLanguage = "fr") => {
  const raw = error instanceof Error ? error.message : String(error || "Audio error");
  if (/source language mismatch|script mismatch/i.test(raw)) {
    return language === "fr"
      ? "Je n'ai pas bien compris dans la langue choisie. Parle plus lentement ou verifie 'Langue que tu parles'."
      : "I didn't understand well in the selected language. Speak more slowly or check 'Language you speak'.";
  }
  if (/no speech detected/i.test(raw)) {
    return language === "fr"
      ? "Aucune voix detectee. Maintiens 1-2 secondes, parle clairement, puis relache."
      : "No speech detected. Hold for 1-2 seconds, speak clearly, then release.";
  }
  if (
    /recording not allowed/i.test(raw) ||
    /osstatus error 50/i.test(raw) ||
    /setting category/i.test(raw) ||
    /osstatus error 5610/i.test(raw) ||
    /audio mode/i.test(raw)
  ) {
    return language === "fr"
      ? "Micro iOS indisponible temporairement. Coupe puis rallume 'Mic', puis reessaie dans 1-2 secondes."
      : "iOS microphone is temporarily unavailable. Turn 'Mic' off and on, then try again in 1-2 seconds.";
  }
  return raw;
};

const isRecoverableIosRecorderError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || "");
  return (
    /recording not allowed/i.test(raw) ||
    /osstatus error 50/i.test(raw) ||
    /setting category/i.test(raw) ||
    /osstatus error 5610/i.test(raw) ||
    /audio mode/i.test(raw) ||
    /session/i.test(raw) ||
    /avfoundation/i.test(raw) ||
    /cannot start/i.test(raw)
  );
};

const readHttpError = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  const fallback = `${response.status} ${response.statusText}`.trim();
  if (!raw) {
    return fallback;
  }
  const sanitize = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const looksLikeHtml =
      /^<!doctype html/i.test(trimmed) ||
      /^<html/i.test(trimmed) ||
      /<head[\s>]/i.test(trimmed) ||
      /<body[\s>]/i.test(trimmed);
    return looksLikeHtml ? fallback : trimmed;
  };
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return sanitize(parsed.error || raw);
  } catch {
    return sanitize(raw);
  }
};

const shouldFallbackToLocalLeave = (message: string) => {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return (
    /^<!doctype html/i.test(trimmed) ||
    /^<html/i.test(trimmed) ||
    /<head[\s>]/i.test(trimmed) ||
    /<body[\s>]/i.test(trimmed) ||
    /\b404\b/i.test(trimmed) ||
    /not found/i.test(trimmed) ||
    /page introuvable/i.test(trimmed)
  );
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
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
  const words = splitWords(trimmed);
  if (words.length !== 1) return false;
  const scriptPattern = LANGUAGE_SCRIPT_PATTERNS[sourceLang];
  if (scriptPattern?.test(trimmed)) return false;
  const token = normalizeToken(words[0] || "");
  if (!token) return false;
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

export function CallScreen({ session, onLeave }: CallScreenProps) {
  const { language } = useI18n();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isTabletLayout = detectTabletLayout(viewportWidth, viewportHeight);
  const [sessionError, setSessionError] = useState("");
  const [connected, setConnected] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const [connectRevision, setConnectRevision] = useState(0);
  const roomConnectStartedRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const expectedRoomDisconnectRef = useRef(false);
  const roomEndForAllInFlightRef = useRef(false);
  const roomRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomRecoveryAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const isAudioOnlyCall = (session.callMode || "video") === "audio";
  const isHostSession = session.role === "host";
  const callAudioOwnerKey = useMemo(
    () => `${session.roomId}:${session.identity}:${session.role}`,
    [session.identity, session.role, session.roomId]
  );
  const ui = useMemo(
    () =>
      language === "fr"
        ? {
            hostMode: "Mode HOTE",
            guestMode: "Mode INVITE",
            shareTitle: "Salle BFZoom",
            shareMessage: (url: string) =>
              `Rejoins ma salle BFZoom en 1 clic : ${url}\n\nSi l'app BFZoom est installée, elle s'ouvre automatiquement. Sinon, la version web s'ouvre.`,
            shareFailed: "Impossible de partager le lien de salle.",
            shareInviteUnavailableTitle: "Partage indisponible",
            shareInviteUnavailable:
              "Le partage est temporairement indisponible. Reessaie dans un instant.",
            audioSessionFailed: "Impossible de demarrer la session audio.",
            share: "Partager",
            leave: "Quitter",
            endForAllCompact: "Terminer",
            endForAll: "Terminer pour tous",
            confirmEndRoomTitle: "Terminer l'appel ?",
            confirmEndRoomMessage:
              "Cela fermera l'appel pour tous les participants encore connectes.",
            confirmEndRoomAction: "Terminer pour tous",
            cancel: "Annuler",
            endingRoom: "Fermeture...",
            endRoomFailed:
              "Impossible de terminer l'appel pour tous. Verifie ta connexion puis reessaie.",
            liveKitError: "Erreur LiveKit",
            roomReconnectInProgress:
              "Connexion a la salle perdue. Reconnexion en cours...",
            roomReconnectFailed:
              "Connexion a la salle perdue. Quitte puis relance l'appel.",
          }
        : {
            hostMode: "HOST MODE",
            guestMode: "GUEST MODE",
            shareTitle: "BFZoom room",
            shareMessage: (url: string) =>
              `Join my BFZoom room in one tap: ${url}\n\nIf the BFZoom app is installed, it opens automatically. Otherwise, the web version opens.`,
            shareFailed: "Unable to share the room link.",
            shareInviteUnavailableTitle: "Share unavailable",
            shareInviteUnavailable:
              "Sharing is temporarily unavailable. Please try again in a moment.",
            audioSessionFailed: "Unable to start the audio session.",
            share: "Share",
            leave: "Leave",
            endForAllCompact: "End",
            endForAll: "End for all",
            confirmEndRoomTitle: "End the call?",
            confirmEndRoomMessage:
              "This will end the call for every participant still connected.",
            confirmEndRoomAction: "End for all",
            cancel: "Cancel",
            endingRoom: "Ending...",
            endRoomFailed:
              "Unable to end the call for everyone. Check your connection and try again.",
            liveKitError: "LiveKit error",
            roomReconnectInProgress:
              "Room connection lost. Reconnecting...",
            roomReconnectFailed:
              "Room connection lost. Leave and start the call again.",
          },
    [language]
  );
  const liveKitErrorFallbackRef = useRef(
    language === "fr" ? "Erreur LiveKit" : "LiveKit error"
  );
  const audioSessionErrorFallbackRef = useRef(
    language === "fr"
      ? "Impossible de demarrer la session audio."
      : "Unable to start the audio session."
  );
  useEffect(() => {
    liveKitErrorFallbackRef.current = language === "fr" ? "Erreur LiveKit" : "LiveKit error";
    audioSessionErrorFallbackRef.current =
      language === "fr"
        ? "Impossible de demarrer la session audio."
        : "Unable to start the audio session.";
  }, [language]);
  const roleModeLabel = isHostSession ? ui.hostMode : ui.guestMode;
  const isCompactPhone = !isTabletLayout && viewportWidth <= 430;
  const isVeryCompactPhone =
    !isTabletLayout && (viewportWidth <= 380 || viewportHeight <= 760);
  const useCenteredTabletTopBar = isTabletLayout;
  const preferSpeakerOnCallStart = Platform.OS === "ios";
  const leaveButtonLabel = isHostSession
    ? isCompactPhone
      ? leavePending
        ? ui.endingRoom
        : ui.endForAllCompact
      : leavePending
        ? ui.endingRoom
      : ui.endForAll
    : ui.leave;
  const liveKitRoomOptions = useMemo(
    () => ({
      adaptiveStream: { pixelDensity: "screen" as const },
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true,
      },
      videoCaptureDefaults: {
        resolution: IOS_VISIO_BALANCED_VIDEO_RESOLUTION,
      },
      publishDefaults: {
        audioPreset: AudioPresets.speech,
        dtx: true,
        red: true,
      },
    }),
    []
  );
  const liveKitRoom = useMemo(
    () => new Room(liveKitRoomOptions),
    [connectRevision, liveKitRoomOptions, session.livekitToken, session.livekitUrl, session.roomId]
  );
  const roomContextKey = useMemo(
    () => `${session.roomId}:${connectRevision}`,
    [connectRevision, session.roomId]
  );
  const clearRoomRecoveryTimer = useCallback(() => {
    if (!roomRecoveryTimerRef.current) return;
    clearTimeout(roomRecoveryTimerRef.current);
    roomRecoveryTimerRef.current = null;
  }, []);
  const ensureCallAudioSession = useCallback(async () => {
    await runSharedCallAudioTransition(async () => {
      sharedActiveCallAudioOwnerKey = callAudioOwnerKey;
      if (Platform.OS === "ios") {
        await AudioSession.setAppleAudioConfiguration(
          getDefaultAppleAudioConfigurationForMode("localAndRemote", preferSpeakerOnCallStart)
        ).catch(() => {});
      }
      await AudioSession.startAudioSession();
      await AudioSession.setDefaultRemoteAudioTrackVolume(1).catch(() => {});
      if (Platform.OS === "ios") {
        await AudioSession.selectAudioOutput(
          preferSpeakerOnCallStart ? "force_speaker" : "default"
        ).catch(() => {});
      }
    });
  }, [callAudioOwnerKey, preferSpeakerOnCallStart]);
  const scheduleRoomRecovery = useCallback(() => {
    if (leaveRequestedRef.current) return;
    if (roomEndForAllInFlightRef.current) return;
    if (appStateRef.current !== "active") return;
    if (roomRecoveryTimerRef.current || roomConnectStartedRef.current) return;
    if (
      liveKitRoom.state === ConnectionState.Connected ||
      liveKitRoom.state === ConnectionState.Connecting ||
      liveKitRoom.state === ConnectionState.Reconnecting
    ) {
      return;
    }
    const nextAttempt = Math.min(
      roomRecoveryAttemptRef.current,
      ROOM_RECOVERY_RETRY_DELAYS_MS.length - 1
    );
    roomRecoveryAttemptRef.current += 1;
    setSessionError(ui.roomReconnectInProgress);
    roomRecoveryTimerRef.current = setTimeout(() => {
      roomRecoveryTimerRef.current = null;
      void (async () => {
        if (appStateRef.current !== "active" || leaveRequestedRef.current) return;
        if (
          liveKitRoom.state === ConnectionState.Connected ||
          liveKitRoom.state === ConnectionState.Connecting ||
          liveKitRoom.state === ConnectionState.Reconnecting
        ) {
          expectedRoomDisconnectRef.current = true;
          await liveKitRoom.disconnect().catch(() => {});
        }
        roomConnectStartedRef.current = false;
        setConnectRevision((current) => current + 1);
      })();
    }, ROOM_RECOVERY_RETRY_DELAYS_MS[nextAttempt]);
  }, [liveKitRoom, ui.roomReconnectInProgress]);
  const handleRoomErrorRef = useRef<((error: Error) => void) | null>(null);
  const scheduleRoomRecoveryRef = useRef<(() => void) | null>(null);
  const handleLeaveRequest = useCallback(
    (reason?: string) => {
      leaveRequestedRef.current = true;
      expectedRoomDisconnectRef.current = true;
      roomEndForAllInFlightRef.current = false;
      clearRoomRecoveryTimer();
      void liveKitRoom.disconnect().catch(() => {});
      onLeave(reason);
    },
    [clearRoomRecoveryTimer, liveKitRoom, onLeave]
  );
  const performEndRoomForAll = useCallback(async () => {
    if (!isHostSession) {
      handleLeaveRequest("leave");
      return;
    }
    if (leavePending) return;
    setSessionError("");
    setLeavePending(true);
    roomEndForAllInFlightRef.current = true;
    try {
      const freshToken =
        (auth?.currentUser ? await auth.currentUser.getIdToken().catch(() => "") : "") ||
        session.bearerToken ||
        "";
      const bearerToken = freshToken.trim();
      const apiBaseUrl = session.apiBaseUrl.trim().replace(/\/+$/, "");
      const roomId = session.roomId.trim();
      if (!bearerToken || !apiBaseUrl || !roomId) {
        throw new Error(ui.endRoomFailed);
      }
      const response = await fetch(`${apiBaseUrl}/api/livekit/room/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ room: roomId }),
      });
      if (!response.ok) {
        const message = await readHttpError(response);
        throw new Error(message || ui.endRoomFailed);
      }
      handleLeaveRequest("host_room_ended");
    } catch (error) {
      roomEndForAllInFlightRef.current = false;
      const message = error instanceof Error && error.message.trim() ? error.message : ui.endRoomFailed;
      if (shouldFallbackToLocalLeave(message)) {
        handleLeaveRequest("leave");
        return;
      }
      setSessionError(message);
    } finally {
      setLeavePending(false);
    }
  }, [
    handleLeaveRequest,
    isHostSession,
    leavePending,
    session.apiBaseUrl,
    session.bearerToken,
    session.roomId,
    ui.endRoomFailed,
  ]);
  const endRoomForAll = useCallback(() => {
    if (!isHostSession) {
      handleLeaveRequest("leave");
      return;
    }
    Alert.alert(ui.confirmEndRoomTitle, ui.confirmEndRoomMessage, [
      {
        text: ui.cancel,
        style: "cancel",
      },
      {
        text: ui.confirmEndRoomAction,
        style: "destructive",
        onPress: () => {
          void performEndRoomForAll();
        },
      },
    ]);
  }, [
    handleLeaveRequest,
    isHostSession,
    performEndRoomForAll,
    ui.cancel,
    ui.confirmEndRoomAction,
    ui.confirmEndRoomMessage,
    ui.confirmEndRoomTitle,
  ]);
  const handleRoomConnected = useCallback(() => {
    expectedRoomDisconnectRef.current = false;
    roomEndForAllInFlightRef.current = false;
    roomConnectStartedRef.current = false;
    roomRecoveryAttemptRef.current = 0;
    clearRoomRecoveryTimer();
    setConnected(true);
    setSessionError("");
  }, [clearRoomRecoveryTimer]);
  const handleRoomDisconnected = useCallback(() => {
    roomConnectStartedRef.current = false;
    setConnected(false);
    if (roomEndForAllInFlightRef.current) {
      roomEndForAllInFlightRef.current = false;
      expectedRoomDisconnectRef.current = false;
      return;
    }
    if (expectedRoomDisconnectRef.current) {
      expectedRoomDisconnectRef.current = false;
      return;
    }
    if (!leaveRequestedRef.current) {
      scheduleRoomRecovery();
    }
  }, [scheduleRoomRecovery]);
  const handleRoomError = useCallback((err: Error) => {
    roomConnectStartedRef.current = false;
    setSessionError(err.message?.trim() || liveKitErrorFallbackRef.current);
  }, []);
  useEffect(() => {
    handleRoomErrorRef.current = handleRoomError;
  }, [handleRoomError]);
  useEffect(() => {
    scheduleRoomRecoveryRef.current = scheduleRoomRecovery;
  }, [scheduleRoomRecovery]);

  useEffect(() => {
    const onConnected = () => {
      handleRoomConnected();
    };
    const onDisconnected = () => {
      handleRoomDisconnected();
    };
    const onMediaDevicesError = (error: Error) => {
      handleRoomError(error);
    };

    liveKitRoom.on(RoomEvent.Connected, onConnected);
    liveKitRoom.on(RoomEvent.Disconnected, onDisconnected);
    liveKitRoom.on(RoomEvent.MediaDevicesError, onMediaDevicesError);

    return () => {
      liveKitRoom.off(RoomEvent.Connected, onConnected);
      liveKitRoom.off(RoomEvent.Disconnected, onDisconnected);
      liveKitRoom.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
    };
  }, [handleRoomConnected, handleRoomDisconnected, handleRoomError, liveKitRoom]);

  useEffect(() => {
    let cancelled = false;

    const connectRoom = async () => {
      if (!session.livekitUrl || !session.livekitToken) {
        handleRoomError(new Error(liveKitErrorFallbackRef.current));
        return;
      }
      if (appStateRef.current !== "active") {
        roomConnectStartedRef.current = false;
        return;
      }
      if (
        roomConnectStartedRef.current ||
        liveKitRoom.state === ConnectionState.Connected ||
        liveKitRoom.state === ConnectionState.Connecting ||
        liveKitRoom.state === ConnectionState.Reconnecting
      ) {
        return;
      }

      try {
        expectedRoomDisconnectRef.current = false;
        roomConnectStartedRef.current = true;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            liveKitRoom.connect(session.livekitUrl, session.livekitToken),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error(ui.roomReconnectFailed));
              }, ROOM_CONNECT_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      } catch (error) {
        roomConnectStartedRef.current = false;
        expectedRoomDisconnectRef.current = true;
        await liveKitRoom.disconnect().catch(() => {});
        if (cancelled) return;
        const nextError =
          error instanceof Error ? error : new Error(liveKitErrorFallbackRef.current);
        if (handleRoomErrorRef.current) {
          handleRoomErrorRef.current(nextError);
        } else {
          setSessionError(nextError.message?.trim() || liveKitErrorFallbackRef.current);
        }
        scheduleRoomRecoveryRef.current?.();
      }
    };

    void connectRoom();

    return () => {
      cancelled = true;
      roomConnectStartedRef.current = false;
      if (
        liveKitRoom.state === ConnectionState.Connected ||
        liveKitRoom.state === ConnectionState.Connecting ||
        liveKitRoom.state === ConnectionState.Reconnecting
      ) {
        expectedRoomDisconnectRef.current = true;
        void liveKitRoom.disconnect().catch(() => {});
      }
    };
  }, [
    connectRevision,
    liveKitRoom,
    session.livekitToken,
    session.livekitUrl,
    ui.roomReconnectFailed,
  ]);

  const [shareInviteUrl, setShareInviteUrl] = useState("");

  const publicJoinBaseUrl = env.publicJoinBaseUrl;

  const shareRoomAccess = useCallback(async () => {
    try {
      setSessionError("");
      let nextShareUrl = shareInviteUrl.trim();
      if (!nextShareUrl) {
        const bearerToken =
          (auth?.currentUser ? await auth.currentUser.getIdToken().catch(() => "") : "") ||
          session.bearerToken ||
          "";
        if (!bearerToken.trim()) {
          throw new Error(ui.shareFailed);
        }
        const invite = await createLiveKitInvite({
          apiBaseUrl: session.apiBaseUrl,
          room: session.roomId,
          bearerToken,
        });
        nextShareUrl = buildCanonicalLivekitInviteUrl(invite.inviteId, publicJoinBaseUrl);
        setShareInviteUrl(nextShareUrl);
      }
      await Share.share({
        title: ui.shareTitle,
        message: ui.shareMessage(nextShareUrl),
        url: nextShareUrl,
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "";
      const looksLikeHtml =
        /^<!doctype html/i.test(rawMessage.trim()) ||
        /^<html/i.test(rawMessage.trim()) ||
        /<head[\s>]/i.test(rawMessage) ||
        /<body[\s>]/i.test(rawMessage);
      const looksLikeMissingRoute =
        /\b404\b/i.test(rawMessage) ||
        /not found/i.test(rawMessage) ||
        /page introuvable/i.test(rawMessage);
      const message =
        looksLikeHtml || looksLikeMissingRoute || !rawMessage.trim()
          ? ui.shareInviteUnavailable
          : rawMessage;
      Alert.alert(
        ui.shareInviteUnavailableTitle,
        message
      );
    }
  }, [publicJoinBaseUrl, session.apiBaseUrl, session.bearerToken, session.roomId, shareInviteUrl, ui]);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        await ensureCallAudioSession();
      } catch (err) {
        if (cancelled) return;
        setSessionError(
          err instanceof Error && err.message.trim()
            ? err.message
            : audioSessionErrorFallbackRef.current
        );
      }
    };
    void start();
    return () => {
      cancelled = true;
      clearRoomRecoveryTimer();
      leaveRequestedRef.current = true;
      Speech.stop();
      void runSharedCallAudioTransition(async () => {
        if (Platform.OS === "ios" && sharedActiveCallAudioOwnerKey !== callAudioOwnerKey) {
          return;
        }
        await setIsAudioActiveAsync(false).catch(() => {});
        await AudioSession.stopAudioSession().catch(() => {});
        if (Platform.OS === "ios") {
          sharedExpoAudioMode = "idle";
          sharedActiveCallAudioOwnerKey = "";
        }
      }).catch(() => {});
    };
  }, [
    audioSessionErrorFallbackRef,
    callAudioOwnerKey,
    clearRoomRecoveryTimer,
    ensureCallAudioSession,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasActive = appStateRef.current === "active";
      const isActive = nextState === "active";
      appStateRef.current = nextState;
      if (!wasActive && isActive) {
        if (roomRecoveryAttemptRef.current >= ROOM_RECOVERY_RETRY_DELAYS_MS.length) {
          roomRecoveryAttemptRef.current = 0;
        }
        void ensureCallAudioSession().catch((error) => {
          const message =
            error instanceof Error && error.message.trim()
              ? error.message
              : audioSessionErrorFallbackRef.current;
          setSessionError(message);
        });
        if (liveKitRoom.state === ConnectionState.Disconnected) {
          scheduleRoomRecovery();
        }
        return;
      }
      if (wasActive && !isActive) {
        clearRoomRecoveryTimer();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [clearRoomRecoveryTimer, ensureCallAudioSession, liveKitRoom, scheduleRoomRecovery]);

  return (
    <View style={styles.screen}>
      {!immersiveMode ? (
        <View style={styles.topBarShell}>
          <View
            style={[
              styles.topBar,
              isCompactPhone && styles.topBarCompact,
              useCenteredTabletTopBar && styles.topBarTablet,
            ]}
          >
            <View
              style={[
                styles.topIdentity,
                isCompactPhone && styles.topIdentityCompact,
                useCenteredTabletTopBar && styles.topIdentityTablet,
              ]}
            >
              <View style={styles.topIdentityHeader}>
                <Image source={MOBILE_BRAND_ICON} style={styles.topBrandLogo} resizeMode="cover" />
                <Text
                  style={[
                    styles.topTitle,
                    isCompactPhone && styles.topTitleCompact,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {session.displayName || "BFZoom"}
                </Text>
              </View>
              <Text
                style={[
                  styles.modeBadge,
                  isCompactPhone && styles.modeBadgeCompact,
                ]}
              >
                {roleModeLabel}
              </Text>
            </View>
            <View
              style={[
                styles.topMetaActions,
                isCompactPhone && styles.topMetaActionsCompact,
                useCenteredTabletTopBar && styles.topMetaActionsTablet,
              ]}
            >
              <View
                style={[
                  styles.topLocaleRow,
                  isCompactPhone && styles.topLocaleRowCompact,
                ]}
              >
                <LanguageSwitcher compact inverted />
              </View>
              <View
                style={[
                  styles.topActions,
                  isCompactPhone && styles.topActionsCompact,
                  useCenteredTabletTopBar && styles.topActionsTablet,
                ]}
              >
              {isHostSession ? (
                <Pressable
                  onPress={shareRoomAccess}
                  style={[styles.shareButton, useCenteredTabletTopBar && styles.topActionButtonTablet]}
                >
                  <Text style={styles.shareText}>{ui.share}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={endRoomForAll}
                style={[
                  styles.leaveButton,
                  leavePending && styles.leaveButtonDisabled,
                  useCenteredTabletTopBar && styles.topActionButtonTablet,
                ]}
                disabled={leavePending}
              >
                <Text style={styles.leaveText}>{leaveButtonLabel}</Text>
              </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {sessionError ? (
        <Text style={styles.error} numberOfLines={3} ellipsizeMode="tail">
          {sessionError}
        </Text>
      ) : null}

      <RoomContext.Provider key={roomContextKey} value={liveKitRoom}>
        <RoomView
          key={roomContextKey}
          session={session}
          connected={connected}
          immersiveMode={immersiveMode}
          setImmersiveMode={setImmersiveMode}
          isAudioOnlyCall={isAudioOnlyCall}
          onLeave={handleLeaveRequest}
          onEndForAll={endRoomForAll}
        />
      </RoomContext.Provider>
    </View>
  );
}

function RoomView({
  session,
  connected,
  immersiveMode,
  setImmersiveMode,
  isAudioOnlyCall,
  onLeave,
  onEndForAll,
}: {
  session: MobileCallSession;
  connected: boolean;
  immersiveMode: boolean;
  setImmersiveMode: (next: boolean | ((value: boolean) => boolean)) => void;
  isAudioOnlyCall: boolean;
  onLeave: (reason?: string) => void;
  onEndForAll: () => void;
}) {
  const { language } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isTabletLayout = detectTabletLayout(viewportWidth, viewportHeight);
  const isCompactPhone = !isTabletLayout && viewportWidth <= 430;
  const isVeryCompactPhone =
    !isTabletLayout && (viewportWidth <= 380 || viewportHeight <= 760);
  const immersiveControlsTopOffset = Math.max(insets.top, 0) + 10;
  const immersiveSubtitleTopOffset = immersiveControlsTopOffset + 54;
  const preferSpeakerForCall = Platform.OS === "ios";
  const room = useRoomContext();
  const canPublishRoomData = () => {
    return (
      connected &&
      appStateRef.current === "active" &&
      room.state === ConnectionState.Connected
    );
  };
  const isHostSession = session.role === "host";
  const ui = useMemo(
    () =>
      language === "fr"
        ? {
            translationUnlockHint:
              "Traduction indisponible: tes 3 minutes d'essai gratuit sont epuisees et tu n'as plus de minutes de traduction actives. La visio simple reste disponible.",
            translationWaitHostHint:
              "Traduction en attente: l'hote doit disposer de minutes offertes ou de minutes de traduction actives.",
            creditsLoading: "Minutes...",
            creditsUnlimited: "Minutes illimitees",
            creditsPremium: "Premium",
            minutesLeft: (minutes: number) => `${minutes} min restantes`,
            topUpRequired: "Recharge requise",
            creditsPageOpenFailed: "Impossible d'ouvrir la page de recharge pour le moment.",
            reviewBeforeSend: "Verifie avant envoi",
            translating: "Traduction...",
            micInit: "Initialisation du micro...",
            analyzing: "Analyse...",
            speakNow: "Parle maintenant",
            translationUnavailable: "Traduction indisponible",
            otherParticipantSpeaking: (name: string) => `${name} parle en ce moment`,
            pressAndRelease: "Appuie puis relache pour traduire",
            correctFirst: "Corrige d'abord",
            micShort: "Micro...",
            sending: "Envoi...",
            release: "Relache",
            locked: "Verrouille",
            busy: "Occupe",
            holdToTalk: "Maintiens pour parler",
            cancel: "Annuler",
            leaveCall: "Quitter",
            endForAll: "Terminer pour tous",
            exitFullscreen: "Quitter plein ecran",
            talkieBusyBy: (name: string) => `Talkie occupe par ${name}.`,
            topUpNow: "Recharger maintenant",
            addMinutes: "Ajouter des minutes",
            topUpFromDashboard:
              "Ajoute des minutes depuis le dashboard iOS apres cet appel.",
            audioCallTitle: "Appel audio BFZoom",
            connected: "Connecté",
            connecting: "Connexion...",
            participants: (count: number) => `Interlocuteur${count > 1 ? "s" : ""}: ${count}`,
            audioChannelActive: "Canal audio actif. Tu peux parler normalement.",
            waitingParticipant: "En attente du participant...",
            noAnswerAutoLeave:
              "Aucun participant n'a rejoint l'appel. Retour automatique en cours...",
            participantLeftAutoLeave:
              "Le participant a quitté l'appel. Retour automatique en cours...",
            participantLeftWaiting:
              "Le participant s'est déconnecté. En attente de reconnexion...",
            micOn: "Mic on",
            micOff: "Mic off",
            noCameraTrack: "Aucune piste camera pour le moment.",
            translationMenuHide: "Masquer traduction",
            translationMenuShow: "Menu traduction",
            translation: "Traduction",
            languageYouSpeak: "Langue que tu parles",
            receptionLanguage: "Langue de reception",
            swap: "Inverser",
            hostTranslationRemaining: (value: string) => `Temps traduction restant (hote): ${value}`,
            stable: "Stable",
            reconnecting: "Reconnexion...",
            signal: "Signal...",
            pinned: "Epingle",
            autoSpeaker: "Auto speaker",
            manual: "Manuel",
            correctBeforeSendTitle: "Corriger avant envoi",
            keyboard: "Clavier",
            send: "Envoyer",
            reviewTextThenSend: "Verifie ton texte, puis envoie la version corrigee.",
            correctTextPlaceholder: "Corrige ton texte si besoin...",
            fullScreen: "Plein ecran",
            reload: "Recharger",
            speaker: "Intervenant",
            source: "Source",
            close: "Fermer",
            controls: "Controles",
            subtitleLayout: "Texte source",
            subtitleLayoutDual: "Afficher",
            subtitleLayoutTranslationOnly: "Masquer",
            translatedVoiceSetting: "Voix traduite sur cet iPhone",
            translatedVoiceOn: "Lire",
            translatedVoiceOff: "Couper",
            fullTranslationSetting: "Traduction complete",
            viewFullTranslation: "Voir tout",
            tapSubtitleToExpand: "Touchez une bulle ou Voir tout pour agrandir",
            translatedVoiceMutedBadge: "Voix traduite coupee",
            translationTalkieMeta: (source: string, target: string) =>
              `${source} → ${target} · Talkie`,
            autoSpeakerToggle: (enabled: boolean) => `Auto speaker ${enabled ? "On" : "Off"}`,
            unpinFocus: "Retirer le focus",
            pinFocus: "Epingler le focus",
            translationActive: "Talkie traduction actif",
            holdSpeakRelease:
              'Maintiens "Maintenir pour parler", parle, puis relache pour traduire.',
            captionsShared: "Les sous-titres sont partages avec tous les participants.",
            smallGroupRecommendation: "Optimise pour 2 a 4 participants sur iPhone.",
            groupVoicePlaybackLimited:
              "En groupe, la voix traduite auto est desactivee pour garder l'appel clair. Utilise Reecouter si besoin.",
            groupSizeWarning: (count: number) =>
              `Appel a ${count} participants: au-dela de 4, l'experience traduction iPhone peut se degrader.`,
            checkingCredits: "Verification des minutes de traduction...",
            translatedVoiceUnavailable: (languageLabel: string) =>
              `Voix native ${languageLabel} haute qualite absente sur cet iPhone. BFZoom utilisera la voix IA pour un rendu plus naturel. Pour mieux faire: Reglages > Accessibilite > Contenu enonce > Voix.`,
            verifyTextBeforeSend: "Verifie ton texte avant envoi",
            closeKeyboard: "Fermer clavier",
            retranslateBusy: "Retraduction...",
            retranslate: "Retraduire",
            replayBusy: "Reecoute...",
            replay: "Reecouter",
            phoneticLoading: "Phonetique: generation...",
            phonetic: (value: string) => `Phonetique: ${value}`,
            translationUnavailableError: "Traduction indisponible.",
            translationForbidden:
              "Traduction refusee pour ce compte. Le texte source reste visible.",
            translationFallback: (message: string) =>
              `Traduction indisponible, fallback texte source: ${message}`,
            speakAtLeastOneSecond:
              "Parle au moins une seconde avant de lancer la traduction.",
            audioNotFinalized: "Audio non finalise. Relache puis reessaie.",
            audioTooShort: "Audio invalide ou trop court. Parle 1-2 secondes puis reessaie.",
            meSuffix: " (moi)",
            languageAlertTitle: "Langue",
            frontCamera: "Camera avant",
            backCamera: "Camera arriere",
            cameraOn: "Cam on",
            cameraOff: "Cam off",
            camera: "Camera",
            tracks: "Pistes",
          }
        : {
            translationUnlockHint:
              "Translation unavailable: your 3 free trial minutes are used up and you have no active translation minutes left. Basic video calls remain available.",
            translationWaitHostHint:
              "Translation pending: the host must have free minutes or active translation minutes.",
            creditsLoading: "Minutes...",
            creditsUnlimited: "Unlimited minutes",
            creditsPremium: "Premium",
            minutesLeft: (minutes: number) => `${minutes} min left`,
            topUpRequired: "Top up required",
            creditsPageOpenFailed: "Unable to open the top-up page right now.",
            reviewBeforeSend: "Review before sending",
            translating: "Translating...",
            micInit: "Starting microphone...",
            analyzing: "Analyzing...",
            speakNow: "Speak now",
            translationUnavailable: "Translation unavailable",
            otherParticipantSpeaking: (name: string) => `${name} is speaking right now`,
            pressAndRelease: "Press and release to translate",
            correctFirst: "Correct first",
            micShort: "Mic...",
            sending: "Sending...",
            release: "Release",
            locked: "Locked",
            busy: "Busy",
            holdToTalk: "Hold to talk",
            cancel: "Cancel",
            leaveCall: "Leave",
            endForAll: "End for all",
            exitFullscreen: "Exit fullscreen",
            talkieBusyBy: (name: string) => `Talkie is busy with ${name}.`,
            topUpNow: "Top up now",
            addMinutes: "Add minutes",
            topUpFromDashboard: "Add minutes from the iOS dashboard after this call.",
            audioCallTitle: "BFZoom audio call",
            connected: "Connected",
            connecting: "Connecting...",
            participants: (count: number) => `Participant${count > 1 ? "s" : ""}: ${count}`,
            audioChannelActive: "Audio channel is active. You can speak normally.",
            waitingParticipant: "Waiting for participant...",
            noAnswerAutoLeave:
              "No participant joined the call. Returning automatically...",
            participantLeftAutoLeave:
              "The participant left the call. Returning automatically...",
            participantLeftWaiting:
              "The participant disconnected. Waiting for reconnection...",
            micOn: "Mic on",
            micOff: "Mic off",
            noCameraTrack: "No camera track for now.",
            translationMenuHide: "Hide translation",
            translationMenuShow: "Translation menu",
            translation: "Translation",
            languageYouSpeak: "Language you speak",
            receptionLanguage: "Reception language",
            swap: "Swap",
            hostTranslationRemaining: (value: string) => `Host translation time left: ${value}`,
            stable: "Stable",
            reconnecting: "Reconnecting...",
            signal: "Signal...",
            pinned: "Pinned",
            autoSpeaker: "Auto speaker",
            manual: "Manual",
            correctBeforeSendTitle: "Correct before sending",
            keyboard: "Keyboard",
            send: "Send",
            reviewTextThenSend: "Review your text, then send the corrected version.",
            correctTextPlaceholder: "Correct your text if needed...",
            fullScreen: "Fullscreen",
            reload: "Top up",
            speaker: "Speaker",
            source: "Source",
            close: "Close",
            controls: "Controls",
            subtitleLayout: "Source text",
            subtitleLayoutDual: "Show",
            subtitleLayoutTranslationOnly: "Hide",
            translatedVoiceSetting: "Translated voice on this iPhone",
            translatedVoiceOn: "Play",
            translatedVoiceOff: "Mute",
            fullTranslationSetting: "Full translation",
            viewFullTranslation: "View all",
            tapSubtitleToExpand: "Tap a bubble or View all to expand",
            translatedVoiceMutedBadge: "Translated voice muted",
            translationTalkieMeta: (source: string, target: string) =>
              `${source} → ${target} · Talkie`,
            autoSpeakerToggle: (enabled: boolean) => `Auto speaker ${enabled ? "On" : "Off"}`,
            unpinFocus: "Unpin focus",
            pinFocus: "Pin focus",
            translationActive: "Translation talkie is active",
            holdSpeakRelease: 'Hold "Hold to talk", speak, then release to translate.',
            captionsShared: "Captions are shared with all participants.",
            smallGroupRecommendation: "Optimized for 2 to 4 participants on iPhone.",
            groupVoicePlaybackLimited:
              "In group calls, automatic translated voice is disabled to keep the call clear. Use Replay when needed.",
            groupSizeWarning: (count: number) =>
              `Call with ${count} participants: beyond 4, the iPhone translation experience may degrade.`,
            checkingCredits: "Checking translation minutes...",
            translatedVoiceUnavailable: (languageLabel: string) =>
              `No high-quality native ${languageLabel} voice is installed on this iPhone. BFZoom will use the AI voice for a more natural result. For the best result: Settings > Accessibility > Spoken Content > Voices.`,
            verifyTextBeforeSend: "Review your text before sending",
            closeKeyboard: "Hide keyboard",
            retranslateBusy: "Retranslating...",
            retranslate: "Retranslate",
            replayBusy: "Replaying...",
            replay: "Replay",
            phoneticLoading: "Phonetic: generating...",
            phonetic: (value: string) => `Phonetic: ${value}`,
            translationUnavailableError: "Translation unavailable.",
            translationForbidden:
              "Translation is blocked for this account. The source text remains visible.",
            translationFallback: (message: string) =>
              `Translation unavailable, falling back to source text: ${message}`,
            speakAtLeastOneSecond: "Speak for at least one second before translating.",
            audioNotFinalized: "Audio is not finalized yet. Release and try again.",
            audioTooShort: "Audio is invalid or too short. Speak for 1-2 seconds and try again.",
            meSuffix: " (me)",
            languageAlertTitle: "Language",
            frontCamera: "Front camera",
            backCamera: "Back camera",
            cameraOn: "Cam on",
            cameraOff: "Cam off",
            camera: "Camera",
            tracks: "Tracks",
          },
    [language]
  );
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const cameraTrackSources = useMemo(() => [Track.Source.Camera], []);
  const remoteAudioTrackSources = useMemo(
    () => [
      { source: Track.Source.ScreenShareAudio, withPlaceholder: false },
      { source: Track.Source.Microphone, withPlaceholder: false },
    ],
    []
  );
  const remoteAudioTrackQuery = useMemo(
    () => ({
      onlySubscribed: true,
    }),
    []
  );
  const cameraTracks = useTracks(cameraTrackSources);
  const remoteAudioTracks = useTracks(remoteAudioTrackSources, remoteAudioTrackQuery);
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [focusedTrackKey, setFocusedTrackKey] = useState<string | null>(null);
  const [videoFullscreen, setVideoFullscreen] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [translationPanelOpen, setTranslationPanelOpen] = useState(false);
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
  const [participantReconnectPending, setParticipantReconnectPending] = useState(false);
  const [waitingForParticipant, setWaitingForParticipant] = useState(false);
  const [roomLifecycleTick, setRoomLifecycleTick] = useState(0);
  const [currentBearerToken, setCurrentBearerToken] = useState(() =>
    (session.bearerToken || "").trim()
  );
  const appStateRef = useRef(AppState.currentState);
  const roomHeartbeatInFlightRef = useRef(false);
  const roomHeartbeatAbortControllerRef = useRef<AbortController | null>(null);
  const callAudioOwnerKey = useMemo(
    () => `${session.roomId}:${session.identity}:${session.role}`,
    [session.identity, session.role, session.roomId]
  );
  const appWasActiveRef = useRef(AppState.currentState === "active");
  const keepAwakeActiveRef = useRef(false);
  const [translationEntitlement, setTranslationEntitlement] =
    useState<TranslationEntitlementState>(DEFAULT_TRANSLATION_ENTITLEMENT);
  const [roomTranslationEnabled, setRoomTranslationEnabled] = useState(false);
  const [roomTranslationReason, setRoomTranslationReason] = useState("");
  const [roomTranslationRemainingSeconds, setRoomTranslationRemainingSeconds] =
    useState<number | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [captionPhoneticText, setCaptionPhoneticText] = useState("");
  const [captionPhoneticBusy, setCaptionPhoneticBusy] = useState(false);
  const [captionPhoneticTrigger, setCaptionPhoneticTrigger] = useState(0);
  const [sourceText, setSourceText] = useState("");
  const [subtitleSpeakerLabel, setSubtitleSpeakerLabel] = useState("");
  const [subtitleDisplayMode, setSubtitleDisplayMode] =
    useState<SubtitleDisplayMode>("translationOnly");
  const [localPreviewCorner, setLocalPreviewCorner] =
    useState<PreviewCorner>(IOS_PREVIEW_DEFAULT_CORNER);
  const [expandedSubtitleKind, setExpandedSubtitleKind] =
    useState<ExpandedSubtitleKind>(null);
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
  const [videoCaptureProfile, setVideoCaptureProfile] = useState<"balanced" | "low">("balanced");
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
  const audioTransitionChainRef = useRef<Promise<void>>(Promise.resolve());
  const expoAudioModeRef = useRef<"idle" | "playback" | "recording">("idle");
  const roomAudioInstanceActiveRef = useRef(true);

  useEffect(() => {
    roomAudioInstanceActiveRef.current = true;
    return () => {
      roomAudioInstanceActiveRef.current = false;
    };
  }, []);

  const syncCallKeepAwake = useCallback(async (nextAppState: string) => {
    const shouldKeepAwake = nextAppState === "active";
    try {
      if (shouldKeepAwake) {
        await activateKeepAwakeAsync(CALL_KEEP_AWAKE_TAG);
        keepAwakeActiveRef.current = true;
        return;
      }
      if (!keepAwakeActiveRef.current) return;
      await deactivateKeepAwake(CALL_KEEP_AWAKE_TAG);
      keepAwakeActiveRef.current = false;
    } catch {}
  }, []);
  const releaseExpoAudioActivity = useCallback(async () => {
    if (!roomAudioInstanceActiveRef.current) return;
    if (manualRecordingStartedAtRef.current > 0) return;
    if (Platform.OS === "ios") {
      if (
        sharedActiveCallAudioOwnerKey &&
        sharedActiveCallAudioOwnerKey !== callAudioOwnerKey
      ) {
        return;
      }
      sharedExpoAudioMode = "idle";
      expoAudioModeRef.current = "idle";
      return;
    }
    await setIsAudioActiveAsync(false).catch(() => {});
    expoAudioModeRef.current = "idle";
  }, [callAudioOwnerKey]);
  const abortActiveTranscription = useCallback(() => {
    const controller = activeTranscriptionAbortControllerRef.current;
    if (!controller) return;
    activeTranscriptionAbortControllerRef.current = null;
    controller.abort();
  }, []);
  const ttsPlayerMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsPlaybackWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsTempFileRef = useRef("");
  const ttsRequestSeqRef = useRef(0);
  const ttsPlaybackSessionRef = useRef(0);
  const ttsPlaybackMetaRef = useRef<TtsPlaybackMeta | null>(null);
  const activeTranscriptionAbortControllerRef = useRef<AbortController | null>(null);
  const ttsRemoteAudioDuckedRef = useRef(false);
  const mediaRecoveryCooldownUntilRef = useRef(0);
  const translationConsumeQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const sourceTextLanguageRef = useRef<LanguageCode>("fr");
  const incomingTranslationSeqRef = useRef(0);
  const manualDraftLatencyRef = useRef<ManualDraftLatencyState | null>(null);
  const captionPhoneticSeqRef = useRef(0);
  const captionPhoneticQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCaptionPhoneticRef = useRef<CaptionPhoneticJob | null>(null);
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
  const cameraAutoStartInFlightRef = useRef(false);
  const cameraForegroundRecoveryInFlightRef = useRef(false);
  const cameraHealthRecoveryInFlightRef = useRef(false);
  const lastCameraForegroundRecoveryAtRef = useRef(0);
  const lastCameraHealthRecoveryAtRef = useRef(0);
  const previousRemoteTrackCountRef = useRef(0);
  const lastAppliedVideoCaptureProfileRef = useRef<"balanced" | "low">("balanced");
  const applyVirtualBackgroundEffectRef = useRef<(() => Promise<boolean>) | null>(null);
  const autoMicEnsuredRef = useRef(false);
  const manualRecordingStartedAtRef = useRef(0);
  const manualPushToTalkPressedRef = useRef(false);
  const manualStartInFlightRef = useRef(false);
  const pendingStopAfterStartRef = useRef(false);
  const recordingStartUriRef = useRef("");
  const lastProcessedRecordingUriRef = useRef("");
  const stopTranslateInFlightRef = useRef(false);
  const manualStopRequestIdRef = useRef(0);
  const talkieLockHolderRef = useRef("");
  const talkieLockExpiresAtRef = useRef(0);
  const talkieLockClaimedAtRef = useRef(0);
  const talkieLockLastSettledAtRef = useRef(0);
  const talkieLockCaptionConsumedRef = useRef(false);
  const talkieLockLastReleasedHolderRef = useRef("");
  const talkieLockLastReleasedAtRef = useRef(0);
  const talkieLockLastReleasedClaimStartedAtRef = useRef(0);
  const talkieLockLastReleaseCaptionConsumedRef = useRef(false);
  const talkieLockTimestampRef = useRef(0);
  const talkieLockExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkiePulseOpacityRef = useRef(new Animated.Value(1));
  const talkiePulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const manualStartRequestIdRef = useRef(0);
  const manualStartAnimationFrameRef = useRef<number | null>(null);
  const realtimeSessionIdRef = useRef(0);
  const replayButtonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retranslateButtonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translatorWorkerEnsureKeyRef = useRef("");
  const translatorWorkerReleaseRoomRef = useRef("");
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
  const desiredCameraCaptureOptions = useMemo(
    () => ({
      facingMode: cameraFacingMode,
      resolution:
        videoCaptureProfile === "low"
          ? IOS_VISIO_LOW_SIGNAL_VIDEO_RESOLUTION
          : IOS_VISIO_BALANCED_VIDEO_RESOLUTION,
    }),
    [cameraFacingMode, videoCaptureProfile]
  );
  const recoverCameraAfterForeground = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    if (!connected || isAudioOnlyCall || !startWithCamera) return;
    if (!localParticipant || !isCameraEnabled) return;
    if (cameraAutoStartInFlightRef.current) return;

    const now = Date.now();
    if (
      cameraForegroundRecoveryInFlightRef.current ||
      now - lastCameraForegroundRecoveryAtRef.current < IOS_CAMERA_FOREGROUND_RECOVERY_COOLDOWN_MS
    ) {
      return;
    }

    cameraForegroundRecoveryInFlightRef.current = true;
    try {
      await wait(IOS_CAMERA_FOREGROUND_RECOVERY_DELAY_MS);
      if (appStateRef.current !== "active") return;

      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const videoTrack = publication?.videoTrack;
      lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
      if (videoTrack) {
        await videoTrack.restartTrack(desiredCameraCaptureOptions);
      } else {
        await localParticipant.setCameraEnabled(true, desiredCameraCaptureOptions);
      }

      cameraAutoStartedRef.current = true;
      lastCameraForegroundRecoveryAtRef.current = Date.now();
      setTranslationError((current) => (/camera/i.test(current) ? "" : current));
      const reapplyVirtualBackground = applyVirtualBackgroundEffectRef.current;
      if (reapplyVirtualBackground) {
        await reapplyVirtualBackground().catch(() => false);
      }
    } catch (err) {
      setTranslationError(
        err instanceof Error
          ? err.message
          : language === "fr"
            ? "Echec reprise camera apres retour au premier plan."
            : "Camera recovery after returning to foreground failed."
      );
    } finally {
      cameraForegroundRecoveryInFlightRef.current = false;
    }
  }, [
    connected,
    desiredCameraCaptureOptions,
    isAudioOnlyCall,
    isCameraEnabled,
    language,
    localParticipant,
    startWithCamera,
    videoCaptureProfile,
  ]);
  const effectiveTranslationEnabled = isHostSession
    ? translationEntitlement.enabled
    : roomTranslationEnabled;
  const effectiveTranslationLockMessage = effectiveTranslationEnabled
    ? ""
    : isHostSession
      ? translationEntitlement.lockReason || ui.translationUnlockHint
      : roomTranslationReason || ui.translationWaitHostHint;
  const effectiveTranslationRemainingSeconds = isHostSession
    ? translationEntitlement.totalSecondsRemaining
    : roomTranslationRemainingSeconds;
  const translationRemainingLabel = formatTranslationRemaining(
    effectiveTranslationRemainingSeconds
  );
  const translationRemainingMinutes =
    typeof effectiveTranslationRemainingSeconds === "number" &&
    Number.isFinite(effectiveTranslationRemainingSeconds)
      ? Math.max(0, Math.ceil(effectiveTranslationRemainingSeconds / 60))
      : null;
  const shouldShowInCallTopUp =
    isHostSession &&
    (!effectiveTranslationEnabled ||
      (typeof effectiveTranslationRemainingSeconds === "number" &&
        Number.isFinite(effectiveTranslationRemainingSeconds) &&
        effectiveTranslationRemainingSeconds <= 5 * 60));
  const translationCreditsBadgeLabel = translationEntitlement.loading
    ? ui.creditsLoading
    : translationEntitlement.isAdmin
      ? ui.creditsUnlimited
      : translationEntitlement.isPremium
        ? ui.creditsPremium
        : translationRemainingMinutes !== null
          ? ui.minutesLeft(translationRemainingMinutes)
          : ui.topUpRequired;
  const translationControlsDisabled = !effectiveTranslationEnabled;
  const languagePairSummary = `${sourceLanguage.toUpperCase()} → ${targetLanguage.toUpperCase()}`;
  const swapLanguages = useCallback(() => {
    const previousSourceLanguage = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(previousSourceLanguage);
  }, [sourceLanguage, targetLanguage]);
  const topStatusBadgeLabel = translationRemainingLabel
    ? ui.hostTranslationRemaining(translationRemainingLabel)
    : isHostSession
      ? translationCreditsBadgeLabel
      : "";

  useEffect(() => {
    setCurrentBearerToken((session.bearerToken || "").trim());
  }, [session.bearerToken]);

  const refreshBearerToken = useCallback(
    async (forceRefresh = false) => {
      const fallbackToken = (currentBearerToken || session.bearerToken || "").trim();
      const currentUser = auth?.currentUser;
      if (!currentUser) return fallbackToken;
      try {
        const nextToken = (await currentUser.getIdToken(forceRefresh)).trim();
        if (nextToken && nextToken !== fallbackToken) {
          setCurrentBearerToken(nextToken);
        }
        return nextToken || fallbackToken;
      } catch {
        return fallbackToken;
      }
    },
    [currentBearerToken, session.bearerToken]
  );

  const sendRoomHeartbeat = useCallback(async () => {
    if (!isHostSession || session.originModule === "chat") return;
    if (!connected) return;
    if (appStateRef.current !== "active") return;
    if (
      room.state !== ConnectionState.Connected &&
      room.state !== ConnectionState.Reconnecting &&
      room.state !== ConnectionState.SignalReconnecting
    ) {
      return;
    }
    if (roomHeartbeatInFlightRef.current) return;
    const apiBaseUrl = session.apiBaseUrl.trim().replace(/\/+$/, "");
    const roomId = session.roomId.trim();
    if (!apiBaseUrl || !roomId) return;

    const bearerToken = (await refreshBearerToken()).trim();
    if (!bearerToken) return;

    roomHeartbeatInFlightRef.current = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    roomHeartbeatAbortControllerRef.current?.abort();
    roomHeartbeatAbortControllerRef.current = controller;
    const timeoutId = setTimeout(() => {
      controller?.abort();
    }, ROOM_HEARTBEAT_TIMEOUT_MS);

    try {
      await fetch(`${apiBaseUrl}/api/livekit/room/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ room: roomId }),
        signal: controller?.signal,
      });
    } catch {
      // Heartbeat failure should not disrupt the active call UI.
    } finally {
      clearTimeout(timeoutId);
      if (roomHeartbeatAbortControllerRef.current === controller) {
        roomHeartbeatAbortControllerRef.current = null;
      }
      roomHeartbeatInFlightRef.current = false;
    }
  }, [
    connected,
    isHostSession,
    refreshBearerToken,
    room,
    session.apiBaseUrl,
    session.originModule,
    session.roomId,
  ]);

  useEffect(() => {
    if (!isHostSession || session.originModule === "chat" || !connected) return;
    void sendRoomHeartbeat();
    const intervalId = setInterval(() => {
      void sendRoomHeartbeat();
    }, ROOM_HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [connected, isHostSession, sendRoomHeartbeat, session.originModule]);

  useEffect(() => {
    if (!isHostSession || session.originModule === "chat" || !connected) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void sendRoomHeartbeat();
      }
    });
    return () => subscription.remove();
  }, [connected, isHostSession, sendRoomHeartbeat, session.originModule]);

  useEffect(() => {
    return () => {
      roomHeartbeatAbortControllerRef.current?.abort();
      roomHeartbeatAbortControllerRef.current = null;
      roomHeartbeatInFlightRef.current = false;
    };
  }, []);

  const isAuthRetryableError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || "");
    return /401|unauthorized|session expir/i.test(message);
  }, []);

  const withFreshBearerToken = useCallback(
    async (request: (token: string) => Promise<any>) => {
      const initialToken = await refreshBearerToken();
      try {
        return await request(initialToken);
      } catch (error) {
        if (!isAuthRetryableError(error)) throw error;
        const refreshedToken = await refreshBearerToken(true);
        if (!refreshedToken || refreshedToken === initialToken) {
          throw error;
        }
        return request(refreshedToken);
      }
    },
    [isAuthRetryableError, refreshBearerToken]
  );

  const refreshTranslationEntitlement = useCallback(async () => {
    if (!isHostSession) {
      setTranslationEntitlement({
        ...DEFAULT_TRANSLATION_ENTITLEMENT,
        lockReason: ui.translationWaitHostHint,
        loading: false,
      });
      return;
    }
    const bearerToken = await refreshBearerToken();
    if (!bearerToken) {
      setTranslationEntitlement({
        ...DEFAULT_TRANSLATION_ENTITLEMENT,
        loading: false,
        lockReason: ui.translationUnlockHint,
      });
      return;
    }
    setTranslationEntitlement((prev) => ({ ...prev, loading: true }));
    try {
      const response = await withFreshBearerToken(async (activeBearerToken) => {
        const nextResponse = await fetch(`${publicApiBase}/api/translation/entitlement`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${activeBearerToken}`,
          },
          cache: "no-store",
        });
        if (nextResponse.status === 401) {
          throw new Error("Unauthorized");
        }
        return nextResponse;
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setTranslationEntitlement({
          ...DEFAULT_TRANSLATION_ENTITLEMENT,
          loading: false,
          lockReason: ui.translationUnlockHint,
        });
        return;
      }
      setTranslationEntitlement(normalizeTranslationEntitlement(payload));
    } catch {
      setTranslationEntitlement({
        ...DEFAULT_TRANSLATION_ENTITLEMENT,
        loading: false,
        lockReason: ui.translationUnlockHint,
      });
    }
  }, [isHostSession, publicApiBase, refreshBearerToken, ui.translationUnlockHint, ui.translationWaitHostHint, withFreshBearerToken]);

  const consumeTranslationSeconds = useCallback(
    async (seconds: number, origin: "local" | "remote") => {
      if (!isHostSession) return true;
      const bearerToken = await refreshBearerToken();
      if (!bearerToken) return false;
      if (translationEntitlement.isAdmin || translationEntitlement.isPremium) return true;
      const safeSeconds = Math.max(1, Math.min(300, Math.floor(seconds || 1)));

      const runConsume = async () => {
        try {
          const response = await withFreshBearerToken(async (activeBearerToken) => {
            const nextResponse = await fetch(`${publicApiBase}/api/translation/consume`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${activeBearerToken}`,
              },
              body: JSON.stringify({
                seconds: safeSeconds,
                origin,
                roomId: session.roomId,
              }),
            });
            if (nextResponse.status === 401) {
              throw new Error("Unauthorized");
            }
            return nextResponse;
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
          if (
            response.status === 402 ||
            response.status === 401 ||
            response.status === 403 ||
            response.status === 429
          ) {
            return false;
          }
          if (!response.ok) {
            return false;
          }
          return true;
        } catch {
          return false;
        }
      };

      const queued = translationConsumeQueueRef.current.catch(() => true).then(runConsume);
      translationConsumeQueueRef.current = queued;
      return queued;
    },
    [
      isHostSession,
      publicApiBase,
      refreshBearerToken,
      session.roomId,
      translationEntitlement.isAdmin,
      translationEntitlement.isPremium,
      withFreshBearerToken,
    ]
  );

  const broadcastRoomTranslationAccess = useCallback(async () => {
    if (!isHostSession || !localParticipant) return;
    if (!canPublishRoomData()) return;
    const payload: TranslationAccessPayload = {
      roomId: session.roomId,
      enabled: translationEntitlement.enabled,
      reason: translationEntitlement.lockReason || ui.translationUnlockHint,
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
    connected,
    isHostSession,
    localParticipant,
    room,
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
    if (!isHostSession || !connected || !localParticipant) return;
    const syncTimer = setInterval(() => {
      void broadcastRoomTranslationAccess();
    }, 1500);
    return () => clearInterval(syncTimer);
  }, [broadcastRoomTranslationAccess, connected, isHostSession, localParticipant]);

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
    talkieUiState === "recording" || (recordingActive && manualPushToTalkPressedRef.current);
  const talkieBusyVisual =
    translationBusy ||
    manualDraftVisible ||
    manualDraftSending ||
    talkieUiState === "starting" ||
    talkieUiState === "stopping";
  const talkiePulseEnabled = talkieLooksRecording;
  const talkieStatusTone =
    talkieUiState === "review" || manualDraftVisible || manualDraftSending
      ? "review"
      : translationControlsDisabled || isTalkieLockedByOther
        ? "warning"
        : talkieUiState === "starting" || talkieUiState === "stopping" || translationBusy
          ? "busy"
          : talkieLooksRecording
            ? "active"
            : "idle";
  const talkieStatusLabel =
    talkieUiState === "review" || manualDraftVisible
      ? ui.reviewBeforeSend
      : manualDraftSending
        ? ui.translating
        : talkieUiState === "starting"
          ? ui.micInit
          : talkieUiState === "stopping" || translationBusy
            ? ui.analyzing
            : talkieLooksRecording
              ? ui.speakNow
              : translationControlsDisabled
                ? ui.translationUnavailable
                : isTalkieLockedByOther
                  ? ui.otherParticipantSpeaking(talkieLockHolderName || "BFZoom")
                  : ui.pressAndRelease;
  const talkieButtonLabel =
    talkieUiState === "review" || manualDraftVisible
      ? ui.correctFirst
      : talkieUiState === "starting"
      ? ui.micShort
      : talkieUiState === "stopping" || translationBusy
        ? ui.analyzing
        : manualDraftSending
          ? ui.sending
        : talkieLooksRecording
          ? ui.release
          : translationControlsDisabled
            ? ui.locked
            : isTalkieLockedByOther
              ? ui.busy
              : ui.holdToTalk;

  const getRemoteParticipantByIdentity = useCallback(
    (identity?: string | null) => {
      const normalizedIdentity = String(identity || "").trim();
      if (!normalizedIdentity) return null;
      return room?.remoteParticipants.get(normalizedIdentity) || null;
    },
    [room]
  );

  const getParticipantRole = useCallback(
    (identity?: string | null): RoomParticipantRole => {
      const normalizedIdentity = String(identity || "").trim();
      if (!normalizedIdentity) return null;
      if (normalizedIdentity === session.identity) {
        return isHostSession ? "host" : "guest";
      }
      const participant = getRemoteParticipantByIdentity(normalizedIdentity);
      return getParticipantRoleFromMetadata(participant?.metadata);
    },
    [getRemoteParticipantByIdentity, isHostSession, session.identity]
  );

  const isTrustedHumanParticipantIdentity = useCallback(
    (identity?: string | null) => {
      const normalizedIdentity = String(identity || "").trim();
      if (!normalizedIdentity) return false;
      if (normalizedIdentity === session.identity) return true;
      const participant = getRemoteParticipantByIdentity(normalizedIdentity);
      if (!participant) return false;
      return getParticipantRoleFromMetadata(participant.metadata) !== "translator";
    },
    [getRemoteParticipantByIdentity, session.identity]
  );

  const countHumanRemoteParticipants = useCallback(() => {
    if (!room) return 0;
    let count = 0;
    room.remoteParticipants.forEach((participant) => {
      if (isTranslatorIdentity(participant.identity || "")) return;
      if (getParticipantRoleFromMetadata(participant.metadata) === "translator") return;
      count += 1;
    });
    return count;
  }, [room]);

  const clearRecentTalkieRelease = useCallback(() => {
    talkieLockLastReleasedHolderRef.current = "";
    talkieLockLastReleasedAtRef.current = 0;
    talkieLockLastReleasedClaimStartedAtRef.current = 0;
    talkieLockLastReleaseCaptionConsumedRef.current = false;
  }, []);

  const estimateVerifiedRemoteUsageSeconds = useCallback((senderIdentity: string) => {
    const normalizedSenderIdentity = senderIdentity.trim();
    if (!normalizedSenderIdentity) return null;
    const now = Date.now();
    if (
      normalizedSenderIdentity === talkieLockHolderRef.current &&
      talkieLockExpiresAtRef.current > now &&
      !talkieLockCaptionConsumedRef.current
    ) {
      const claimStartedAt = talkieLockClaimedAtRef.current || now;
      const settledAt = talkieLockLastSettledAtRef.current || claimStartedAt;
      talkieLockLastSettledAtRef.current = now;
      talkieLockCaptionConsumedRef.current = true;
      return estimateTalkieUsageSeconds(Math.max(claimStartedAt, settledAt), now);
    }

    const releasedAt = talkieLockLastReleasedAtRef.current;
    if (
      normalizedSenderIdentity !== talkieLockLastReleasedHolderRef.current ||
      releasedAt <= 0 ||
      now - releasedAt > TALKIE_LOCK_RELEASE_GRACE_MS ||
      talkieLockLastReleaseCaptionConsumedRef.current
    ) {
      if (releasedAt > 0 && now - releasedAt > TALKIE_LOCK_RELEASE_GRACE_MS) {
        clearRecentTalkieRelease();
      }
      return null;
    }

    talkieLockLastReleaseCaptionConsumedRef.current = true;
    return estimateTalkieUsageSeconds(
      talkieLockLastReleasedClaimStartedAtRef.current || releasedAt,
      releasedAt
    );
  }, [clearRecentTalkieRelease]);

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
    talkieLockClaimedAtRef.current = 0;
    talkieLockLastSettledAtRef.current = 0;
    talkieLockCaptionConsumedRef.current = false;
    talkieLockTimestampRef.current = 0;
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
    (payload: TalkieLockPayload, senderIdentity?: string | null) => {
      if (payload.roomId && payload.roomId !== session.roomId) return;
      const normalizedSenderIdentity = String(senderIdentity || "").trim();
      const nextTimestamp = normalizedSenderIdentity
        ? Date.now()
        : typeof payload.timestamp === "number"
          ? payload.timestamp
          : Date.now();
      if (nextTimestamp < talkieLockTimestampRef.current) return;

      const holder = (payload.holder || "").trim();
      const action = payload.action || "claim";
      if (normalizedSenderIdentity) {
        if (!isTrustedHumanParticipantIdentity(normalizedSenderIdentity)) return;
        if (!holder || holder !== normalizedSenderIdentity) return;
      }
      talkieLockTimestampRef.current = nextTimestamp;
      if (action === "release") {
        if (!holder || holder === talkieLockHolderRef.current) {
          if (talkieLockHolderRef.current) {
            talkieLockLastReleasedHolderRef.current = talkieLockHolderRef.current;
            talkieLockLastReleasedAtRef.current = nextTimestamp;
            talkieLockLastReleasedClaimStartedAtRef.current =
              talkieLockClaimedAtRef.current || nextTimestamp;
            talkieLockLastReleaseCaptionConsumedRef.current = false;
          } else {
            clearRecentTalkieRelease();
          }
          clearTalkieLock();
        }
        return;
      }
      if (!holder) return;
      clearRecentTalkieRelease();
      const expiresAt = normalizedSenderIdentity
        ? Date.now() + TALKIE_LOCK_TIMEOUT_MS
        : typeof payload.expiresAt === "number"
          ? payload.expiresAt
          : Date.now() + TALKIE_LOCK_TIMEOUT_MS;
      if (holder !== talkieLockHolderRef.current) {
        talkieLockClaimedAtRef.current = nextTimestamp;
        talkieLockLastSettledAtRef.current = nextTimestamp;
        talkieLockCaptionConsumedRef.current = false;
      } else if (!talkieLockClaimedAtRef.current) {
        talkieLockClaimedAtRef.current = nextTimestamp;
      }
      talkieLockHolderRef.current = holder;
      talkieLockExpiresAtRef.current = expiresAt;
      const holderParticipant = normalizedSenderIdentity
        ? getRemoteParticipantByIdentity(normalizedSenderIdentity)
        : null;
      setTalkieLockHolderIdentity(holder);
      setTalkieLockHolderName(
        (
          holderParticipant?.name ||
          holderParticipant?.identity ||
          payload.holderName ||
          holder
        ).trim()
      );
      setTalkieLockExpiresAt(expiresAt);
      armTalkieLockExpiry(expiresAt);
    },
    [
      armTalkieLockExpiry,
      clearRecentTalkieRelease,
      clearTalkieLock,
      getRemoteParticipantByIdentity,
      isTrustedHumanParticipantIdentity,
      session.roomId,
    ]
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
      if (!canPublishRoomData()) return;
      try {
        await localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          reliable: true,
          topic: TALKIE_LOCK_TOPIC,
        });
      } catch {}
    },
    [
      applyTalkieLockPayload,
      connected,
      localParticipant,
      room,
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
    if (manualDraftVisible || manualDraftSending) return;
    if (talkieUiState === "idle") return;
    setTalkieUiState("idle");
  }, [manualDraftSending, manualDraftVisible, recordingActive, talkieUiState, translationBusy]);
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
    if (isAudioOnlyCall) return;
    setTranslationPanelOpen(true);
  }, [isAudioOnlyCall]);

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

  const applyIosAudioOutputPreference = useCallback(async (forceSpeaker = false) => {
    if (Platform.OS !== "ios") return;
    const shouldUseSpeaker = forceSpeaker || preferSpeakerForCall;
    try {
      await AudioSession.setAppleAudioConfiguration(
        getDefaultAppleAudioConfigurationForMode("localAndRemote", shouldUseSpeaker)
      );
    } catch {}
    try {
      await AudioSession.startAudioSession();
    } catch {}
    await setIosRemoteAudioTrackVolume(IOS_REMOTE_AUDIO_VOLUME_NORMAL);
    try {
      await AudioSession.selectAudioOutput(shouldUseSpeaker ? "force_speaker" : "default");
    } catch {}
  }, [preferSpeakerForCall, setIosRemoteAudioTrackVolume]);

  const runSerializedAudioTransition = useCallback(
    async (
      task: () => Promise<void>,
      nextMode?: "idle" | "playback" | "recording",
      force = false
    ) => {
      if (Platform.OS === "ios") {
        await runSharedCallAudioTransition(async () => {
          if (!roomAudioInstanceActiveRef.current) {
            return;
          }
          if (
            sharedActiveCallAudioOwnerKey &&
            sharedActiveCallAudioOwnerKey !== callAudioOwnerKey
          ) {
            return;
          }
          if (nextMode && !force && sharedExpoAudioMode === nextMode) {
            expoAudioModeRef.current = nextMode;
            return;
          }
          await task();
          if (!roomAudioInstanceActiveRef.current) {
            return;
          }
          if (nextMode) {
            sharedExpoAudioMode = nextMode;
            expoAudioModeRef.current = nextMode;
          }
        });
        return;
      }
      const previous = audioTransitionChainRef.current.catch(() => {});
      let resolveNext!: () => void;
      audioTransitionChainRef.current = new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      try {
        await previous;
        if (nextMode && !force && expoAudioModeRef.current === nextMode) {
          return;
        }
        await task();
        if (nextMode) {
          expoAudioModeRef.current = nextMode;
        }
      } finally {
        resolveNext();
      }
    },
    [callAudioOwnerKey]
  );

  const setPlaybackAudioMode = useCallback(async () => {
    if (Platform.OS === "ios") {
      await runSerializedAudioTransition(
        async () => {
          await setIsAudioActiveAsync(true).catch(() => {});
          await applyIosAudioOutputPreference(false);
          await wait(80);
        },
        "playback"
      );
      return;
    }
    await runSerializedAudioTransition(
      async () => {
        await setAudioModeAsync({
          // Playback/TTS must not request a recording category on iOS.
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: Platform.OS === "ios" ? "doNotMix" : "duckOthers",
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        });
        if (Platform.OS === "ios") {
          await applyIosAudioOutputPreference(false);
          await wait(80);
        }
      },
      "playback"
    );
  }, [applyIosAudioOutputPreference, runSerializedAudioTransition]);

  const setRecordingAudioMode = useCallback(async () => {
    if (Platform.OS === "ios") {
      await runSerializedAudioTransition(
        async () => {
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
            interruptionMode: "doNotMix",
            shouldPlayInBackground: false,
            shouldRouteThroughEarpiece: false,
          });
          await setIsAudioActiveAsync(true).catch(() => {});
          await wait(120);
        },
        "recording"
      );
      return;
    }
    await runSerializedAudioTransition(
      async () => {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: Platform.OS === "ios" ? "doNotMix" : "duckOthers",
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        });
        if (Platform.OS === "ios") {
          // Keep Expo in charge during recorder startup; reapplying the LiveKit
          // room audio config here can trigger invalid iOS category transitions.
          await wait(120);
        }
      },
      "recording"
    );
  }, [runSerializedAudioTransition]);

  const resetIosAudioSession = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    await runSerializedAudioTransition(
      async () => {
        try {
          await AudioSession.stopAudioSession();
        } catch {}
        await wait(160);
        try {
          await AudioSession.startAudioSession();
        } catch {}
        await wait(220);
        await applyIosAudioOutputPreference(false);
      },
      undefined,
      true
    );
  }, [applyIosAudioOutputPreference, runSerializedAudioTransition]);

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
    void applyIosAudioOutputPreference(false);
  }, [applyIosAudioOutputPreference, connected, isMicrophoneEnabled, localParticipant]);

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

  const clearCaptionPhoneticQueueTimer = useCallback(() => {
    if (!captionPhoneticQueueTimerRef.current) return;
    clearTimeout(captionPhoneticQueueTimerRef.current);
    captionPhoneticQueueTimerRef.current = null;
  }, []);

  const queueCaptionPhoneticFlush = useCallback(
    (delayMs: number) => {
      clearCaptionPhoneticQueueTimer();
      captionPhoneticQueueTimerRef.current = setTimeout(() => {
        captionPhoneticQueueTimerRef.current = null;
        setCaptionPhoneticTrigger((current) => current + 1);
      }, Math.max(0, delayMs));
    },
    [clearCaptionPhoneticQueueTimer]
  );

  const stopTtsPlayer = useCallback(
    (options?: { preserveDucking?: boolean; reason?: string; level?: "info" | "warn" }) => {
      clearTtsPlaybackWatchdog();
      clearTtsPlayerMonitor();
      const player = ttsPlayerRef.current;
      const meta = ttsPlaybackMetaRef.current;
      const currentTime = player?.currentTime ?? 0;
      const duration = player?.duration ?? 0;
      if (player || meta) {
        logTtsEvent(
          "stop",
          {
            sessionId: meta?.sessionId ?? ttsPlaybackSessionRef.current,
            trigger: meta?.trigger,
            source: meta?.source,
            format: meta?.format,
            reason: options?.reason || "unknown",
            currentTimeMs: Math.round(currentTime * 1000),
            durationMs: Math.round(duration * 1000),
            elapsedMs: meta?.playbackStartedAt ? Date.now() - meta.playbackStartedAt : undefined,
            requestAgeMs: meta?.requestStartedAt ? Date.now() - meta.requestStartedAt : undefined,
            fileBytes: meta?.fileBytes,
          },
          options?.level || "info"
        );
      }
      if (player) {
        try {
          player.pause();
        } catch {}
        try {
          player.remove();
        } catch {}
      }
      ttsPlayerRef.current = null;
      ttsPlaybackMetaRef.current = null;
      const tempUri = ttsTempFileRef.current;
      ttsTempFileRef.current = "";
      if (tempUri) {
        void FileSystemLegacy.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      }
      ttsLockRef.current = false;
      if (pendingCaptionPhoneticRef.current) {
        queueCaptionPhoneticFlush(120);
      }
      if (!options?.preserveDucking) {
        void restoreRemoteAudioAfterTts();
        void releaseExpoAudioActivity();
      }
    },
    [
      clearTtsPlaybackWatchdog,
      clearTtsPlayerMonitor,
      queueCaptionPhoneticFlush,
      releaseExpoAudioActivity,
      restoreRemoteAudioAfterTts,
    ]
  );

  const prepareTtsPlayback = useCallback(async () => {
    await setPlaybackAudioMode();
    if (Platform.OS !== "ios") {
      await setIsAudioActiveAsync(true).catch(() => {});
    } else {
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
    (uri: string, meta: TtsPlaybackMeta) => {
      stopTtsPlayer({ preserveDucking: true, reason: "prepare_new_player" });
      const player = createAudioPlayer(
        { uri },
        {
          keepAudioSessionActive: true,
          updateInterval: 120,
        }
      );
      ttsPlayerRef.current = player;
      ttsPlaybackMetaRef.current = meta;
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
          stopTtsPlayer({ reason: "monitor_ended" });
        }
      }, 220);
    },
    [clearTtsPlayerMonitor, stopTtsPlayer]
  );

  const waitForTtsPlaybackStart = useCallback(async (sessionId: number, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (sessionId !== ttsPlaybackSessionRef.current) return false;
      const player = ttsPlayerRef.current;
      if (
        player &&
        (player.playing || player.currentTime > 0.02 || player.duration > 0.1)
      ) {
        return true;
      }
      await wait(80);
    }
    const player = ttsPlayerRef.current;
    return Boolean(player && (player.playing || player.currentTime > 0.02 || player.duration > 0.1));
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      void setPlaybackAudioMode().catch(() => {});
    }
    return () => {
      manualStartRequestIdRef.current += 1;
      if (manualStartAnimationFrameRef.current !== null) {
        cancelAnimationFrame(manualStartAnimationFrameRef.current);
        manualStartAnimationFrameRef.current = null;
      }
      manualStopRequestIdRef.current += 1;
      realtimeSessionIdRef.current += 1;
      abortActiveTranscription();
      void publishTalkieLock("release");
      void recorder.stop().catch(() => {});
      void restoreRoomMicAfterRecorder();
      void Speech.stop();
      stopTtsPlayer({ reason: "component_unmount" });
      clearCaptionPhoneticQueueTimer();
      if (replayButtonTimerRef.current) {
        clearTimeout(replayButtonTimerRef.current);
        replayButtonTimerRef.current = null;
      }
      if (retranslateButtonTimerRef.current) {
        clearTimeout(retranslateButtonTimerRef.current);
        retranslateButtonTimerRef.current = null;
      }
      void configureNativeVirtualBackground({ enabled: false, imageUrl: "" }).catch(() => {});
      if (talkieLockExpiryTimerRef.current) {
        clearTimeout(talkieLockExpiryTimerRef.current);
        talkieLockExpiryTimerRef.current = null;
      }
    };
  }, [
    abortActiveTranscription,
    clearCaptionPhoneticQueueTimer,
    publishTalkieLock,
    recorder,
    restoreRoomMicAfterRecorder,
    setPlaybackAudioMode,
    stopTtsPlayer,
  ]);

  useEffect(() => {
    void syncCallKeepAwake(appStateRef.current);
    return () => {
      if (!keepAwakeActiveRef.current) return;
      void deactivateKeepAwake(CALL_KEEP_AWAKE_TAG).catch(() => {});
      keepAwakeActiveRef.current = false;
    };
  }, [syncCallKeepAwake]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasActive = appWasActiveRef.current;
      const isActive = nextState === "active";
      appStateRef.current = nextState;
      appWasActiveRef.current = isActive;
      setRoomLifecycleTick((current) => current + 1);
      void syncCallKeepAwake(nextState);
      if (!wasActive && isActive) {
        void refreshTranslationEntitlement();
        void recoverCameraAfterForeground();
        return;
      }
      if (!wasActive || isActive) return;

      // iOS can terminate the app for sustained background CPU usage.
      manualStartRequestIdRef.current += 1;
      if (manualStartAnimationFrameRef.current !== null) {
        cancelAnimationFrame(manualStartAnimationFrameRef.current);
        manualStartAnimationFrameRef.current = null;
      }
      manualPushToTalkPressedRef.current = false;
      manualStartInFlightRef.current = false;
      manualStopRequestIdRef.current += 1;
      pendingStopAfterStartRef.current = false;
      realtimeSessionIdRef.current += 1;
      abortActiveTranscription();
      manualRecordingStartedAtRef.current = 0;
      setTalkieUiState("idle");
      void publishTalkieLock("release");
      if (realtimeEnabled) {
        setRealtimeEnabled(false);
      }
      void Speech.stop();
      stopTtsPlayer({ reason: "app_background" });
      void recorder.stop().catch(() => {});
      void releaseExpoAudioActivity().catch(() => {});
      void restoreRoomMicAfterRecorder();
    });

    return () => {
      subscription.remove();
    };
  }, [
    abortActiveTranscription,
    publishTalkieLock,
    realtimeEnabled,
    realtimeSessionIdRef,
    refreshTranslationEntitlement,
    recoverCameraAfterForeground,
    releaseExpoAudioActivity,
    manualStopRequestIdRef,
    recorder,
    restoreRoomMicAfterRecorder,
    setRoomLifecycleTick,
    syncCallKeepAwake,
    stopTtsPlayer,
  ]);

  const startRecorderSafely = useCallback(async () => {
    let lastError: unknown;
    const maxAttempts = Platform.OS === "ios" ? IOS_RECORDER_START_RETRY_DELAYS_MS.length : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (appStateRef.current !== "active") {
        throw new Error(language === "fr" ? "Enregistrement annule." : "Recording cancelled.");
      }
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
        if (appStateRef.current !== "active") {
          throw new Error(language === "fr" ? "Enregistrement annule." : "Recording cancelled.");
        }
        await recorder.record();
        return;
      } catch (err) {
        if (Platform.OS === "ios") {
          mediaRecoveryCooldownUntilRef.current = Date.now() + MEDIA_ERROR_AUTO_LEAVE_GRACE_MS;
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
    let copiedToCache = false;
    if (cacheDir) {
      const ext = buildSegmentExtension(rawUri);
      const nextUri =
        `${cacheDir}rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "m4a"}`;
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
  const preferredTargetVoiceId = useMemo(
    () => selectPreferredEnhancedDeviceVoiceId(availableVoices, targetLanguage, targetSpeechLocale),
    [availableVoices, targetLanguage, targetSpeechLocale]
  );
  const targetVoiceLikelyUnavailable =
    ttsEnabled &&
    shouldWarnAboutMissingNativeTtsVoice(targetLanguage) &&
    !preferredTargetVoiceId;

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
        const storedSubtitleDisplayMode = parsed.subtitleDisplayMode;
        const storedLocalPreviewCorner = parsed.localPreviewCorner;

        if (storedSourceLanguage && isLanguageCode(storedSourceLanguage)) {
          setSourceLanguage(storedSourceLanguage);
        }
        if (storedTargetLanguage && isLanguageCode(storedTargetLanguage)) {
          setTargetLanguage(storedTargetLanguage);
        }
        if (
          typeof storedSubtitleDisplayMode === "string" &&
          isSubtitleDisplayMode(storedSubtitleDisplayMode)
        ) {
          setSubtitleDisplayMode(storedSubtitleDisplayMode);
        }
        if (
          typeof storedLocalPreviewCorner === "string" &&
          isPreviewCorner(storedLocalPreviewCorner)
        ) {
          setLocalPreviewCorner(storedLocalPreviewCorner);
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
      subtitleDisplayMode,
      localPreviewCorner,
      captionsEnabled: CAPTIONS_ALWAYS_ON ? true : captionsEnabled,
      ttsEnabled: VOICE_TRANSLATION_ENABLED ? ttsEnabled : false,
      realtimeEnabled: REALTIME_TRANSLATION_ENABLED ? realtimeEnabled : false,
    };
    void AsyncStorage.setItem(callPrefsStorageKey, JSON.stringify(payload)).catch(() => {});
  }, [
    callPrefsStorageKey,
    captionsEnabled,
    localPreviewCorner,
    realtimeEnabled,
    sourceLanguage,
    subtitleDisplayMode,
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

  const localCameraPublication = useMemo(() => {
    if (!localParticipant) return null;
    return localParticipant.getTrackPublication(Track.Source.Camera) || null;
  }, [connected, isCameraEnabled, localParticipant, roomLifecycleTick]);

  const hasUsableLocalCameraTrack = useMemo(
    () => isUsableVideoPublication(localCameraPublication),
    [localCameraPublication]
  );

  const localCameraTrack = useMemo<TrackReference | null>(() => {
    const publication = localCameraPublication;
    if (!localParticipant || !publication?.videoTrack) return null;
    return {
      participant: localParticipant,
      publication,
      source: publication.source,
    };
  }, [localCameraPublication, localParticipant]);

  const fallbackRemoteVideoTracks = useMemo<TrackReference[]>(() => {
    if (!room) return [];
    const tracks: TrackReference[] = [];
    room.remoteParticipants.forEach((participant) => {
      const publications = Array.from(participant.trackPublications.values());
      const videoPublications = publications.filter((publication) =>
        isUsableVideoPublication(publication)
      );
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
  }, [remoteParticipantCount, room, roomLifecycleTick]);

  const renderableCameraTracks = useMemo(
    () => cameraTracks.filter((track) => isRenderableTrackReference(track)),
    [cameraTracks, roomLifecycleTick]
  );

  const renderedTracks = useMemo(() => {
    const merged = [...renderableCameraTracks];
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
  }, [fallbackRemoteVideoTracks, localCameraTrack, renderableCameraTracks]);

  const trackKey = useCallback((track: TrackReference) => {
    const source = String(track.source ?? "camera");
    const sid = track.publication.trackSid || "nosid";
    return `${track.participant.identity}-${source}-${sid}`;
  }, []);

  const localTrack = useMemo(
    () => renderedTracks.find((track) => track.participant.isLocal) || null,
    [renderedTracks]
  );
  const allowMovablePreview = Platform.OS === "ios" && !Boolean(Platform.isPad);
  const previewCardSize = useMemo(
    () => ({
      width: isTabletLayout
        ? IOS_PREVIEW_CARD_WIDTH_TABLET
        : isVeryCompactPhone
          ? IOS_PREVIEW_CARD_WIDTH_COMPACT
          : IOS_PREVIEW_CARD_WIDTH,
      height: isTabletLayout
        ? IOS_PREVIEW_CARD_HEIGHT_TABLET
        : isVeryCompactPhone
          ? IOS_PREVIEW_CARD_HEIGHT_COMPACT
          : IOS_PREVIEW_CARD_HEIGHT,
    }),
    [isTabletLayout, isVeryCompactPhone]
  );
  const tabletPanelWidth = viewportWidth >= 1180 ? 360 : 332;
  const useTabletSplitLayout = isTabletLayout && !immersiveMode;
  const [focusedVideoLayout, setFocusedVideoLayout] = useState({ width: 0, height: 0 });
  const previewPositionReady = focusedVideoLayout.width > 0 && focusedVideoLayout.height > 0;
  const previewPosition = useRef(new Animated.ValueXY({ x: IOS_PREVIEW_CARD_MARGIN, y: IOS_PREVIEW_CARD_MARGIN }))
    .current;
  const previewPositionRef = useRef({ x: IOS_PREVIEW_CARD_MARGIN, y: IOS_PREVIEW_CARD_MARGIN });
  const previewDragOriginRef = useRef({ x: IOS_PREVIEW_CARD_MARGIN, y: IOS_PREVIEW_CARD_MARGIN });
  const previewTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewPositionInitializedRef = useRef(false);

  const clearPendingPreviewTap = useCallback(() => {
    if (!previewTapTimeoutRef.current) return;
    clearTimeout(previewTapTimeoutRef.current);
    previewTapTimeoutRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearPendingPreviewTap();
    },
    [clearPendingPreviewTap]
  );

  const previewBounds = useMemo(() => {
    const maxX = Math.max(
      IOS_PREVIEW_CARD_MARGIN,
      focusedVideoLayout.width - previewCardSize.width - IOS_PREVIEW_CARD_MARGIN
    );
    const maxY = Math.max(
      IOS_PREVIEW_CARD_MARGIN,
      focusedVideoLayout.height - previewCardSize.height - IOS_PREVIEW_CARD_MARGIN
    );
    return {
      minX: IOS_PREVIEW_CARD_MARGIN,
      minY: IOS_PREVIEW_CARD_MARGIN,
      maxX,
      maxY,
    };
  }, [focusedVideoLayout.height, focusedVideoLayout.width, previewCardSize.height, previewCardSize.width]);

  const clampPreviewPosition = useCallback(
    (candidate: { x: number; y: number }) => {
      return {
        x: Math.min(previewBounds.maxX, Math.max(previewBounds.minX, candidate.x)),
        y: Math.min(previewBounds.maxY, Math.max(previewBounds.minY, candidate.y)),
      };
    },
    [previewBounds.maxX, previewBounds.maxY, previewBounds.minX, previewBounds.minY]
  );

  const getPreviewCornerPosition = useCallback(
    (corner: PreviewCorner) => {
      switch (corner) {
        case "topLeft":
          return { x: previewBounds.minX, y: previewBounds.minY };
        case "bottomLeft":
          return { x: previewBounds.minX, y: previewBounds.maxY };
        case "bottomRight":
          return { x: previewBounds.maxX, y: previewBounds.maxY };
        case "topRight":
        default:
          return { x: previewBounds.maxX, y: previewBounds.minY };
      }
    },
    [previewBounds.maxX, previewBounds.maxY, previewBounds.minX, previewBounds.minY]
  );

  const movePreviewToCorner = useCallback(
    (corner: PreviewCorner, animated = true) => {
      const nextPosition = getPreviewCornerPosition(corner);
      previewPositionRef.current = nextPosition;
      previewPositionInitializedRef.current = true;
      setLocalPreviewCorner((current) => (current === corner ? current : corner));
      if (animated) {
        Animated.spring(previewPosition, {
          toValue: nextPosition,
          useNativeDriver: false,
          bounciness: 0,
          speed: 20,
        }).start();
        return;
      }
      previewPosition.setValue(nextPosition);
    },
    [getPreviewCornerPosition, previewPosition]
  );

  const resolveNearestPreviewCorner = useCallback(
    (candidate: { x: number; y: number }): PreviewCorner => {
      const corners: PreviewCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
      let bestCorner: PreviewCorner = IOS_PREVIEW_DEFAULT_CORNER;
      let bestDistance = Number.POSITIVE_INFINITY;
      corners.forEach((corner) => {
        const position = getPreviewCornerPosition(corner);
        const distance = Math.hypot(position.x - candidate.x, position.y - candidate.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCorner = corner;
        }
      });
      return bestCorner;
    },
    [getPreviewCornerPosition]
  );

  const snapPreviewToNearestCorner = useCallback(
    (animated = true) => {
      movePreviewToCorner(resolveNearestPreviewCorner(previewPositionRef.current), animated);
    },
    [movePreviewToCorner, resolveNearestPreviewCorner]
  );

  const resetPreviewPosition = useCallback(() => {
    clearPendingPreviewTap();
    movePreviewToCorner(IOS_PREVIEW_DEFAULT_CORNER);
  }, [clearPendingPreviewTap, movePreviewToCorner]);

  useEffect(() => {
    if (!focusedVideoLayout.width || !focusedVideoLayout.height) {
      previewPositionInitializedRef.current = false;
      return;
    }
    movePreviewToCorner(localPreviewCorner, false);
  }, [
    focusedVideoLayout.height,
    focusedVideoLayout.width,
    localPreviewCorner,
    movePreviewToCorner,
    previewCardSize.height,
    previewCardSize.width,
  ]);

  const previewPanResponder = useMemo(() => {
    if (!allowMovablePreview) return null;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
        Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        clearPendingPreviewTap();
        previewDragOriginRef.current = previewPositionRef.current;
      },
      onPanResponderMove: (_evt, gestureState) => {
        const nextPosition = clampPreviewPosition({
          x: previewDragOriginRef.current.x + gestureState.dx,
          y: previewDragOriginRef.current.y + gestureState.dy,
        });
        previewPositionRef.current = nextPosition;
        previewPosition.setValue(nextPosition);
      },
      onPanResponderRelease: () => {
        snapPreviewToNearestCorner();
      },
      onPanResponderTerminate: () => {
        snapPreviewToNearestCorner();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [
    allowMovablePreview,
    clampPreviewPosition,
    clearPendingPreviewTap,
    previewPosition,
    snapPreviewToNearestCorner,
  ]);

  const handleFocusedVideoLayout = useCallback((width: number, height: number) => {
    setFocusedVideoLayout((current) =>
      current.width === width && current.height === height ? current : { width, height }
    );
  }, []);

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

  const focusTrackManually = useCallback(
    (track: TrackReference) => {
      const nextKey = trackKey(track);
      setFollowActiveSpeaker(false);
      setFocusedTrackKey(nextKey);
      setPinnedTrackKey((current) => (current === nextKey ? current : null));
    },
    [trackKey]
  );

  const handlePreviewTap = useCallback(
    (track: TrackReference) => {
      if (
        !allowMovablePreview ||
        !previewPositionReady ||
        localPreviewCorner === IOS_PREVIEW_DEFAULT_CORNER
      ) {
        focusTrackManually(track);
        return;
      }
      if (previewTapTimeoutRef.current) {
        resetPreviewPosition();
        return;
      }
      previewTapTimeoutRef.current = setTimeout(() => {
        previewTapTimeoutRef.current = null;
        focusTrackManually(track);
      }, IOS_PREVIEW_DOUBLE_TAP_DELAY_MS);
    },
    [
      allowMovablePreview,
      focusTrackManually,
      localPreviewCorner,
      previewPositionReady,
      resetPreviewPosition,
    ]
  );

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
  const totalParticipantCount = remoteParticipantCount + 1;
  const groupVoicePlaybackLimited = totalParticipantCount > 2;
  const exceedsRecommendedParticipantCount = totalParticipantCount > 4;
  const hadRemoteParticipantRef = useRef(false);
  useEffect(() => {
    if (!room) return;
    const syncRoomLifecycle = () => {
      setRoomLifecycleTick((current) => current + 1);
    };
    room.on(RoomEvent.LocalTrackPublished, syncRoomLifecycle);
    room.on(RoomEvent.LocalTrackUnpublished, syncRoomLifecycle);
    room.on(RoomEvent.TrackSubscribed, syncRoomLifecycle);
    room.on(RoomEvent.TrackUnsubscribed, syncRoomLifecycle);
    room.on(RoomEvent.TrackMuted, syncRoomLifecycle);
    room.on(RoomEvent.TrackUnmuted, syncRoomLifecycle);
    room.on(RoomEvent.Reconnected, syncRoomLifecycle);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, syncRoomLifecycle);
      room.off(RoomEvent.LocalTrackUnpublished, syncRoomLifecycle);
      room.off(RoomEvent.TrackSubscribed, syncRoomLifecycle);
      room.off(RoomEvent.TrackUnsubscribed, syncRoomLifecycle);
      room.off(RoomEvent.TrackMuted, syncRoomLifecycle);
      room.off(RoomEvent.TrackUnmuted, syncRoomLifecycle);
      room.off(RoomEvent.Reconnected, syncRoomLifecycle);
    };
  }, [room]);
  useEffect(() => {
    if (!room) {
      setRemoteParticipantCount(0);
      return;
    }
    const sync = () => {
      setRemoteParticipantCount(countHumanRemoteParticipants());
    };
    sync();
    room.on(RoomEvent.ParticipantConnected, sync);
    room.on(RoomEvent.ParticipantDisconnected, sync);
    room.on(RoomEvent.ParticipantMetadataChanged, sync);
    room.on(RoomEvent.TrackPublished, sync);
    room.on(RoomEvent.TrackUnpublished, sync);
    return () => {
      room.off(RoomEvent.ParticipantConnected, sync);
      room.off(RoomEvent.ParticipantDisconnected, sync);
      room.off(RoomEvent.ParticipantMetadataChanged, sync);
      room.off(RoomEvent.TrackPublished, sync);
      room.off(RoomEvent.TrackUnpublished, sync);
    };
  }, [countHumanRemoteParticipants, room]);

  useEffect(() => {
    if (remoteParticipantCount > 0) return;
    setActiveSpeakerIdentity("");
  }, [remoteParticipantCount]);

  useEffect(() => {
    hadRemoteParticipantRef.current = false;
    setParticipantReconnectPending(false);
    setWaitingForParticipant(false);
  }, [session.roomId]);

  useEffect(() => {
    if (
      appStateRef.current !== "active" ||
      !connected ||
      connectionPhase !== "connected" ||
      Date.now() < mediaRecoveryCooldownUntilRef.current
    ) {
      setWaitingForParticipant(false);
      return;
    }
    if (remoteParticipantCount > 0) {
      hadRemoteParticipantRef.current = true;
      setWaitingForParticipant(false);
      return;
    }
    if (hadRemoteParticipantRef.current) {
      setWaitingForParticipant(false);
      return;
    }
    setWaitingForParticipant(true);
  }, [
    connected,
    connectionPhase,
    remoteParticipantCount,
    roomLifecycleTick,
  ]);

  useEffect(() => {
    if (
      appStateRef.current !== "active" ||
      !connected ||
      connectionPhase !== "connected" ||
      Date.now() < mediaRecoveryCooldownUntilRef.current
    ) {
      setParticipantReconnectPending(false);
      return;
    }
    if (remoteParticipantCount > 0) {
      hadRemoteParticipantRef.current = true;
      setParticipantReconnectPending(false);
      return;
    }
    if (!hadRemoteParticipantRef.current) {
      setParticipantReconnectPending(false);
      return;
    }
    setParticipantReconnectPending(true);
  }, [
    connected,
    connectionPhase,
    remoteParticipantCount,
    roomLifecycleTick,
  ]);

  useEffect(() => {
    if (participantReconnectPending) {
      setTranslationError(ui.participantLeftWaiting);
      return;
    }
    if (waitingForParticipant) {
      setTranslationError(ui.waitingParticipant);
      return;
    }
    setTranslationError((current) =>
      current === ui.participantLeftWaiting || current === ui.waitingParticipant ? "" : current
    );
  }, [participantReconnectPending, ui.participantLeftWaiting, ui.waitingParticipant, waitingForParticipant]);

  useEffect(() => {
    if (!room) return;

    const applyTalkieRemoteAudioSuppression = () => {
      room.remoteParticipants.forEach((participant) => {
        const shouldSuppress =
          Boolean(talkieLockHolderIdentity) && participant.identity === talkieLockHolderIdentity;
        participant.setVolume(
          shouldSuppress ? TALKIE_REMOTE_AUDIO_MUTED_VOLUME : IOS_REMOTE_AUDIO_VOLUME_NORMAL,
          Track.Source.Microphone
        );
      });
    };

    applyTalkieRemoteAudioSuppression();
    room.on(RoomEvent.ParticipantConnected, applyTalkieRemoteAudioSuppression);
    room.on(RoomEvent.ParticipantDisconnected, applyTalkieRemoteAudioSuppression);
    room.on(RoomEvent.TrackSubscribed, applyTalkieRemoteAudioSuppression);

    return () => {
      room.off(RoomEvent.ParticipantConnected, applyTalkieRemoteAudioSuppression);
      room.off(RoomEvent.ParticipantDisconnected, applyTalkieRemoteAudioSuppression);
      room.off(RoomEvent.TrackSubscribed, applyTalkieRemoteAudioSuppression);
      room.remoteParticipants.forEach((participant) => {
        participant.setVolume(IOS_REMOTE_AUDIO_VOLUME_NORMAL, Track.Source.Microphone);
      });
    };
  }, [room, talkieLockHolderIdentity]);

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
      mediaRecoveryCooldownUntilRef.current = Date.now() + MEDIA_ERROR_AUTO_LEAVE_GRACE_MS;
      setParticipantReconnectPending(false);
      setWaitingForParticipant(false);
      setTranslationError(
        error?.message ||
          (language === "fr" ? "Erreur peripherique media LiveKit." : "LiveKit media device error.")
      );
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
  }, [language, room]);

  useEffect(() => {
    if (isAudioOnlyCall || !startWithCamera) {
      setVideoCaptureProfile("balanced");
      return;
    }
    if (Platform.OS === "ios") {
      setVideoCaptureProfile("balanced");
      return;
    }
    const shouldUseLowProfile =
      localConnectionQuality === ConnectionQuality.Poor ||
      localConnectionQuality === ConnectionQuality.Lost;
    setVideoCaptureProfile((current) =>
      current === (shouldUseLowProfile ? "low" : "balanced")
        ? current
        : shouldUseLowProfile
          ? "low"
          : "balanced"
    );
  }, [isAudioOnlyCall, localConnectionQuality, startWithCamera]);

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
    return `${track.participant.identity}${track.participant.isLocal ? ui.meSuffix : ""}`;
  }, [ui.meSuffix]);

  const getParticipantLabelByIdentity = useCallback(
    (identity?: string) => {
      const normalizedIdentity = (identity || "").trim();
      if (!normalizedIdentity) return "BFZoom";
      if (normalizedIdentity === session.identity) {
        return `${session.displayName || session.identity || "BFZoom"}${ui.meSuffix}`;
      }

      const remoteParticipant = room?.remoteParticipants.get(normalizedIdentity);
      if (remoteParticipant) {
        return (remoteParticipant.name || remoteParticipant.identity || normalizedIdentity).trim();
      }

      return normalizedIdentity;
    },
    [room, session.displayName, session.identity, ui.meSuffix]
  );

  const getLanguageLabel = useCallback(
    (code: LanguageCode) =>
      LANGUAGE_OPTIONS.find((option) => option.code === code)?.label ||
      LANGUAGE_PROMPT_NAMES[code] ||
      "English",
    []
  );
  const getLanguageChipLabel = useCallback(
    (lang: (typeof LANGUAGE_OPTIONS)[number]) => `${getLanguageLabel(lang.code)} (${lang.code})`,
    [getLanguageLabel]
  );
  const showLanguageInfo = useCallback(
    (lang: (typeof LANGUAGE_OPTIONS)[number]) => {
      Alert.alert(ui.languageAlertTitle, `${getLanguageLabel(lang.code)} (${lang.code})`);
    },
    [getLanguageLabel, ui.languageAlertTitle]
  );
  const sourceLanguageLabel = getLanguageLabel(sourceLanguage);
  const targetLanguageLabel = getLanguageLabel(targetLanguage);
  const sourceLanguageIsRtl = isRtlLanguageCode(sourceLanguage);
  const targetLanguageIsRtl = isRtlLanguageCode(targetLanguage);
  const hasPreferredTranslatorAudioTrack = useMemo(
    () =>
      remoteAudioTracks.some((track) => {
        const identity = track.participant.identity || "";
        if (!isTranslatorIdentity(identity)) return false;
        const translatorTargetLanguage = getTranslatorTargetLanguageFromIdentity(identity);
        return !translatorTargetLanguage || translatorTargetLanguage === targetLanguage;
      }),
    [remoteAudioTracks, targetLanguage]
  );

  const getPromptLanguageName = useCallback(
    (code: LanguageCode) => LANGUAGE_PROMPT_NAMES[code] || "English",
    []
  );

  useEffect(() => {
    const input = captionText.trim();
    clearCaptionPhoneticQueueTimer();
    pendingCaptionPhoneticRef.current = null;
    captionPhoneticSeqRef.current += 1;
    if (!input) {
      setCaptionPhoneticBusy(false);
      setCaptionPhoneticText("");
      return;
    }
    pendingCaptionPhoneticRef.current = {
      text: input,
      targetLanguage,
    };
    setCaptionPhoneticBusy(false);
    setCaptionPhoneticText("");
    if (!ttsEnabled || !ttsLockRef.current) {
      queueCaptionPhoneticFlush(CAPTION_PHONETIC_IDLE_DELAY_MS);
    }
  }, [captionText, clearCaptionPhoneticQueueTimer, queueCaptionPhoneticFlush, targetLanguage, ttsEnabled]);

  useEffect(() => {
    const pendingJob = pendingCaptionPhoneticRef.current;
    if (!pendingJob) return;
    if (ttsLockRef.current) return;
    pendingCaptionPhoneticRef.current = null;
    const requestId = ++captionPhoneticSeqRef.current;
    setCaptionPhoneticBusy(true);
    void (async () => {
      try {
        const generated = await withFreshBearerToken((activeBearerToken) =>
          phoneticText({
            apiBaseUrl: publicApiBase,
            bearerToken: activeBearerToken,
            guestTtsToken: session.guestTtsToken,
            text: pendingJob.text,
            languageName: getPromptLanguageName(pendingJob.targetLanguage),
          })
        );
        if (requestId !== captionPhoneticSeqRef.current) return;
        const cleaned = generated.trim();
        const sourceNormalized = pendingJob.text.replace(/\s+/g, " ").trim().toLowerCase();
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
    captionPhoneticTrigger,
    getPromptLanguageName,
    publicApiBase,
    session.guestTtsToken,
    withFreshBearerToken,
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
      cameraAutoStartInFlightRef.current = false;
      cameraHealthRecoveryInFlightRef.current = false;
      return;
    }
    if (!startWithCamera) return;
    if (!localParticipant || cameraAutoStartInFlightRef.current) return;
    if (hasUsableLocalCameraTrack) {
      cameraAutoStartedRef.current = true;
      return;
    }
    if (cameraAutoStartedRef.current && isCameraEnabled) return;
    cameraAutoStartInFlightRef.current = true;

    let cancelled = false;
    const startCamera = async () => {
      let lastError: unknown = null;
      for (const retryDelayMs of [0, 260, 620]) {
        if (cancelled) return;
        if (retryDelayMs > 0) {
          await wait(retryDelayMs);
          if (cancelled) return;
        }
        try {
          lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
          await localParticipant.setCameraEnabled(true, desiredCameraCaptureOptions);
          if (cancelled) return;
          cameraAutoStartedRef.current = true;
          setTranslationError((current) => (/camera/i.test(current) ? "" : current));
          return;
        } catch (err) {
          lastError = err;
          cameraAutoStartedRef.current = false;
        }
      }

      if (!cancelled) {
        setTranslationError(
          lastError instanceof Error
            ? lastError.message
            : language === "fr"
              ? "Echec demarrage camera."
              : "Camera startup failed."
        );
      }
    };

    void startCamera().finally(() => {
      if (!cancelled) {
        cameraAutoStartInFlightRef.current = false;
      }
    });

    return () => {
      cancelled = true;
      cameraAutoStartInFlightRef.current = false;
    };
  }, [
    connected,
    desiredCameraCaptureOptions,
    hasUsableLocalCameraTrack,
    isCameraEnabled,
    language,
    localParticipant,
    startWithCamera,
    videoCaptureProfile,
  ]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!connected || isAudioOnlyCall || !startWithCamera) return;
    if (!localParticipant || !isCameraEnabled || hasUsableLocalCameraTrack) return;
    if (cameraAutoStartInFlightRef.current || cameraForegroundRecoveryInFlightRef.current) return;

    const now = Date.now();
    if (
      cameraHealthRecoveryInFlightRef.current ||
      now - lastCameraHealthRecoveryAtRef.current < IOS_CAMERA_HEALTH_RECOVERY_COOLDOWN_MS
    ) {
      return;
    }

    cameraHealthRecoveryInFlightRef.current = true;
    let cancelled = false;

    const recoverMissingCameraTrack = async () => {
      try {
        await wait(IOS_CAMERA_HEALTH_RECOVERY_DELAY_MS);
        if (cancelled || appStateRef.current !== "active") return;

        const publication = localParticipant.getTrackPublication(Track.Source.Camera);
        const videoTrack = publication?.videoTrack;
        lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;

        if (videoTrack) {
          await videoTrack.restartTrack(desiredCameraCaptureOptions);
        } else {
          cameraAutoStartedRef.current = false;
          await localParticipant.setCameraEnabled(false).catch(() => {});
          await wait(120);
          await localParticipant.setCameraEnabled(true, desiredCameraCaptureOptions);
        }

        if (cancelled) return;
        cameraAutoStartedRef.current = true;
        lastCameraHealthRecoveryAtRef.current = Date.now();
        setTranslationError((current) => (/camera/i.test(current) ? "" : current));
        const reapplyVirtualBackground = applyVirtualBackgroundEffectRef.current;
        if (reapplyVirtualBackground) {
          await reapplyVirtualBackground().catch(() => false);
        }
      } catch (err) {
        if (cancelled) return;
        setTranslationError(
          err instanceof Error
            ? err.message
            : language === "fr"
              ? "Echec restauration camera iOS."
              : "iOS camera recovery failed."
        );
      } finally {
        cameraHealthRecoveryInFlightRef.current = false;
      }
    };

    void recoverMissingCameraTrack();
    return () => {
      cancelled = true;
      cameraHealthRecoveryInFlightRef.current = false;
    };
  }, [
    connected,
    desiredCameraCaptureOptions,
    hasUsableLocalCameraTrack,
    isAudioOnlyCall,
    isCameraEnabled,
    language,
    localParticipant,
    startWithCamera,
    videoCaptureProfile,
  ]);

  useEffect(() => {
    if (!connected || isAudioOnlyCall) return;
    if (Platform.OS === "ios") {
      lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
      return;
    }
    if (!localParticipant || !isCameraEnabled) return;
    if (lastAppliedVideoCaptureProfileRef.current === videoCaptureProfile) return;

    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    const videoTrack = publication?.videoTrack;
    if (!videoTrack) {
      lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
      return;
    }

    lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
    void videoTrack.restartTrack(desiredCameraCaptureOptions).catch((err) => {
      setTranslationError(
        err instanceof Error
          ? err.message
          : language === "fr"
            ? "Impossible d'ajuster la qualite video."
            : "Unable to adjust video quality."
      );
    });
  }, [
    connected,
    desiredCameraCaptureOptions,
    isAudioOnlyCall,
    isCameraEnabled,
    language,
    localParticipant,
    videoCaptureProfile,
  ]);

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
        throw new Error(language === "fr" ? "Autorisation micro refusee." : "Microphone permission denied.");
      }
      await setIsAudioActiveAsync(true).catch(() => {});
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
          if (appStateRef.current !== "active") {
            try {
              await recorder.stop();
            } catch {}
            manualRecordingStartedAtRef.current = 0;
            recordingStartUriRef.current = "";
            await restoreRoomMicAfterRecorder();
            await releaseExpoAudioActivity();
            return false;
          }
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
      setRecordingError(toFriendlyAudioError(err, language));
      manualRecordingStartedAtRef.current = 0;
      recordingStartUriRef.current = "";
      try {
        await setPlaybackAudioMode();
      } catch {}
      await restoreRoomMicAfterRecorder();
      await releaseExpoAudioActivity();
      return false;
    }
  }, [
    releaseExpoAudioActivity,
    appStateRef,
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
    async (text: string, languageOverride?: LanguageCode, trigger: TtsTrigger = "auto") => {
      if (!ttsEnabled || !text.trim()) return;
      if (realtimeEnabled) return;
      if (recordingActive && !realtimeEnabled) {
        setTranslationError(
          language === "fr"
            ? "Arrete l'enregistrement avant la lecture vocale."
            : "Stop recording before voice playback."
        );
        return;
      }

      const effectiveLanguage = languageOverride || targetLanguage;
      const effectiveLocale =
        LANGUAGE_OPTIONS.find((opt) => opt.code === effectiveLanguage)?.speechLocale ||
        targetSpeechLocale;
      const useSelectedVoice = !languageOverride || languageOverride === targetLanguage;
      const effectiveVoiceOptions = getVoicesForLanguage(
        availableVoices,
        effectiveLanguage,
        effectiveLocale
      );
      const preferredDeviceVoiceId = selectPreferredDeviceVoiceId(
        effectiveVoiceOptions,
        effectiveLanguage,
        effectiveLocale
      );
      const preferredNaturalDeviceVoiceId = selectPreferredEnhancedDeviceVoiceId(
        effectiveVoiceOptions,
        effectiveLanguage,
        effectiveLocale
      );
      const autoSelectedDeviceVoiceId =
        preferredNaturalDeviceVoiceId || preferredDeviceVoiceId;
      const preferDeviceVoice =
        shouldPreferNativeTtsLanguage(effectiveLanguage) && Boolean(preferredNaturalDeviceVoiceId);
      const aiTtsInstructions = buildAiTtsInstructions({
        languageCode: effectiveLanguage,
        languageLabel: getPromptLanguageName(effectiveLanguage),
      });

      const textToSpeak = text.trim().slice(0, AI_TTS_MAX_CHARS);
      const ttsSessionId = ++ttsPlaybackSessionRef.current;
      const finalizeTtsSession = (sessionId: number) => {
        if (sessionId !== ttsPlaybackSessionRef.current) return;
        clearTtsPlaybackWatchdog();
        ttsLockRef.current = false;
        if (pendingCaptionPhoneticRef.current) {
          queueCaptionPhoneticFlush(120);
        }
        void restoreRemoteAudioAfterTts(sessionId);
      };
      const speakWithDeviceVoice = (fallback: boolean) => {
        const locale = effectiveLocale;
        const selectedVoice = fallback
          ? undefined
          : !useSelectedVoice
            ? autoSelectedDeviceVoiceId
            : voiceId === AUTO_VOICE_ID
            ? autoSelectedDeviceVoiceId
            : voiceId;
        const startedAt = Date.now();
        logTtsEvent("device_start", {
          sessionId: ttsSessionId,
          trigger,
          locale,
          fallback,
          selectedVoice: selectedVoice || "auto",
          textChars: textToSpeak.length,
        });

        try {
          Speech.speak(textToSpeak, {
            language: locale,
            rate: 0.96,
            pitch: 1,
            voice: selectedVoice,
            useApplicationAudioSession: Platform.OS === "ios",
            onDone: () => {
              logTtsEvent("device_end", {
                sessionId: ttsSessionId,
                trigger,
                reason: "done",
                fallback,
                elapsedMs: Date.now() - startedAt,
                textChars: textToSpeak.length,
              });
              finalizeTtsSession(ttsSessionId);
            },
            onStopped: () => {
              logTtsEvent("device_end", {
                sessionId: ttsSessionId,
                trigger,
                reason: "stopped",
                fallback,
                elapsedMs: Date.now() - startedAt,
                textChars: textToSpeak.length,
              });
              finalizeTtsSession(ttsSessionId);
            },
            onError: (error) => {
              logTtsEvent(
                "device_error",
                {
                  sessionId: ttsSessionId,
                  trigger,
                  fallback,
                  elapsedMs: Date.now() - startedAt,
                  message: error?.message || "voice playback failed",
                },
                "warn"
              );
              if (!fallback) {
                speakWithDeviceVoice(true);
                return;
              }
              finalizeTtsSession(ttsSessionId);
              if (!realtimeEnabled) {
                setTranslationError(
                  toFriendlyAudioError(error?.message || "Voice playback failed.", language)
                );
              }
            },
          });
        } catch (error) {
          logTtsEvent(
            "device_exception",
            {
              sessionId: ttsSessionId,
              trigger,
              fallback,
              elapsedMs: Date.now() - startedAt,
              message: error instanceof Error ? error.message : String(error),
            },
            "warn"
          );
          if (!fallback) {
            speakWithDeviceVoice(true);
            return;
          }
          finalizeTtsSession(ttsSessionId);
          if (!realtimeEnabled) {
            setTranslationError(toFriendlyAudioError(error, language));
          }
        }
      };

      try {
        const playbackSessionPrepStartedAt = Date.now();
        await prepareTtsPlayback();
        await duckRemoteAudioForTts(ttsSessionId);
        const playbackSessionPrepMs = Date.now() - playbackSessionPrepStartedAt;
        logTtsEvent("playback_session_ready", {
          sessionId: ttsSessionId,
          trigger,
          prepMs: playbackSessionPrepMs,
          textChars: textToSpeak.length,
        });
        if (ttsLockRef.current) {
          await Speech.stop();
          stopTtsPlayer({ preserveDucking: true, reason: "session_replaced" });
        }
        ttsLockRef.current = true;
        setTranslationError("");
        if (preferDeviceVoice) {
          logTtsEvent("device_preferred", {
            sessionId: ttsSessionId,
            trigger,
            language: effectiveLanguage,
            locale: effectiveLocale,
            selectedVoice: preferredNaturalDeviceVoiceId || "auto",
            textChars: textToSpeak.length,
          });
          speakWithDeviceVoice(false);
          return;
        }
        if (AI_TTS_ENABLED && publicApiBase) {
          const requestSeq = ++ttsRequestSeqRef.current;
          try {
            const cacheBase = FileSystemLegacy.cacheDirectory || FileSystemLegacy.documentDirectory;
            if (!cacheBase) {
              throw new Error("Audio cache unavailable on this device.");
            }
            const activeBearerToken = await refreshBearerToken();
            const preferredFormats =
              Platform.OS === "ios" ? IOS_AI_TTS_FORMAT_PREFERENCE : [DEFAULT_AI_TTS_FORMAT];
            let lastTtsError = "";

            for (const format of preferredFormats) {
              const requestStartedAt = Date.now();
              logTtsEvent("request", {
                sessionId: ttsSessionId,
                trigger,
                format,
                playbackPrepMs: playbackSessionPrepMs,
                textChars: textToSpeak.length,
                language: effectiveLanguage,
                locale: effectiveLocale,
                guestTts: Boolean(session.guestTtsToken?.trim()),
              });
              try {
                const audioBlob = await fetchTtsAudio({
                  apiBaseUrl: publicApiBase,
                  bearerToken: activeBearerToken || undefined,
                  guestTtsToken: session.guestTtsToken,
                  text: textToSpeak,
                  voice: AI_TTS_DEFAULT_VOICE,
                  format,
                  language: effectiveLanguage,
                  locale: effectiveLocale,
                  instructions: aiTtsInstructions,
                });
                const blobReadyAt = Date.now();
                const responseReceivedAt = blobReadyAt;
                const audioBase64 = await blobToBase64(audioBlob);
                const base64ReadyAt = Date.now();
                const tempUri = `${cacheBase}bfzoom-tts-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 8)}.${getTtsTempExtension(format)}`;
                await FileSystemLegacy.writeAsStringAsync(tempUri, audioBase64, {
                  encoding: "base64" as never,
                });
                const fileReadyAt = Date.now();
                if (requestSeq !== ttsRequestSeqRef.current) {
                  void FileSystemLegacy.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
                  finalizeTtsSession(ttsSessionId);
                  return;
                }
                logTtsEvent("response", {
                  sessionId: ttsSessionId,
                  trigger,
                  format,
                  requestMs: fileReadyAt - requestStartedAt,
                  networkMs: responseReceivedAt - requestStartedAt,
                  blobMs: blobReadyAt - responseReceivedAt,
                  base64Ms: base64ReadyAt - blobReadyAt,
                  fileWriteMs: fileReadyAt - base64ReadyAt,
                  localPrepMs: fileReadyAt - responseReceivedAt,
                  playbackPrepMs: playbackSessionPrepMs,
                  fileBytes: audioBlob.size,
                  textChars: textToSpeak.length,
                });
                playTtsUri(tempUri, {
                  sessionId: ttsSessionId,
                  trigger,
                  source: "server",
                  format,
                  language: effectiveLanguage,
                  textChars: textToSpeak.length,
                  fileBytes: audioBlob.size,
                  requestStartedAt,
                });
                let playbackWaitMs: number | undefined;

                if (Platform.OS === "ios") {
                  clearTtsPlaybackWatchdog();
                  const playbackWaitStartedAt = Date.now();
                  const playbackStarted = await waitForTtsPlaybackStart(
                    ttsSessionId,
                    IOS_AI_TTS_PLAYBACK_START_TIMEOUT_MS
                  );
                  playbackWaitMs = Date.now() - playbackWaitStartedAt;
                  if (!playbackStarted) {
                    lastTtsError = `iOS playback stall (${format})`;
                    logTtsEvent(
                      "play_stall",
                      {
                        sessionId: ttsSessionId,
                        trigger,
                        format,
                        requestMs: Date.now() - requestStartedAt,
                        networkMs: responseReceivedAt - requestStartedAt,
                        localPrepMs: fileReadyAt - responseReceivedAt,
                        playbackWaitMs,
                        fileBytes: audioBlob.size,
                      },
                      "warn"
                    );
                    stopTtsPlayer({
                      preserveDucking: true,
                      reason: "playback_stall",
                      level: "warn",
                    });
                    continue;
                  }
                }

                ttsPlaybackMetaRef.current = {
                  sessionId: ttsSessionId,
                  trigger,
                  source: "server",
                  format,
                  language: effectiveLanguage,
                  textChars: textToSpeak.length,
                  fileBytes: audioBlob.size,
                  requestStartedAt,
                  playbackStartedAt: Date.now(),
                };
                logTtsEvent("play_start", {
                  sessionId: ttsSessionId,
                  trigger,
                  source: "server",
                  format,
                  requestMs: Date.now() - requestStartedAt,
                  networkMs: responseReceivedAt - requestStartedAt,
                  blobMs: blobReadyAt - responseReceivedAt,
                  base64Ms: base64ReadyAt - blobReadyAt,
                  fileWriteMs: fileReadyAt - base64ReadyAt,
                  localPrepMs: fileReadyAt - responseReceivedAt,
                  playbackPrepMs: playbackSessionPrepMs,
                  playbackWaitMs,
                  totalToPlayMs: Date.now() - requestStartedAt,
                  fileBytes: audioBlob.size,
                  textChars: textToSpeak.length,
                });
                return;
              } catch (formatError) {
                lastTtsError =
                  formatError instanceof Error
                    ? formatError.message.trim() || `TTS failed (${format})`
                    : String(formatError || `TTS failed (${format})`).trim();
                logTtsEvent(
                  "request_failed",
                  {
                    sessionId: ttsSessionId,
                    trigger,
                    format,
                    requestMs: Date.now() - requestStartedAt,
                    message: lastTtsError,
                  },
                  "warn"
                );
              }
            }

            throw new Error(lastTtsError || "Voix IA indisponible temporairement.");
          } catch (ttsError) {
            const ttsReason =
              ttsError instanceof Error ? ttsError.message.trim() : String(ttsError || "").trim();
            logTtsEvent(
              "fallback_device",
              {
                sessionId: ttsSessionId,
                trigger,
                message: ttsReason || "unknown",
              },
              "warn"
            );
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
        logTtsEvent(
          "fatal",
          {
            sessionId: ttsSessionId,
            trigger,
            message: err instanceof Error ? err.message : String(err),
          },
          "warn"
        );
        if (!realtimeEnabled) {
          setTranslationError(toFriendlyAudioError(err, language));
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
      refreshBearerToken,
      session.guestTtsToken,
      prepareTtsPlayback,
      duckRemoteAudioForTts,
      stopTtsPlayer,
      availableVoices,
      targetLanguage,
      targetSpeechLocale,
      ttsEnabled,
      voiceId,
      clearTtsPlaybackWatchdog,
      getPromptLanguageName,
      queueCaptionPhoneticFlush,
      waitForTtsPlaybackStart,
    ]
  );

  const autoSpeakTranslatedText = useCallback(
    (text: string, languageOverride?: LanguageCode) => {
      if (!ttsEnabled) return;
      if (hasPreferredTranslatorAudioTrack) return;
      if (groupVoicePlaybackLimited) return;
      void speakText(text, languageOverride, "auto");
    },
    [groupVoicePlaybackLimited, hasPreferredTranslatorAudioTrack, speakText, ttsEnabled]
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
    void speakText(text, undefined, "replay");
  }, [captionText, speakText]);

  const retranslateCurrentSource = useCallback(async () => {
    const cleanSource = sourceText.trim();
    if (!cleanSource || translationBusy) return;
    if (translationControlsDisabled) {
      setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
      return;
    }

    setTranslationBusy(true);
    setTranslationError("");
    try {
      if (isHostSession) {
        const consumed = await consumeTranslationSeconds(1, "local");
        if (!consumed) {
          setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
          return;
        }
      }

      const sourceLang = sourceTextLanguageRef.current || sourceLanguage;
      let translated = "";
      if (sourceLang === targetLanguage) {
        translated = cleanSource;
      } else {
        try {
          translated = await withFreshBearerToken((activeBearerToken) =>
            translateText({
              apiBaseUrl: publicApiBase,
              bearerToken: activeBearerToken,
              guestTtsToken: session.guestTtsToken,
              text: cleanSource,
              fromLanguage: getPromptLanguageName(sourceLang),
              toLanguage: getPromptLanguageName(targetLanguage),
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : ui.translationUnavailableError;
          setTranslationError(
            /forbidden|403|acces refuse|accès refusé/i.test(message)
              ? ui.translationForbidden
              : ui.translationFallback(message)
          );
        }
      }

      const finalCaption = translated.trim() || cleanSource;
      if (!finalCaption) {
        throw new Error(language === "fr" ? "Traduction vide." : "Empty translation.");
      }
      setCaptionText(finalCaption);
      autoSpeakTranslatedText(finalCaption);
    } catch (error) {
      setTranslationError(toFriendlyAudioError(error, language));
    } finally {
      setTranslationBusy(false);
    }
  }, [
    consumeTranslationSeconds,
    effectiveTranslationLockMessage,
    getPromptLanguageName,
      isHostSession,
      language,
      publicApiBase,
      session.guestTtsToken,
      sourceLanguage,
      sourceText,
    autoSpeakTranslatedText,
    targetLanguage,
      translationBusy,
      translationControlsDisabled,
      ui.translationFallback,
      ui.translationForbidden,
      ui.translationUnavailableError,
      withFreshBearerToken,
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
    (payload: CaptionPayload, senderIdentity?: string | null) => {
      const receivedAt = Date.now();
      const normalizedSenderIdentity = String(senderIdentity || "").trim();
      if (!normalizedSenderIdentity) return;
      if (!isTrustedHumanParticipantIdentity(normalizedSenderIdentity)) return;
      if (!payload.text && !payload.sourceText) return;
      if (payload.roomId && payload.roomId !== session.roomId) return;
      if (payload.from && payload.from.trim() && payload.from.trim() !== normalizedSenderIdentity) {
        return;
      }
      const resolvedFrom = normalizedSenderIdentity;
      const traceId = String(payload.id || "").trim() || `incoming-${resolvedFrom}-${receivedAt}`;
      const fallbackSource = (payload.sourceText || payload.text || "").trim();
      const fallbackCaption = (payload.text || fallbackSource).trim();
      if (!fallbackCaption) return;
      const speakerLabel = getParticipantLabelByIdentity(resolvedFrom);

      const isLocalCaption = resolvedFrom === session.identity;
      const remoteUsageSeconds = isLocalCaption
        ? null
        : estimateVerifiedRemoteUsageSeconds(resolvedFrom);
      if (!isLocalCaption && remoteUsageSeconds === null) {
        return;
      }
      const verifiedRemoteUsageSeconds = remoteUsageSeconds ?? 1;

      sourceTextLanguageRef.current =
        payload.sourceLang && isLanguageCode(payload.sourceLang)
          ? payload.sourceLang
          : sourceLanguage;
      setSourceText(fallbackSource);
      setSubtitleSpeakerLabel(speakerLabel);

      if (isLocalCaption) {
        setCaptionText(fallbackCaption);
        return;
      }

      void (async () => {
        let consumeMs = 0;
        if (isHostSession) {
          const consumeStartedAt = Date.now();
          const consumed = await consumeTranslationSeconds(verifiedRemoteUsageSeconds, "remote");
          consumeMs = Date.now() - consumeStartedAt;
          if (!consumed) {
            logCallLatencyEvent(
              "incoming_caption_blocked",
              {
                traceId,
                from: resolvedFrom,
                sourceLang: payload.sourceLang,
                payloadTargetLang: payload.targetLang,
                targetLang: targetLanguage,
                consumeMs,
                payloadAgeMs:
                  typeof payload.timestamp === "number"
                    ? Math.max(0, receivedAt - payload.timestamp)
                    : undefined,
              },
              "warn"
            );
            setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
            return;
          }
        }

        if (!payload.sourceText || !payload.sourceLang || payload.targetLang === targetLanguage) {
          logCallLatencyEvent("incoming_caption_ready", {
            traceId,
            mode: "direct_payload",
            from: resolvedFrom,
            sourceLang: payload.sourceLang,
            payloadTargetLang: payload.targetLang,
            targetLang: targetLanguage,
            consumeMs,
            payloadAgeMs:
              typeof payload.timestamp === "number"
                ? Math.max(0, receivedAt - payload.timestamp)
                : undefined,
            totalMs: Date.now() - receivedAt,
            captionChars: fallbackCaption.length,
          });
          setCaptionText(fallbackCaption);
          setTranslationError("");
          autoSpeakTranslatedText(fallbackCaption);
          return;
        }

        const sourceLangCode = payload.sourceLang;
        if (!isLanguageCode(sourceLangCode)) {
          logCallLatencyEvent("incoming_caption_ready", {
            traceId,
            mode: "invalid_source_lang_fallback",
            from: resolvedFrom,
            payloadTargetLang: payload.targetLang,
            targetLang: targetLanguage,
            consumeMs,
            payloadAgeMs:
              typeof payload.timestamp === "number"
                ? Math.max(0, receivedAt - payload.timestamp)
                : undefined,
            totalMs: Date.now() - receivedAt,
            captionChars: fallbackCaption.length,
          });
          setCaptionText(fallbackCaption);
          setTranslationError("");
          autoSpeakTranslatedText(fallbackCaption);
          return;
        }

        if (sourceLangCode === targetLanguage) {
          const sameLanguageCaption =
            (payload.sourceText || fallbackSource || fallbackCaption).trim() || fallbackCaption;
          logCallLatencyEvent("incoming_caption_ready", {
            traceId,
            mode: "source_same_language_bypass",
            from: resolvedFrom,
            sourceLang: sourceLangCode,
            payloadTargetLang: payload.targetLang,
            targetLang: targetLanguage,
            consumeMs,
            payloadAgeMs:
              typeof payload.timestamp === "number"
                ? Math.max(0, receivedAt - payload.timestamp)
                : undefined,
            totalMs: Date.now() - receivedAt,
            captionChars: sameLanguageCaption.length,
          });
          setCaptionText(sameLanguageCaption);
          setTranslationError("");
          autoSpeakTranslatedText(sameLanguageCaption);
          return;
        }

        const sequence = ++incomingTranslationSeqRef.current;
        try {
          const translateStartedAt = Date.now();
          const personalized = await withFreshBearerToken((activeBearerToken) =>
            translateText({
              apiBaseUrl: publicApiBase,
              bearerToken: activeBearerToken,
              guestTtsToken: session.guestTtsToken,
              text: payload.sourceText || "",
              fromLanguage: getPromptLanguageName(sourceLangCode),
              toLanguage: getPromptLanguageName(targetLanguage),
            })
          );
          if (sequence !== incomingTranslationSeqRef.current) return;
          const caption = personalized.trim() || fallbackCaption;
          logCallLatencyEvent("incoming_caption_ready", {
            traceId,
            mode: "personalized_translation",
            from: resolvedFrom,
            sourceLang: sourceLangCode,
            payloadTargetLang: payload.targetLang,
            targetLang: targetLanguage,
            consumeMs,
            translateMs: Date.now() - translateStartedAt,
            payloadAgeMs:
              typeof payload.timestamp === "number"
                ? Math.max(0, receivedAt - payload.timestamp)
                : undefined,
            totalMs: Date.now() - receivedAt,
            captionChars: caption.length,
          });
          setCaptionText(caption);
          setTranslationError("");
          autoSpeakTranslatedText(caption);
        } catch {
          if (sequence !== incomingTranslationSeqRef.current) return;
          logCallLatencyEvent(
            "incoming_caption_ready",
            {
              traceId,
              mode: "translation_fallback",
              from: resolvedFrom,
              sourceLang: sourceLangCode,
              payloadTargetLang: payload.targetLang,
              targetLang: targetLanguage,
              consumeMs,
              payloadAgeMs:
                typeof payload.timestamp === "number"
                  ? Math.max(0, receivedAt - payload.timestamp)
                  : undefined,
              totalMs: Date.now() - receivedAt,
              captionChars: fallbackCaption.length,
            },
            "warn"
          );
          setCaptionText(fallbackCaption);
          autoSpeakTranslatedText(fallbackCaption);
        }
      })();
    },
    [
      consumeTranslationSeconds,
      effectiveTranslationLockMessage,
      estimateVerifiedRemoteUsageSeconds,
      getParticipantLabelByIdentity,
      getPromptLanguageName,
      isHostSession,
      isTrustedHumanParticipantIdentity,
      session.guestTtsToken,
      session.identity,
      session.roomId,
      publicApiBase,
      sourceLanguage,
      autoSpeakTranslatedText,
      targetLanguage,
      withFreshBearerToken,
    ]
  );

  useEffect(() => {
    if (!room) return;
    const onData = (
      data: Uint8Array,
      participant?: Participant,
      _kind?: unknown,
      topic?: string
    ) => {
      if (!topic) return;
      try {
        const raw = new TextDecoder().decode(data);
        if (topic === "bfzoom-captions") {
          const parsed = JSON.parse(raw) as CaptionPayload;
          handleIncomingCaption(parsed, participant?.identity);
          return;
        }
        if (topic === TALKIE_LOCK_TOPIC) {
          const parsed = JSON.parse(raw) as TalkieLockPayload;
          applyTalkieLockPayload(parsed, participant?.identity);
          return;
        }
        if (topic === TRANSLATION_ACCESS_TOPIC) {
          if (isHostSession) return;
          const senderIdentity = String(participant?.identity || "").trim();
          if (!senderIdentity) return;
          const parsed = JSON.parse(raw) as TranslationAccessPayload;
          if (parsed.from && parsed.from.trim() && parsed.from.trim() !== senderIdentity) return;
          if (isTranslatorIdentity(senderIdentity)) return;
          if (getParticipantRoleFromMetadata(participant?.metadata) === "translator") return;
          if (parsed.roomId && parsed.roomId !== session.roomId) return;
          setRoomTranslationEnabled(Boolean(parsed.enabled));
          const normalizedReason = String(parsed.reason || "").trim();
          setRoomTranslationReason(normalizedReason || ui.translationUnlockHint);
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
  }, [
    applyTalkieLockPayload,
    handleIncomingCaption,
    isHostSession,
    room,
    session.roomId,
    ui.translationUnlockHint,
  ]);

  const publishCaption = useCallback(
    async (payload: CaptionPayload) => {
      if (!localParticipant) return;
      if (!canPublishRoomData()) return;
      const text = JSON.stringify(payload);
      await localParticipant.publishData(new TextEncoder().encode(text), {
        reliable: true,
        topic: "bfzoom-captions",
      });
    },
    [connected, localParticipant, room]
  );

  const flushNativeRealtimeOutput = useCallback(async () => {
    const text = realtimeOutputBufferRef.current.trim();
    realtimeOutputBufferRef.current = "";
    if (!text) return;

    setCaptionText(text);
    setSubtitleSpeakerLabel(`${session.displayName || session.identity || "BFZoom"}${ui.meSuffix}`);
    if (!captionsEnabled) return;
    await publishCaption({
      roomId: session.roomId,
      from: session.identity,
      speakerName: session.displayName,
      text,
      sourceText: realtimeInputTranscriptRef.current || undefined,
      sourceLang: sourceLanguage,
      targetLang: targetLanguage,
      timestamp: Date.now(),
    });
  }, [
    captionsEnabled,
    publishCaption,
    session.displayName,
    session.identity,
    session.roomId,
    sourceLanguage,
    targetLanguage,
    ui.meSuffix,
  ]);

  const runNativeRealtimeSession = useCallback(
    async (isCancelled: () => boolean, sessionId: number) => {
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
          if (sessionId !== realtimeSessionIdRef.current || isCancelled()) return;
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
          if (sessionId !== realtimeSessionIdRef.current || isCancelled()) return;
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
          if (sessionId !== realtimeSessionIdRef.current) {
            ws.close();
            completeResolve();
            return;
          }
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
          if (isCancelled() || sessionId !== realtimeSessionIdRef.current) return;
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
            setSubtitleSpeakerLabel(`${session.displayName || session.identity || "BFZoom"}${ui.meSuffix}`);
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
          if (isCancelled() || sessionId !== realtimeSessionIdRef.current) return;
          setTranslationError("Realtime WS connection failed.");
          setRealtimeStatus("error");
          setForceSegmentedRealtime(true);
          setRealtimeEnabled(false);
          if (!opened) {
            completeReject(new Error("Realtime websocket connection failed."));
          }
        };

        ws.onclose = (event) => {
          if (isCancelled() || sessionId !== realtimeSessionIdRef.current) return;
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
      realtimeSessionIdRef,
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
      durationSeconds = 1,
      trace?: ProcessTranscriptTrace
    ) => {
      const clean = transcribedText.trim();
      if (!clean) return;
      const processStartedAt = Date.now();
      const traceId = trace?.traceId || `${trace?.path || "direct"}-${processStartedAt}`;
      sourceTextLanguageRef.current = sourceLang;
      setSourceText(clean);
      setSubtitleSpeakerLabel(`${session.displayName || session.identity || "BFZoom"}${ui.meSuffix}`);
      setTranslationError("");

      let translated = "";
      let translationMode: "api" | "same_language_bypass" | "fallback_source" = "api";
      let translateMs = 0;
      try {
        if (sourceLang === targetLanguage) {
          translated = clean;
          translationMode = "same_language_bypass";
        } else {
          const translateStartedAt = Date.now();
          translated = await withFreshBearerToken((activeBearerToken) =>
            translateText({
              apiBaseUrl: publicApiBase,
              bearerToken: activeBearerToken,
              guestTtsToken: session.guestTtsToken,
              text: clean,
              fromLanguage: getPromptLanguageName(sourceLang),
              toLanguage: getPromptLanguageName(targetLanguage),
            })
          );
          translateMs = Date.now() - translateStartedAt;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : ui.translationUnavailableError;
        translationMode = "fallback_source";
        setTranslationError(
          /forbidden|403|acces refuse|accès refusé/i.test(message)
            ? ui.translationForbidden
            : ui.translationFallback(message)
        );
      }
      const finalCaption = translated.trim() || clean;
      if (!finalCaption) {
        throw new Error(language === "fr" ? "Traduction vide." : "Empty translation.");
      }

      setCaptionText(finalCaption);
      setTranslationError("");
      autoSpeakTranslatedText(finalCaption);
      let publishMs = 0;
      if (captionsEnabled) {
        const publishStartedAt = Date.now();
        await publishCaption({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roomId: session.roomId,
          from: session.identity,
          speakerName: session.displayName,
          text: finalCaption,
          sourceText: clean,
          sourceLang,
          targetLang: targetLanguage,
          durationSeconds: Math.max(1, Math.min(300, Math.floor(durationSeconds || 1))),
          timestamp: Date.now(),
        }).catch(() => {});
        publishMs = Date.now() - publishStartedAt;
      }
      const completedAt = Date.now();
      logCallLatencyEvent("transcript_ready", {
        traceId,
        path: trace?.path || "direct",
        sourceLang,
        targetLang: targetLanguage,
        translationMode,
        transcribeMs: trace?.transcribeMs,
        draftReadyMs: trace?.draftReadyMs,
        reviewToConfirmMs:
          typeof trace?.reviewOpenedAt === "number" && typeof trace?.confirmStartedAt === "number"
            ? Math.max(0, trace.confirmStartedAt - trace.reviewOpenedAt)
            : undefined,
        consumeMs: trace?.consumeMs,
        lockClaimMs: trace?.lockClaimMs,
        translateMs,
        publishMs,
        processMs: completedAt - processStartedAt,
        flowMs:
          typeof trace?.stopStartedAt === "number"
            ? Math.max(0, completedAt - trace.stopStartedAt)
            : undefined,
        capturedToCaptionMs:
          typeof trace?.segmentCapturedAt === "number"
            ? Math.max(0, completedAt - trace.segmentCapturedAt)
            : undefined,
        textChars: clean.length,
        captionChars: finalCaption.length,
      });
    },
    [
      captionsEnabled,
      getPromptLanguageName,
      publishCaption,
      session.displayName,
      session.guestTtsToken,
      session.identity,
      session.roomId,
      publicApiBase,
      isHostSession,
      sourceLanguage,
      autoSpeakTranslatedText,
      targetLanguage,
      ui.meSuffix,
      withFreshBearerToken,
    ]
  );

  const transcribeWithFallbackLanguage = useCallback(
    async (
      audioUri: string,
      sourceLang?: LanguageCode,
      clientMetrics?: {
        recordingMs?: number;
        recorderStopMs?: number;
        postStopSettleMs?: number;
        resolveUriMs?: number;
        stabilizeMs?: number;
        preUploadMs?: number;
      },
      requestControl?: {
        signal?: AbortSignal;
      }
    ) => {
      let sawScriptMismatch = false;
      let shouldRetryWithoutHint = false;
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

      const firstPass = await withFreshBearerToken((activeBearerToken) =>
        transcribeAudio({
          apiBaseUrl: publicApiBase,
          bearerToken: activeBearerToken,
          guestTtsToken: session.guestTtsToken,
          audioUri,
          language: sourceLang,
          clientMetrics,
          signal: requestControl?.signal,
        })
      );
      const trimmedFirstPass = firstPass.trim();
      const normalizedFirstPass = normalize(firstPass);
      shouldRetryWithoutHint = !trimmedFirstPass || sawScriptMismatch;
      if (normalizedFirstPass) return normalizedFirstPass;
      if (!shouldRetryWithoutHint) {
        if (sawScriptMismatch) {
          throw new Error("Source language mismatch.");
        }
        return "";
      }

      // Fallback sans hint langue pour éviter les faux "No speech detected" sur iOS.
      const secondPass = await withFreshBearerToken((activeBearerToken) =>
        transcribeAudio({
          apiBaseUrl: publicApiBase,
          bearerToken: activeBearerToken,
          guestTtsToken: session.guestTtsToken,
          audioUri,
          clientMetrics,
          signal: requestControl?.signal,
        })
      );
      const normalizedSecondPass = normalize(secondPass);
      if (normalizedSecondPass) return normalizedSecondPass;
      if (sawScriptMismatch) {
        throw new Error("Source language mismatch.");
      }
      return "";
    },
    [publicApiBase, session.guestTtsToken, withFreshBearerToken]
  );

  const stopRecordingAndTranslate = useCallback(async () => {
    if (stopTranslateInFlightRef.current) return;
    stopTranslateInFlightRef.current = true;
    manualStopRequestIdRef.current += 1;
    const stopRequestId = manualStopRequestIdRef.current;
    const stopStartedAt = Date.now();
    const traceId = `manual-${stopRequestId}-${stopStartedAt}`;
    const abortController = typeof AbortController === "undefined" ? null : new AbortController();
    activeTranscriptionAbortControllerRef.current?.abort();
    activeTranscriptionAbortControllerRef.current = abortController;
    const isStopRequestActive = () =>
      stopRequestId === manualStopRequestIdRef.current
      && appStateRef.current === "active"
      && !(abortController?.signal.aborted);
    let reviewOpened = false;
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
        setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
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
        throw new Error(ui.speakAtLeastOneSecond);
      }
      const baselineUri =
        recordingStartUriRef.current || recorder.uri || recorderUrlRef.current || "";
      const preUploadStartedAt = Date.now();
      const recorderStopStartedAt = Date.now();
      try {
        await recorder.stop();
      } catch {}
      const recorderStopMs = Date.now() - recorderStopStartedAt;
      const postStopSettleStartedAt = Date.now();
      await wait(MANUAL_POST_STOP_SETTLE_MS);
      const postStopSettleMs = Date.now() - postStopSettleStartedAt;
      if (!isStopRequestActive()) {
        return;
      }
      const resolveUriStartedAt = Date.now();
      const uri = await resolveFreshRecordingUri(baselineUri);
      const resolveUriMs = Date.now() - resolveUriStartedAt;
      if (!isStopRequestActive()) {
        return;
      }
      if (!uri) {
        throw new Error(
          language === "fr" ? "URI d'enregistrement introuvable." : "Recording URI missing."
        );
      }
      if (baselineUri && uri === baselineUri) {
        throw new Error(ui.audioNotFinalized);
      }
      lastProcessedRecordingUriRef.current = uri;
      const stabilizeStartedAt = Date.now();
      const stable = await stabilizeRecordedAudioUri(uri, MANUAL_MIN_SEGMENT_BYTES);
      const stabilizeMs = Date.now() - stabilizeStartedAt;
      if (!isStopRequestActive()) {
        return;
      }
      if (stable.size < MANUAL_MIN_SEGMENT_BYTES) {
        throw new Error(ui.audioTooShort);
      }

      const transcribeStartedAt = Date.now();
      const transcribed = await transcribeWithFallbackLanguage(
        stable.uri,
        sourceLanguage,
        {
          recordingMs: durationMs,
          recorderStopMs,
          postStopSettleMs,
          resolveUriMs,
          stabilizeMs,
          preUploadMs: Date.now() - preUploadStartedAt,
        },
        {
          signal: abortController?.signal,
        }
      );
      const transcribeMs = Date.now() - transcribeStartedAt;
      if (!transcribed || isLikelyLowSignalTranscript(transcribed, sourceLanguage)) {
        throw new Error("No speech detected.");
      }
      const usageSeconds = Math.max(1, Math.min(300, Math.floor(durationMs / 1000) || 1));
      const draft = transcribed.trim();
      if (!draft || isKnownBadTranscript(draft)) {
        throw new Error("No speech detected.");
      }
      if (!isStopRequestActive()) {
        return;
      }
      setSourceText(draft);
      setSubtitleSpeakerLabel(`${session.displayName || session.identity || "BFZoom"}${ui.meSuffix}`);
      sourceTextLanguageRef.current = sourceLanguage;
      setManualDraftText(draft);
      setManualDraftDurationSeconds(usageSeconds);
      setManualDraftSourceLanguage(sourceLanguage);
      setTalkieUiState("review");
      reviewOpened = true;
      setManualDraftVisible(true);
      setTranslationPanelOpen(true);
      setTranslationError("");
      const reviewOpenedAt = Date.now();
      const draftReadyMs = reviewOpenedAt - stopStartedAt;
      manualDraftLatencyRef.current = {
        traceId,
        stopStartedAt,
        reviewOpenedAt,
        draftReadyMs,
        transcribeMs,
        recordingMs: durationMs,
        usageSeconds,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
        draftChars: draft.length,
      };
      logCallLatencyEvent("manual_review_ready", {
        traceId,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
        recordingMs: durationMs,
        recorderStopMs,
        postStopSettleMs,
        resolveUriMs,
        stabilizeMs,
        transcribeMs,
        draftReadyMs,
        usageSeconds,
        draftChars: draft.length,
      });
    } catch (err) {
      if (!isStopRequestActive() && appStateRef.current !== "active") {
        return;
      }
      const raw = err instanceof Error ? err.message : String(err || "");
      manualDraftLatencyRef.current = null;
      if (/no speech detected/i.test(raw)) {
        setSourceText("");
        sourceTextLanguageRef.current = sourceLanguage;
        setCaptionText("");
        setSubtitleSpeakerLabel("");
        setManualDraftVisible(false);
        setManualDraftText("");
        setManualDraftDurationSeconds(1);
        setManualDraftSourceLanguage(sourceLanguage);
        setManualDraftSending(false);
      }
      logCallLatencyEvent(
        "manual_review_failed",
        {
          traceId,
          sourceLang: sourceLanguage,
          targetLang: targetLanguage,
          totalMs: Date.now() - stopStartedAt,
          message: raw || "unknown",
        },
        "warn"
      );
      setTranslationError(toFriendlyAudioError(err, language));
    } finally {
      if (activeTranscriptionAbortControllerRef.current === abortController) {
        activeTranscriptionAbortControllerRef.current = null;
      }
      manualRecordingStartedAtRef.current = 0;
      manualStartInFlightRef.current = false;
      pendingStopAfterStartRef.current = false;
      recordingStartUriRef.current = "";
      try {
        await setPlaybackAudioMode();
      } catch {}
      if (!reviewOpened) {
        await restoreRoomMicAfterRecorder();
      }
      await releaseExpoAudioActivity();
      await publishTalkieLock("release");
      setTranslationBusy(false);
      if (!reviewOpened || !isStopRequestActive()) {
        setTalkieUiState("idle");
      }
      stopTranslateInFlightRef.current = false;
    }
  }, [
    publishTalkieLock,
    effectiveTranslationLockMessage,
    language,
    recorder,
    resolveFreshRecordingUri,
    realtimeEnabled,
    releaseExpoAudioActivity,
    recordingActive,
    session.displayName,
    session.identity,
    restoreRoomMicAfterRecorder,
    recorderState.durationMillis,
    setPlaybackAudioMode,
    sourceLanguage,
    stabilizeRecordedAudioUri,
    translationControlsDisabled,
    transcribeWithFallbackLanguage,
    ui.audioNotFinalized,
    ui.audioTooShort,
    ui.meSuffix,
    ui.speakAtLeastOneSecond,
    targetLanguage,
  ]);

  const cancelManualDraft = useCallback(() => {
    manualDraftLatencyRef.current = null;
    setManualDraftVisible(false);
    setManualDraftText("");
    setManualDraftDurationSeconds(1);
    setManualDraftSourceLanguage(sourceLanguage);
    setManualDraftSending(false);
    setTalkieUiState("idle");
    void restoreRoomMicAfterRecorder();
  }, [restoreRoomMicAfterRecorder, sourceLanguage]);

  const confirmManualDraftSend = useCallback(async () => {
    const draft = manualDraftText.trim();
    if (!draft || manualDraftSending) return;
    if (translationControlsDisabled) {
      setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
      return;
    }
    const usageSeconds = Math.max(1, Math.min(300, Math.floor(manualDraftDurationSeconds || 1)));
    const confirmStartedAt = Date.now();
    const manualDraftLatency = manualDraftLatencyRef.current;
    const traceId = manualDraftLatency?.traceId || `manual-send-${confirmStartedAt}`;

    setManualDraftSending(true);
    setTranslationBusy(true);
    setTranslationError("");
    let shouldRestoreRoomMic = false;
    let talkieLockClaimed = false;
    let sendCompleted = false;
    let draftDismissed = false;
    try {
      const consumeStartedAt = Date.now();
      const consumed = await consumeTranslationSeconds(usageSeconds, "local");
      const consumeMs = Date.now() - consumeStartedAt;
      if (!consumed) {
        logCallLatencyEvent(
          "manual_send_blocked",
          {
            traceId,
            sourceLang: manualDraftSourceLanguage,
            targetLang: targetLanguage,
            reviewToConfirmMs:
              typeof manualDraftLatency?.reviewOpenedAt === "number"
                ? Math.max(0, confirmStartedAt - manualDraftLatency.reviewOpenedAt)
                : undefined,
            consumeMs,
            usageSeconds,
          },
          "warn"
        );
        setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
        return;
      }
      setSourceText(draft);
      setSubtitleSpeakerLabel(`${session.displayName || session.identity || "BFZoom"}${ui.meSuffix}`);
      sourceTextLanguageRef.current = manualDraftSourceLanguage;
      setManualDraftVisible(false);
      setManualDraftText("");
      setManualDraftDurationSeconds(1);
      setManualDraftSourceLanguage(sourceLanguage);
      setTalkieUiState("idle");
      draftDismissed = true;
      shouldRestoreRoomMic = true;
      const lockClaimStartedAt = Date.now();
      await publishTalkieLock("claim");
      const lockClaimMs = Date.now() - lockClaimStartedAt;
      talkieLockClaimed = true;
      await processTranscript(draft, manualDraftSourceLanguage, usageSeconds, {
        path: "manual_send",
        traceId,
        stopStartedAt: manualDraftLatency?.stopStartedAt,
        reviewOpenedAt: manualDraftLatency?.reviewOpenedAt,
        confirmStartedAt,
        consumeMs,
        lockClaimMs,
        transcribeMs: manualDraftLatency?.transcribeMs,
        draftReadyMs: manualDraftLatency?.draftReadyMs,
      });
      sendCompleted = true;
      manualDraftLatencyRef.current = null;
    } catch (err) {
      logCallLatencyEvent(
        "manual_send_failed",
        {
          traceId,
          sourceLang: manualDraftSourceLanguage,
          targetLang: targetLanguage,
          totalMs: Date.now() - confirmStartedAt,
          message: err instanceof Error ? err.message : String(err || "unknown"),
        },
        "warn"
      );
      setTranslationError(toFriendlyAudioError(err, language));
    } finally {
      if (talkieLockClaimed) {
        await publishTalkieLock("release");
      }
      if (shouldRestoreRoomMic) {
        await restoreRoomMicAfterRecorder();
      }
      setManualDraftSending(false);
      setTranslationBusy(false);
      if (!sendCompleted && draftDismissed) {
        manualDraftLatencyRef.current = null;
      }
    }
  }, [
    consumeTranslationSeconds,
    effectiveTranslationLockMessage,
    language,
    manualDraftDurationSeconds,
    manualDraftSending,
    manualDraftSourceLanguage,
    manualDraftText,
    processTranscript,
    publishTalkieLock,
    restoreRoomMicAfterRecorder,
    session.displayName,
    session.identity,
    sourceLanguage,
    targetLanguage,
    translationControlsDisabled,
    ui.meSuffix,
    ui.translationUnlockHint,
  ]);

  const triggerTalkieHaptic = useCallback((kind: "start" | "stop") => {
    if (Platform.OS !== "ios") return;
    const fallbackDuration = kind === "start" ? 12 : 18;
    try {
      void Haptics.impactAsync(
        kind === "start"
          ? Haptics.ImpactFeedbackStyle.Light
          : Haptics.ImpactFeedbackStyle.Medium
      ).catch(() => {
        try {
          Vibration.cancel();
          Vibration.vibrate(fallbackDuration);
        } catch {}
      });
    } catch {
      try {
        Vibration.cancel();
        Vibration.vibrate(fallbackDuration);
      } catch {}
    }
  }, []);

  const handleManualPushToTalkPressIn = useCallback(() => {
    if (realtimeEnabled || translationBusy) return;
    if (talkieUiState !== "idle") return;
    if (appStateRef.current !== "active") return;
    if (translationControlsDisabled) {
      setRecordingError(effectiveTranslationLockMessage || ui.translationUnlockHint);
      return;
    }
    if (isTalkieLockedByOther) {
      const holder = talkieLockHolderName || "un interlocuteur";
      setRecordingError(
        language === "fr"
          ? `Talkie occupe: ${holder} parle en ce moment.`
          : `Talkie busy: ${holder} is speaking right now.`
      );
      return;
    }
    triggerTalkieHaptic("start");
    setManualDraftVisible(false);
    setManualDraftText("");
    setManualDraftDurationSeconds(1);
    setManualDraftSourceLanguage(sourceLanguage);
    setManualDraftSending(false);
    manualDraftLatencyRef.current = null;
    manualPushToTalkPressedRef.current = true;
    pendingStopAfterStartRef.current = false;
    manualStartInFlightRef.current = true;
    setTalkieUiState("starting");
    manualStartRequestIdRef.current += 1;
    const requestId = manualStartRequestIdRef.current;
    if (manualStartAnimationFrameRef.current !== null) {
      cancelAnimationFrame(manualStartAnimationFrameRef.current);
      manualStartAnimationFrameRef.current = null;
    }
    manualStartAnimationFrameRef.current = requestAnimationFrame(() => {
      manualStartAnimationFrameRef.current = null;
      void (async () => {
        if (requestId !== manualStartRequestIdRef.current || appStateRef.current !== "active") {
          manualStartInFlightRef.current = false;
          return;
        }
        await publishTalkieLock("claim");
        if (requestId !== manualStartRequestIdRef.current || appStateRef.current !== "active") {
          manualPushToTalkPressedRef.current = false;
          pendingStopAfterStartRef.current = false;
          manualStartInFlightRef.current = false;
          await publishTalkieLock("release");
          return;
        }
        const started = await startRecording();
        manualStartInFlightRef.current = false;
        if (!started || requestId !== manualStartRequestIdRef.current || appStateRef.current !== "active") {
          if (started) {
            manualRecordingStartedAtRef.current = 0;
            recordingStartUriRef.current = "";
            try {
              await recorder.stop();
            } catch {}
            try {
              await setPlaybackAudioMode();
            } catch {}
            await restoreRoomMicAfterRecorder();
            await releaseExpoAudioActivity();
          }
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
    });
  }, [
    appStateRef,
    effectiveTranslationLockMessage,
    isTalkieLockedByOther,
    language,
    publishTalkieLock,
    realtimeEnabled,
    recorder,
    releaseExpoAudioActivity,
    restoreRoomMicAfterRecorder,
    setPlaybackAudioMode,
    startRecording,
    stopRecordingAndTranslate,
    talkieLockHolderName,
    talkieUiState,
    sourceLanguage,
    triggerTalkieHaptic,
    translationControlsDisabled,
    translationBusy,
    ui.translationUnlockHint,
  ]);

  const toggleRealtimeMode = useCallback(() => {
    if (translationControlsDisabled) {
      setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
      return;
    }
    if (!REALTIME_TRANSLATION_ENABLED) {
      setTranslationError(
        language === "fr"
          ? "Mode voix naturelle desactive dans cette version."
          : "Natural voice mode is disabled in this version."
      );
      return;
    }
    if (!realtimeEnabled && !realtimeConfigured) {
      setTranslationError(
        language === "fr"
          ? "Voix naturelle indisponible: configure EXPO_PUBLIC_REALTIME_URL."
          : "Natural voice is unavailable: configure EXPO_PUBLIC_REALTIME_URL."
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
    language,
    publishTalkieLock,
    realtimeEnabled,
    realtimeConfigured,
    translationControlsDisabled,
    ui.translationUnlockHint,
  ]);

  const handleManualPushToTalkPressOut = useCallback(() => {
    triggerTalkieHaptic("stop");
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
  }, [recordingActive, stopRecordingAndTranslate, triggerTalkieHaptic]);

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
        setTranslationError(
          language === "fr"
            ? "Realtime surcharge: un segment audio a ete ignore pour garder une faible latence."
            : "Realtime overload: one audio segment was skipped to preserve low latency."
        );
      }
      setRealtimeQueueDepth(realtimeQueueRef.current.length);
    },
    [sourceLanguage]
  );

  const processRealtimeQueue = useCallback(
    async (isCancelled: () => boolean, sessionId: number) => {
      const isRealtimeSessionActive = () =>
        !isCancelled() && realtimeSessionIdRef.current === sessionId;
      while (isRealtimeSessionActive() && (realtimeLoopRef.current || realtimeQueueRef.current.length > 0)) {
        const segment = realtimeQueueRef.current.shift() || null;
        setRealtimeQueueDepth(realtimeQueueRef.current.length);
        if (!segment) {
          await wait(50);
          continue;
        }

        const abortController = typeof AbortController === "undefined" ? null : new AbortController();
        try {
          activeTranscriptionAbortControllerRef.current?.abort();
          activeTranscriptionAbortControllerRef.current = abortController;
          const transcribeStartedAt = Date.now();
          const transcribed = await transcribeWithFallbackLanguage(
            segment.uri,
            segment.sourceLang,
            undefined,
            {
              signal: abortController?.signal,
            }
          );
          const transcribeMs = Date.now() - transcribeStartedAt;
          if (!isRealtimeSessionActive()) return;
          const clean = transcribed.trim();
          if (!clean) continue;
          const incremental = extractIncrementalSpeech(lastTranscriptRef.current, clean);
          lastTranscriptRef.current = clean;
          if (!incremental) continue;

          let consumeMs = 0;
          if (isHostSession) {
            const consumeStartedAt = Date.now();
            const consumed = await consumeTranslationSeconds(1, "local");
            consumeMs = Date.now() - consumeStartedAt;
            if (!isRealtimeSessionActive()) return;
            if (!consumed) {
              setTranslationError(effectiveTranslationLockMessage || ui.translationUnlockHint);
              setRealtimeEnabled(false);
              break;
            }
          }
          await processTranscript(incremental, segment.sourceLang, 1, {
            path: "realtime",
            traceId: `realtime-${segment.id}`,
            transcribeMs,
            consumeMs,
            segmentCapturedAt: segment.capturedAt,
          });
          if (!isRealtimeSessionActive()) return;
          setRealtimeLatencyMs(Date.now() - segment.capturedAt);
          setRealtimeStatus("running");
        } catch (err) {
          if (!isRealtimeSessionActive()) return;
          const friendlyError = toFriendlyAudioError(err, language);
          if (/audio invalide|trop court|no speech/i.test(friendlyError)) {
            setRealtimeStatus("running");
            continue;
          }
          setRealtimeStatus("error");
          setTranslationError(friendlyError);
        } finally {
          if (activeTranscriptionAbortControllerRef.current === abortController) {
            activeTranscriptionAbortControllerRef.current = null;
          }
        }
      }
    },
    [
      consumeTranslationSeconds,
      effectiveTranslationLockMessage,
      isHostSession,
      language,
      processTranscript,
      realtimeSessionIdRef,
      transcribeWithFallbackLanguage,
      ui.translationUnlockHint,
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
    const sessionId = realtimeSessionIdRef.current + 1;
    realtimeSessionIdRef.current = sessionId;
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
        throw new Error(language === "fr" ? "Autorisation micro refusee." : "Microphone permission denied.");
      }
      await pauseRoomMicForRecorder();
      if (realtimeNativeEnabled) {
        setRealtimeEngine("native");
        try {
          await runNativeRealtimeSession(isCancelled, sessionId);
          if (realtimeSessionIdRef.current !== sessionId) return;
          return;
        } catch (nativeError) {
          if (isCancelled()) return;
          await stopNativeRealtimeSession().catch(() => {});
          setForceSegmentedRealtime(true);
          setTranslationError(
            language === "fr"
              ? `Live natif indisponible, bascule en mode compatibilite: ${toFriendlyAudioError(
                  nativeError,
                  language
                )}`
              : `Native live mode unavailable, switching to compatibility mode: ${toFriendlyAudioError(
                  nativeError,
                  language
                )}`
          );
          setRealtimeStatus("running");
        }
      }
      setRealtimeEngine("segmented");
      realtimeLoopRef.current = true;
      await Promise.all([
        captureRealtimeLoop(isCancelled),
        processRealtimeQueue(isCancelled, sessionId),
      ]);
    };

    void runRealtime().catch((err) => {
      if (cancelled) return;
      setRealtimeStatus("error");
      setTranslationError(toFriendlyAudioError(err, language));
      setRealtimeEnabled(false);
    });

    return () => {
      cancelled = true;
      if (realtimeSessionIdRef.current === sessionId) {
        realtimeSessionIdRef.current += 1;
      }
      realtimeLoopRef.current = false;
      abortActiveTranscription();
      void stopNativeRealtimeSession();
      void recorder.stop().catch(() => {});
      void setPlaybackAudioMode().catch(() => {});
      void restoreRoomMicAfterRecorder();
      setTranslationBusy(false);
    };
  }, [
    abortActiveTranscription,
    captureRealtimeLoop,
    language,
    pauseRoomMicForRecorder,
    processRealtimeQueue,
    realtimeSessionIdRef,
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

    let cancelled = false;
    const action = realtimeEnabled ? "ensure" : "release";
    const ensureKey = `${session.roomId}:${sourceLanguage}:${targetLanguage}:${realtimeVoiceId}`;
    const releaseRoomKey = session.roomId;

    if (action === "ensure") {
      translatorWorkerReleaseRoomRef.current = "";
      if (translatorWorkerEnsureKeyRef.current === ensureKey) {
        return;
      }
      translatorWorkerEnsureKeyRef.current = ensureKey;
    } else {
      translatorWorkerEnsureKeyRef.current = "";
      if (translatorWorkerReleaseRoomRef.current === releaseRoomKey) {
        return;
      }
      translatorWorkerReleaseRoomRef.current = releaseRoomKey;
    }

    const syncTranslatorWorker = async () => {
      try {
        const response = await withFreshBearerToken(async (activeBearerToken) => {
          const nextResponse = await fetch(`${publicApiBase}/api/livekit/translator/session`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${activeBearerToken}`,
            },
            body: JSON.stringify({
              action,
              room: session.roomId,
              sourceLanguage,
              targetLanguage,
              voice: realtimeVoiceId,
            }),
          });
          if (nextResponse.status === 401) {
            throw new Error("Unauthorized");
          }
          return nextResponse;
        });
        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(raw || `Translator orchestrator error (${response.status})`);
        }
      } catch (error) {
        if (action === "ensure" && translatorWorkerEnsureKeyRef.current === ensureKey) {
          translatorWorkerEnsureKeyRef.current = "";
        }
        if (cancelled) return;
        if (realtimeEnabled) {
          setTranslationError(
            error instanceof Error
            ? language === "fr"
              ? `Worker traducteur indisponible: ${error.message}`
              : `Translator worker unavailable: ${error.message}`
              : language === "fr"
                ? "Worker traducteur indisponible."
                : "Translator worker unavailable."
          );
        }
      }
    };

    void syncTranslatorWorker();

    return () => {
      cancelled = true;
      if (action === "ensure" && translatorWorkerEnsureKeyRef.current === ensureKey) {
        translatorWorkerEnsureKeyRef.current = "";
      }
    };
  }, [
    language,
    realtimeEnabled,
    realtimeVoiceId,
    isHostSession,
    session.roomId,
    publicApiBase,
    sourceLanguage,
    targetLanguage,
    withFreshBearerToken,
  ]);
  useEffect(() => {
    return () => {
      if (!isHostSession) return;
      if (!session.roomId?.trim()) return;
      void (async () => {
        try {
          await withFreshBearerToken(async (activeBearerToken) => {
            const nextResponse = await fetch(`${publicApiBase}/api/livekit/translator/session`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${activeBearerToken}`,
              },
              body: JSON.stringify({
                action: "release",
                room: session.roomId,
              }),
            });
            if (nextResponse.status === 401) {
              throw new Error("Unauthorized");
            }
            return nextResponse;
          });
        } catch {}
      })();
    };
  }, [isHostSession, publicApiBase, session.roomId, withFreshBearerToken]);

  const cancelRecording = useCallback(async () => {
    manualPushToTalkPressedRef.current = false;
    manualStartInFlightRef.current = false;
    manualStopRequestIdRef.current += 1;
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
    await releaseExpoAudioActivity();
    await restoreRoomMicAfterRecorder();
  }, [
    realtimeEnabled,
    recordingActive,
    recorder,
    publishTalkieLock,
    releaseExpoAudioActivity,
    restoreRoomMicAfterRecorder,
    setPlaybackAudioMode,
  ]);
  const roomAlertMessage = recordingError || translationError || voiceLoadError || "";
  const renderRoomAlert = () =>
    roomAlertMessage ? (
      <View
        pointerEvents="none"
        style={[
          styles.roomAlertBanner,
          immersiveMode && styles.roomAlertBannerImmersive,
        ]}
      >
        <Text style={styles.roomAlertText}>{roomAlertMessage}</Text>
      </View>
    ) : null;
  const renderImmersiveControls = () =>
    immersiveMode ? (
      <View
        pointerEvents="box-none"
        style={[styles.immersiveControlsRoot, { top: immersiveControlsTopOffset }]}
      >
        <View style={styles.immersiveControlsRow}>
          <Pressable
            style={[styles.controlButton, styles.leaveButton]}
            onPress={isHostSession ? onEndForAll : () => onLeave("leave")}
          >
            <Text style={styles.leaveText}>{isHostSession ? ui.endForAll : ui.leaveCall}</Text>
          </Pressable>
        </View>
      </View>
    ) : null;

  const toggleMicrophone = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (err) {
      setTranslationError(
        err instanceof Error ? err.message : language === "fr" ? "Echec bascule micro." : "Mic toggle failed."
      );
    }
  }, [isMicrophoneEnabled, localParticipant]);

  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    try {
      if (isCameraEnabled) {
        await localParticipant.setCameraEnabled(false);
      } else {
        lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
        await localParticipant.setCameraEnabled(true, desiredCameraCaptureOptions);
      }
    } catch (err) {
      setTranslationError(
        err instanceof Error
          ? err.message
          : language === "fr"
            ? "Echec bascule camera."
            : "Camera toggle failed."
      );
    }
  }, [desiredCameraCaptureOptions, isCameraEnabled, localParticipant, videoCaptureProfile]);

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
      const nextCaptureOptions = {
        facingMode: nextFacingMode,
        resolution:
          videoCaptureProfile === "low"
            ? IOS_VISIO_LOW_SIGNAL_VIDEO_RESOLUTION
            : IOS_VISIO_BALANCED_VIDEO_RESOLUTION,
      };
      if (videoTrack) {
        lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
        await videoTrack.restartTrack(nextCaptureOptions);
      } else {
        lastAppliedVideoCaptureProfileRef.current = videoCaptureProfile;
        await localParticipant.setCameraEnabled(true, nextCaptureOptions);
      }
    } catch (err) {
      setTranslationError(
        err instanceof Error
          ? err.message
          : language === "fr"
            ? "Echec changement d'objectif."
            : "Camera lens switch failed."
      );
    }
  }, [cameraFacingMode, isCameraEnabled, localParticipant, videoCaptureProfile]);

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
    applyVirtualBackgroundEffectRef.current = applyVirtualBackgroundEffect;
    return () => {
      applyVirtualBackgroundEffectRef.current = null;
    };
  }, [applyVirtualBackgroundEffect]);

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
      ? ui.stable
      : connectionPhase === "reconnecting"
        ? ui.reconnecting
        : ui.signal;
  const qualityLabel = localConnectionQuality.toUpperCase();
  const focusModeLabel = pinnedTrackKey
    ? ui.pinned
    : followActiveSpeaker
      ? ui.autoSpeaker
      : ui.manual;
  const useLegacyCompactVideoLayout = false;
  const useManualDraftFullscreen = Platform.OS === "ios";
  const renderManualDraftFullscreenModal = () =>
    useManualDraftFullscreen ? (
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
            <Text style={styles.manualDraftSheetTitle}>{ui.correctBeforeSendTitle}</Text>
            <View style={styles.manualDraftSheetActions}>
              {keyboardVisible ? (
                <Pressable style={styles.manualDraftSheetActionGhost} onPress={dismissKeyboard}>
                  <Text style={styles.manualDraftSheetActionGhostText}>{ui.keyboard}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.manualDraftSheetActionGhost, manualDraftSending && styles.controlButtonDisabled]}
                onPress={cancelManualDraft}
                disabled={manualDraftSending}
              >
                <Text style={styles.manualDraftSheetActionGhostText}>{ui.cancel}</Text>
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
                  <Text style={styles.manualDraftSheetActionPrimaryText}>{ui.send}</Text>
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.manualDraftSheetBody}>
            <Text style={styles.realtimeStatus}>
              {ui.reviewTextThenSend}
            </Text>
            <TextInput
              style={[styles.aiPromptInput, styles.manualDraftSheetInput]}
              value={manualDraftText}
              onChangeText={setManualDraftText}
              editable={!manualDraftSending}
              multiline
              textAlignVertical="top"
              autoFocus
              placeholder={ui.correctTextPlaceholder}
              placeholderTextColor="#64748b"
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={dismissKeyboard}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    ) : null;
  const visibleSourceSubtitleText = sourceText.trim();
  const visibleTargetSubtitleText = captionText.trim();
  const translatedVoiceEnabled = VOICE_TRANSLATION_ENABLED && ttsEnabled;
  const shouldShowSourceSubtitle =
    subtitleDisplayMode === "dual" && visibleSourceSubtitleText.length > 0;
  const shouldShowTargetSubtitle = visibleTargetSubtitleText.length > 0;
  const hasVisibleSubtitle = shouldShowSourceSubtitle || shouldShowTargetSubtitle;
  const expandedSubtitleText =
    expandedSubtitleKind === "source"
      ? visibleSourceSubtitleText
      : expandedSubtitleKind === "target"
        ? visibleTargetSubtitleText
        : "";
  const expandedSubtitleTitle =
    expandedSubtitleKind === "source" ? ui.source : ui.translation;
  const expandedSubtitleLanguageLabel =
    expandedSubtitleKind === "source" ? sourceLanguageLabel : targetLanguageLabel;
  const expandedSubtitleIsRtl =
    expandedSubtitleKind === "source" ? sourceLanguageIsRtl : targetLanguageIsRtl;
  const openExpandedSubtitle = useCallback(
    (kind: Exclude<ExpandedSubtitleKind, null>) => {
      if (kind === "source" && !visibleSourceSubtitleText) return;
      if (kind === "target" && !visibleTargetSubtitleText) return;
      setExpandedSubtitleKind(kind);
    },
    [visibleSourceSubtitleText, visibleTargetSubtitleText]
  );
  const closeExpandedSubtitle = useCallback(() => {
    setExpandedSubtitleKind(null);
  }, []);
  useEffect(() => {
    if (!expandedSubtitleKind) return;
    if (!expandedSubtitleText) {
      setExpandedSubtitleKind(null);
    }
  }, [expandedSubtitleKind, expandedSubtitleText]);
  const renderExpandedSubtitleModal = () =>
    expandedSubtitleKind ? (
      <Modal
        transparent
        visible
        animationType="fade"
        onRequestClose={closeExpandedSubtitle}
      >
        <View style={styles.subtitleSheetRoot}>
          <Pressable style={styles.subtitleSheetBackdrop} onPress={closeExpandedSubtitle} />
          <View style={styles.subtitleSheetCard}>
            <View style={styles.subtitleSheetHeader}>
              <View style={styles.subtitleSheetHeaderText}>
                <Text style={styles.subtitleSheetTitle}>{expandedSubtitleTitle}</Text>
                <Text style={styles.subtitleSheetMeta}>{expandedSubtitleLanguageLabel}</Text>
              </View>
              <Pressable style={styles.subtitleSheetCloseButton} onPress={closeExpandedSubtitle}>
                <Text style={styles.subtitleSheetCloseButtonText}>{ui.close}</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.subtitleSheetBody}
              contentContainerStyle={styles.subtitleSheetBodyContent}
              showsVerticalScrollIndicator
            >
              <Text
                style={[
                  expandedSubtitleKind === "source"
                    ? styles.subtitleSheetSourceText
                    : styles.subtitleSheetTargetText,
                  expandedSubtitleIsRtl && styles.rtlText,
                ]}
              >
                {expandedSubtitleText}
              </Text>
              {expandedSubtitleKind === "target" && captionPhoneticText ? (
                <Text style={styles.captionPhoneticLine}>{ui.phonetic(captionPhoneticText)}</Text>
              ) : null}
            </ScrollView>
            {expandedSubtitleKind === "target" ? (
              <View style={styles.subtitleSheetActions}>
                  <Pressable
                    style={[
                      styles.controlButton,
                      styles.controlButtonSecondary,
                      replayButtonActive && styles.controlButtonActive,
                      (!translatedVoiceEnabled ||
                        translationBusy ||
                        !visibleTargetSubtitleText) &&
                        styles.controlButtonDisabled,
                    ]}
                    onPress={replayCaption}
                    disabled={!translatedVoiceEnabled || translationBusy || !visibleTargetSubtitleText}
                  >
                  <View style={styles.controlButtonContent}>
                    <View style={styles.controlButtonSpinnerSlot}>
                      {replayButtonActive ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : null}
                    </View>
                    <Text style={styles.controlButtonText}>
                      {replayButtonActive ? ui.replayBusy : ui.replay}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    ) : null;
  const renderTalkieControl = () => (
    <>
      <View
        style={[
          styles.talkieStatusBanner,
          talkieStatusTone === "idle" && styles.talkieStatusBannerIdle,
          talkieStatusTone === "active" && styles.talkieStatusBannerActive,
          talkieStatusTone === "busy" && styles.talkieStatusBannerBusy,
          talkieStatusTone === "review" && styles.talkieStatusBannerReview,
          talkieStatusTone === "warning" && styles.talkieStatusBannerWarning,
        ]}
      >
        <Text style={styles.talkieStatusText}>{talkieStatusLabel}</Text>
      </View>

      <View style={[styles.row, styles.talkieRowCentered]}>
        <Animated.View
          style={talkiePulseEnabled ? { opacity: talkiePulseOpacityRef.current } : undefined}
        >
          {!(talkieUiState === "stopping" ||
          talkieUiState === "review" ||
          translationBusy ||
          manualDraftVisible ||
          manualDraftSending ||
          translationControlsDisabled ||
          isTalkieLockedByOther) ? (
            <Pressable
              style={({ pressed }) => [
                styles.talkieButton,
                isTabletLayout && styles.talkieButtonTablet,
                isCompactPhone && styles.talkieButtonCompact,
                talkieUiState === "starting" && styles.talkieButtonStarting,
                talkieLooksRecording && styles.talkieButtonRecording,
                pressed &&
                  !talkieBusyVisual &&
                  talkieUiState === "idle" &&
                  styles.talkieButtonPressed,
              ]}
              onPressIn={handleManualPushToTalkPressIn}
              onPressOut={handleManualPushToTalkPressOut}
            >
              <View style={styles.talkieButtonContent}>
                <Text style={styles.talkieButtonText}>{talkieButtonLabel}</Text>
              </View>
            </Pressable>
          ) : (
            <View
              style={[
                styles.talkieButton,
                styles.talkieButtonPassive,
                isTabletLayout && styles.talkieButtonTablet,
                isCompactPhone && styles.talkieButtonCompact,
                (talkieUiState === "starting" ||
                  talkieUiState === "review" ||
                  talkieUiState === "stopping" ||
                  translationBusy ||
                  manualDraftVisible ||
                  manualDraftSending) &&
                  styles.talkieButtonBusy,
                (translationControlsDisabled || isTalkieLockedByOther) && styles.talkieButtonLocked,
              ]}
            >
              <View style={styles.talkieButtonContent}>
                {(talkieUiState === "starting" ||
                  talkieUiState === "review" ||
                  talkieUiState === "stopping" ||
                  translationBusy ||
                  manualDraftSending) && <ActivityIndicator size="small" color="#ffffff" />}
                <Text style={styles.talkieButtonText}>{talkieButtonLabel}</Text>
              </View>
            </View>
          )}
        </Animated.View>
      </View>

      {recordingActive ? (
        <View style={[styles.row, styles.talkieRowCentered]}>
          <Pressable style={styles.controlButton} onPress={cancelRecording}>
            <Text style={styles.controlButtonText}>{ui.cancel}</Text>
          </Pressable>
        </View>
      ) : null}

    </>
  );
  const renderSubtitleContent = (lineClamp: { source: number; target: number }) => (
    <View style={[styles.subtitleStack, isTabletLayout && styles.subtitleStackTablet]}>
      {shouldShowSourceSubtitle ? (
        <Pressable
          style={({ pressed }) => [
            styles.subtitleSourceBubble,
            pressed && styles.subtitleBubblePressed,
          ]}
          onPress={() => openExpandedSubtitle("source")}
        >
          <Text style={styles.subtitleLabel}>{ui.source} ({sourceLanguageLabel})</Text>
          <Text
            numberOfLines={lineClamp.source}
            ellipsizeMode="tail"
            style={[styles.subtitleSourceText, sourceLanguageIsRtl && styles.rtlText]}
          >
            {visibleSourceSubtitleText}
          </Text>
        </Pressable>
      ) : null}
      {shouldShowTargetSubtitle ? (
        <Pressable
          style={({ pressed }) => [
            styles.subtitleTargetBubble,
            pressed && styles.subtitleBubblePressed,
          ]}
          onPress={() => openExpandedSubtitle("target")}
        >
          <View style={styles.subtitleMetaRow}>
            <Text style={styles.subtitleLabel}>{ui.translation} ({targetLanguageLabel})</Text>
            <View style={styles.subtitleMetaActions}>
              {!translatedVoiceEnabled ? (
                <View style={styles.subtitleMutedBadge}>
                  <Text style={styles.subtitleMutedBadgeText}>{ui.translatedVoiceMutedBadge}</Text>
                </View>
              ) : null}
              <Text style={styles.subtitleActionText}>{ui.viewFullTranslation}</Text>
            </View>
          </View>
          <Text
            numberOfLines={lineClamp.target}
            ellipsizeMode="tail"
            style={[styles.subtitleTargetText, targetLanguageIsRtl && styles.rtlText]}
          >
            {visibleTargetSubtitleText}
          </Text>
        </Pressable>
      ) : null}
      {hasVisibleSubtitle ? (
        <Text style={styles.subtitleHintText}>{ui.tapSubtitleToExpand}</Text>
      ) : null}
    </View>
  );
  const renderInCallTopUpCta = () =>
    shouldShowInCallTopUp ? (
      <View style={styles.row}>
        <Text style={styles.translationLockNotice}>{ui.topUpFromDashboard}</Text>
      </View>
    ) : null;
  const renderLanguageSettings = (prefix: string) => (
    <>
      <View style={styles.controlSettingGroup}>
        <View style={styles.languageSettingsHeader}>
          <Text style={styles.langSelectorLabel}>{languagePairSummary}</Text>
          <Pressable
            onPress={swapLanguages}
            style={({ pressed }) => [
              styles.languageSwapButton,
              pressed && styles.languageSwapButtonPressed,
            ]}
          >
            <Text style={styles.languageSwapButtonText}>{ui.swap}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.controlSettingGroup}>
        <Text style={styles.langSelectorLabel}>{ui.languageYouSpeak}: {sourceLanguageLabel}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.langScroller}
          contentContainerStyle={styles.langScrollerContent}
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <Pressable
              key={`${prefix}-src-${lang.code}`}
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
      </View>

      <View style={styles.controlSettingGroup}>
        <Text style={styles.langSelectorLabel}>{ui.receptionLanguage}: {targetLanguageLabel}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.langScroller}
          contentContainerStyle={styles.langScrollerContent}
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <Pressable
              key={`${prefix}-dst-${lang.code}`}
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
      </View>
    </>
  );

  if (isAudioOnlyCall) {
    return (
      <View style={styles.roomRoot}>
        {renderRoomAlert()}
        <View style={[styles.audioCallStage, isTabletLayout && styles.audioCallStageTablet]}>
          <View style={[styles.audioCallCard, isTabletLayout && styles.audioCallCardTablet]}>
            <Text style={styles.audioCallTitle}>{ui.audioCallTitle}</Text>
            <Text style={styles.audioCallSubtitle}>
              {connected ? ui.connected : ui.connecting} · Q:{qualityLabel}
            </Text>
            <Text style={styles.audioCallSubtitle}>{ui.participants(remoteParticipantCount)}</Text>
            <Text style={styles.audioCallHint}>
              {remoteParticipantCount
                ? ui.audioChannelActive
                : ui.waitingParticipant}
            </Text>
          </View>

          <View style={styles.audioCallControls}>
            <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
              <Text style={styles.controlButtonText}>
                {isMicrophoneEnabled ? ui.micOn : ui.micOff}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (useLegacyCompactVideoLayout) {
    const focusedKey = focusedTrack ? trackKey(focusedTrack) : "";
    const showPreview =
      Boolean(previewTrack) &&
      (!focusedTrack || trackKey(previewTrack!) !== focusedKey);

    return (
      <View style={styles.roomRoot}>
        {renderRoomAlert()}
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
            </Pressable>
          ) : (
            <View style={styles.videoPlaceholder}>
              <Text style={styles.placeholderText}>{ui.noCameraTrack}</Text>
            </View>
          )}

          {showPreview && previewTrack ? (
            <Pressable
              style={styles.chatVideoPreview}
              onPress={() => focusTrackManually(previewTrack)}
            >
              <VideoTrack
                trackRef={previewTrack}
                style={styles.chatVideoPreviewTrack}
                mirror={previewTrack.participant.isLocal}
              />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          style={styles.chatVideoBottomScroll}
          contentContainerStyle={styles.chatVideoBottomScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {topStatusBadgeLabel ? (
            <View style={styles.chatVideoStatusRow}>
              <View
                style={[
                  styles.connectionMetaChip,
                  !effectiveTranslationEnabled && styles.connectionMetaChipWarning,
                ]}
              >
                <Text style={styles.connectionMetaChipText}>{topStatusBadgeLabel}</Text>
              </View>
            </View>
          ) : null}

          <View style={[styles.audioCallControls, styles.audioCallControlsWrap]}>
            <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
              <Text style={styles.controlButtonText}>{isMicrophoneEnabled ? ui.micOn : ui.micOff}</Text>
            </Pressable>
            <Pressable style={styles.controlButton} onPress={toggleCamera}>
              <Text style={styles.controlButtonText}>{isCameraEnabled ? ui.cameraOn : ui.cameraOff}</Text>
            </Pressable>
            <Pressable style={styles.controlButton} onPress={toggleCameraFacing}>
              <Text style={styles.controlButtonText}>
                {cameraFacingMode === "user" ? ui.frontCamera : ui.backCamera}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.controlButton, styles.realtimeButton]}
              onPress={() => setTranslationPanelOpen((current) => !current)}
            >
              <Text style={styles.controlButtonText}>
                {translationPanelOpen ? ui.translationMenuHide : ui.translationMenuShow}
              </Text>
            </Pressable>
          </View>

          {translationPanelOpen ? (
            <View style={styles.chatVideoTranslationCard}>
            {renderLanguageSettings("chat")}
            {translationRemainingLabel ? (
              <Text style={styles.realtimeStatus}>
                {ui.hostTranslationRemaining(translationRemainingLabel)}
              </Text>
            ) : null}
            {!effectiveTranslationEnabled ? (
              <Text style={styles.translationLockNotice}>
                {effectiveTranslationLockMessage || ui.translationWaitHostHint}
              </Text>
            ) : null}
            {renderInCallTopUpCta()}

            {renderTalkieControl()}
            </View>
          ) : null}
        </ScrollView>

        {renderExpandedSubtitleModal()}
        {renderManualDraftFullscreenModal()}
      </View>
    );
  }

  return (
    <View style={styles.roomRoot}>
      {renderRoomAlert()}
      {!immersiveMode ? (
        <View
          style={[
            styles.connectionBadge,
            videoFullscreen && !useTabletSplitLayout && styles.connectionBadgeFloating,
            isTabletLayout && styles.connectionBadgeTablet,
          ]}
        >
          <View style={styles.connectionRow}>
            <View style={styles.connectionBadgeSummary}>
              {topStatusBadgeLabel ? (
                <View
                  style={[
                    styles.connectionMetaChip,
                    !effectiveTranslationEnabled && styles.connectionMetaChipWarning,
                  ]}
                >
                  <Text style={styles.connectionMetaChipText}>{topStatusBadgeLabel}</Text>
                </View>
              ) : null}
              {!connected ? (
                <View style={[styles.connectionMetaChip, styles.connectionMetaChipWarning]}>
                  <Text style={styles.connectionMetaChipText}>{ui.connecting}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {exceedsRecommendedParticipantCount ? (
            <View style={styles.connectionWarningBox}>
              <Text style={styles.connectionWarningText}>
                {ui.groupSizeWarning(totalParticipantCount)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {useTabletSplitLayout ? (
        <View style={styles.roomSplitLayout}>
          <View style={styles.roomSplitStageColumn}>
            <View
              style={[
                styles.videoStage,
                videoFullscreen && styles.videoStageFullscreen,
                immersiveMode && styles.videoStageImmersive,
                isVeryCompactPhone && styles.videoStageCompact,
              ]}
            >
              {renderImmersiveControls()}
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
                <View
                  style={[styles.focusedVideoCard, immersiveMode && styles.focusedVideoCardImmersive]}
                  onLayout={({ nativeEvent }) => {
                    const { width, height } = nativeEvent.layout;
                    handleFocusedVideoLayout(width, height);
                  }}
                >
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
                  </Pressable>

                  {previewTrack && !immersiveMode ? (
                    <Animated.View
                      style={[
                        styles.localPreviewCard,
                        !previewPositionReady && styles.localPreviewCardDefaultPosition,
                        previewPositionReady && {
                          left: previewPosition.x,
                          top: previewPosition.y,
                        },
                        {
                          width: previewCardSize.width,
                          height: previewCardSize.height,
                        },
                      ]}
                      {...(previewPanResponder ? previewPanResponder.panHandlers : {})}
                    >
                      <Pressable
                        style={[
                          styles.localPreviewPressable,
                          activeSpeakerIdentity === previewTrack.participant.identity &&
                            styles.trackCardActiveSpeaker,
                          pinnedTrackKey === trackKey(previewTrack) && styles.trackCardPinned,
                        ]}
                        onPress={() => handlePreviewTap(previewTrack)}
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
                      </Pressable>
                    </Animated.View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.videoPlaceholder}>
                  <Text style={styles.placeholderText}>{ui.noCameraTrack}</Text>
                </View>
              )}

              {hasVisibleSubtitle && (
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.subtitleOverlay,
                    videoFullscreen && !immersiveMode && styles.subtitleOverlayFullscreen,
                    immersiveMode && styles.subtitleOverlayImmersive,
                    immersiveMode && { top: immersiveSubtitleTopOffset },
                  ]}
                >
                  {renderSubtitleContent({
                    source: immersiveMode ? 3 : 2,
                    target: immersiveMode ? 4 : 3,
                  })}
                </View>
              )}

              <View
                pointerEvents="box-none"
                style={[
                  styles.talkieOverlay,
                  styles.talkieOverlayTablet,
                  isCompactPhone && styles.talkieOverlayCompact,
                  immersiveMode && styles.talkieOverlayImmersive,
                ]}
              >
                {renderTalkieControl()}
              </View>
            </View>
          </View>

          {!immersiveMode ? (
            <View style={[styles.roomSplitPanelColumn, { width: tabletPanelWidth }]}>
              <View style={[styles.panelDock, styles.panelDockTablet]}>
      {switchTracks.length ? (
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
                onPress={() => focusTrackManually(item)}
                onLongPress={() =>
                  setPinnedTrackKey((current) => (current === key ? null : key))
                }
              >
                <VideoTrack
                  trackRef={item}
                  style={styles.quickThumbTrack}
                  mirror={item.participant.isLocal}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {shouldShowAccordionPanel("controls") ? (
      <View style={styles.accordionCard}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => toggleAccordionPanel("controls")}
        >
          <View style={styles.accordionHeaderText}>
            <Text style={styles.accordionTitle}>{ui.controls}</Text>
            <Text style={styles.accordionMeta}>
              {`${isMicrophoneEnabled ? ui.micOn : ui.micOff} · ${isCameraEnabled ? ui.cameraOn : ui.cameraOff} · ${
                cameraFacingMode === "user" ? ui.frontCamera : ui.backCamera
              } · ${languagePairSummary}`}
            </Text>
          </View>
          <Text style={styles.accordionIcon}>{controlsOpen ? "−" : "+"}</Text>
        </Pressable>

        {controlsOpen ? (
          <View style={styles.controls}>
            <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
              <Text style={styles.controlButtonText}>{isMicrophoneEnabled ? ui.micOn : ui.micOff}</Text>
            </Pressable>
            <Pressable style={styles.controlButton} onPress={toggleCamera}>
              <Text style={styles.controlButtonText}>{isCameraEnabled ? ui.cameraOn : ui.cameraOff}</Text>
            </Pressable>
            <Pressable style={styles.controlButton} onPress={toggleCameraFacing}>
              <Text style={styles.controlButtonText}>
                {cameraFacingMode === "user" ? ui.frontCamera : ui.backCamera}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.controlButton, followActiveSpeaker && styles.realtimeButton]}
              onPress={() => setFollowActiveSpeaker((value) => !value)}
            >
              <Text style={styles.controlButtonText}>{ui.autoSpeakerToggle(followActiveSpeaker)}</Text>
            </Pressable>
            {focusedTrack ? (
              <Pressable
                style={[styles.controlButton, pinnedTrackKey && styles.realtimeButton]}
                onPress={() => {
                  const key = trackKey(focusedTrack);
                  setPinnedTrackKey((current) => (current === key ? null : key));
                }}
              >
                <Text style={styles.controlButtonText}>
                  {pinnedTrackKey === trackKey(focusedTrack) ? ui.unpinFocus : ui.pinFocus}
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.controlSettingGroup}>
              <Text style={styles.langSelectorLabel}>{ui.subtitleLayout}</Text>
              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.toggleChip,
                    subtitleDisplayMode === "dual" && styles.toggleChipActive,
                  ]}
                  onPress={() => setSubtitleDisplayMode("dual")}
                >
                  <Text
                    style={[
                      styles.toggleChipText,
                      subtitleDisplayMode === "dual" && styles.toggleChipTextActive,
                    ]}
                  >
                    {ui.subtitleLayoutDual}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.toggleChip,
                    subtitleDisplayMode === "translationOnly" && styles.toggleChipActive,
                  ]}
                  onPress={() => setSubtitleDisplayMode("translationOnly")}
                >
                  <Text
                    style={[
                      styles.toggleChipText,
                      subtitleDisplayMode === "translationOnly" &&
                        styles.toggleChipTextActive,
                    ]}
                  >
                    {ui.subtitleLayoutTranslationOnly}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.controlSettingGroup}>
              <Text style={styles.langSelectorLabel}>{ui.translatedVoiceSetting}</Text>
              <View style={styles.row}>
                <Pressable
                  style={[styles.toggleChip, translatedVoiceEnabled && styles.toggleChipActive]}
                  onPress={() => setTtsEnabled(true)}
                >
                  <Text
                    style={[
                      styles.toggleChipText,
                      translatedVoiceEnabled && styles.toggleChipTextActive,
                    ]}
                  >
                    {ui.translatedVoiceOn}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleChip, !translatedVoiceEnabled && styles.toggleChipActive]}
                  onPress={() => setTtsEnabled(false)}
                >
                  <Text
                    style={[
                      styles.toggleChipText,
                      !translatedVoiceEnabled && styles.toggleChipTextActive,
                    ]}
                  >
                    {ui.translatedVoiceOff}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.controlSettingGroup}>
              <Text style={styles.langSelectorLabel}>{ui.fullTranslationSetting}</Text>
              <Pressable
                style={[
                  styles.controlButton,
                  styles.controlButtonSecondary,
                  !visibleTargetSubtitleText && styles.controlButtonDisabled,
                ]}
                onPress={() => openExpandedSubtitle("target")}
                disabled={!visibleTargetSubtitleText}
              >
                <Text style={styles.controlButtonText}>{ui.viewFullTranslation}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
      ) : null}

      {shouldShowAccordionPanel("translation") ? (
      <View style={styles.accordionCard}>
          <Pressable
            style={styles.accordionHeader}
            onPress={() => toggleAccordionPanel("translation")}
          >
            <View style={styles.accordionHeaderText}>
              <Text style={styles.accordionTitle}>{ui.translation}</Text>
              {topStatusBadgeLabel ? (
                <Text style={styles.accordionMeta}>
                  {topStatusBadgeLabel}
                </Text>
              ) : null}
            </View>
            <Text style={styles.accordionIcon}>{translationPanelOpen ? "−" : "+"}</Text>
          </Pressable>

        {translationPanelOpen ? (
          <ScrollView
            style={[styles.translationPanelScroll, styles.translationPanelScrollTablet]}
            contentContainerStyle={styles.translationPanel}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {renderLanguageSettings("translation")}

            {isHostSession ? (
              <>
                {translationEntitlement.loading ? (
                  <Text style={styles.realtimeStatus}>{ui.checkingCredits}</Text>
                ) : null}
                {translationRemainingLabel ? (
                  <Text style={styles.realtimeStatus}>
                    {ui.hostTranslationRemaining(translationRemainingLabel)}
                  </Text>
                ) : null}
                {!effectiveTranslationEnabled ? (
                  <Text style={styles.translationLockNotice}>
                    {effectiveTranslationLockMessage || ui.translationUnlockHint}
                  </Text>
                ) : null}
                {renderInCallTopUpCta()}

              </>
            ) : (
              <>
                {translationRemainingLabel ? (
                  <Text style={styles.realtimeStatus}>
                    {ui.hostTranslationRemaining(translationRemainingLabel)}
                  </Text>
                ) : null}
                {!effectiveTranslationEnabled ? (
                  <Text style={styles.translationLockNotice}>
                    {effectiveTranslationLockMessage || ui.translationWaitHostHint}
                  </Text>
                ) : null}
                {renderInCallTopUpCta()}
              </>
            )}

            {targetVoiceLikelyUnavailable ? (
              <Text style={styles.realtimeStatus}>
                {ui.translatedVoiceUnavailable(targetLanguageLabel)}
              </Text>
            ) : null}

            {manualDraftVisible && !useManualDraftFullscreen ? (
              <View style={styles.manualDraftCard}>
                <Text style={styles.realtimeStatus}>{ui.verifyTextBeforeSend}</Text>
                <TextInput
                  style={[styles.aiPromptInput, styles.manualDraftInput]}
                  value={manualDraftText}
                  onChangeText={setManualDraftText}
                  editable={!manualDraftSending}
                  multiline
                  textAlignVertical="top"
                  placeholder={ui.correctTextPlaceholder}
                  placeholderTextColor="#64748b"
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={dismissKeyboard}
                />
                <View style={styles.row}>
                  {keyboardVisible ? (
                    <Pressable style={styles.controlButton} onPress={dismissKeyboard}>
                      <Text style={styles.controlButtonText}>{ui.closeKeyboard}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.controlButton, manualDraftSending && styles.controlButtonDisabled]}
                    onPress={cancelManualDraft}
                    disabled={manualDraftSending}
                  >
                    <Text style={styles.controlButtonText}>{ui.cancel}</Text>
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
                      <Text style={styles.controlButtonText}>{ui.send}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}

            {sourceText ? (
              <View style={styles.infoStack}>
                <Text style={styles.realtimeStatus}>{ui.source} ({sourceLanguageLabel})</Text>
                <Text style={[styles.sourceLine, sourceLanguageIsRtl && styles.rtlText]}>{sourceText}</Text>
              </View>
            ) : null}
            {captionText ? (
              <View style={styles.infoStack}>
                <Text style={styles.realtimeStatus}>{ui.translation} ({targetLanguageLabel})</Text>
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
                          ? ui.retranslateBusy
                          : ui.retranslate}
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
                      (!translatedVoiceEnabled ||
                        translationBusy ||
                        !captionText.trim()) &&
                        styles.controlButtonDisabled,
                    ]}
                    onPress={replayCaption}
                    disabled={!translatedVoiceEnabled || translationBusy || !captionText.trim()}
                  >
                    <View style={styles.controlButtonContent}>
                      <View style={styles.controlButtonSpinnerSlot}>
                        {replayButtonActive ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : null}
                      </View>
                      <Text style={styles.controlButtonText} numberOfLines={1}>
                        {replayButtonActive ? ui.replayBusy : ui.replay}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                {captionPhoneticBusy ? (
                  <Text style={styles.captionPhoneticLine}>{ui.phoneticLoading}</Text>
                ) : captionPhoneticText ? (
                  <Text style={styles.captionPhoneticLine}>{ui.phonetic(captionPhoneticText)}</Text>
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
            </View>
          ) : null}
        </View>
      ) : (
        <>
        <View
          style={[
            styles.videoStage,
          videoFullscreen && styles.videoStageFullscreen,
          immersiveMode && styles.videoStageImmersive,
          isVeryCompactPhone && styles.videoStageCompact,
          ]}
        >
          {renderImmersiveControls()}
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
          <View
            style={[styles.focusedVideoCard, immersiveMode && styles.focusedVideoCardImmersive]}
            onLayout={({ nativeEvent }) => {
              const { width, height } = nativeEvent.layout;
              handleFocusedVideoLayout(width, height);
            }}
          >
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
            </Pressable>

            {previewTrack && !immersiveMode ? (
              <Animated.View
                style={[
                  styles.localPreviewCard,
                  !previewPositionReady && styles.localPreviewCardDefaultPosition,
                  previewPositionReady && {
                    left: previewPosition.x,
                    top: previewPosition.y,
                  },
                  {
                    width: previewCardSize.width,
                    height: previewCardSize.height,
                  },
                ]}
                {...(previewPanResponder ? previewPanResponder.panHandlers : {})}
              >
                <Pressable
                  style={[
                    styles.localPreviewPressable,
                    activeSpeakerIdentity === previewTrack.participant.identity &&
                      styles.trackCardActiveSpeaker,
                    pinnedTrackKey === trackKey(previewTrack) && styles.trackCardPinned,
                  ]}
                  onPress={() => handlePreviewTap(previewTrack)}
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
                </Pressable>
              </Animated.View>
            ) : null}
          </View>
        ) : (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.placeholderText}>{ui.noCameraTrack}</Text>
          </View>
        )}

        {hasVisibleSubtitle && (
          <View
            pointerEvents="box-none"
            style={[
              styles.subtitleOverlay,
              videoFullscreen && !immersiveMode && styles.subtitleOverlayFullscreen,
              immersiveMode && styles.subtitleOverlayImmersive,
              immersiveMode && { top: immersiveSubtitleTopOffset },
            ]}
          >
            {renderSubtitleContent({
              source: immersiveMode ? 3 : 2,
              target: immersiveMode ? 4 : 3,
            })}
          </View>
        )}

        <View
          pointerEvents="box-none"
          style={[
            styles.talkieOverlay,
            isCompactPhone && styles.talkieOverlayCompact,
            immersiveMode && styles.talkieOverlayImmersive,
          ]}
        >
          {renderTalkieControl()}
        </View>
      </View>

      {!immersiveMode ? (
        <View
          style={[
            styles.panelDock,
            videoFullscreen &&
              !keyboardVisible &&
              !manualDraftVisible &&
              styles.panelDockFloating,
            isCompactPhone && styles.panelDockCompact,
            keyboardVisible &&
              !manualDraftVisible &&
              styles.panelDockKeyboardRaised,
          ]}
        >
        {switchTracks.length ? (
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
                  onPress={() => focusTrackManually(item)}
                  onLongPress={() =>
                    setPinnedTrackKey((current) => (current === key ? null : key))
                  }
                >
                  <VideoTrack
                    trackRef={item}
                    style={styles.quickThumbTrack}
                    mirror={item.participant.isLocal}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {shouldShowAccordionPanel("controls") ? (
        <View style={styles.accordionCard}>
          <Pressable
            style={styles.accordionHeader}
            onPress={() => toggleAccordionPanel("controls")}
          >
            <View style={styles.accordionHeaderText}>
              <Text style={styles.accordionTitle}>{ui.controls}</Text>
              <Text style={styles.accordionMeta}>
                {`${isMicrophoneEnabled ? ui.micOn : ui.micOff} · ${isCameraEnabled ? ui.cameraOn : ui.cameraOff} · ${
                  cameraFacingMode === "user" ? ui.frontCamera : ui.backCamera
                } · ${languagePairSummary}`}
              </Text>
            </View>
            <Text style={styles.accordionIcon}>{controlsOpen ? "−" : "+"}</Text>
          </Pressable>

          {controlsOpen ? (
            <View style={styles.controls}>
              <Pressable style={styles.controlButton} onPress={toggleMicrophone}>
                <Text style={styles.controlButtonText}>{isMicrophoneEnabled ? ui.micOn : ui.micOff}</Text>
              </Pressable>
              <Pressable style={styles.controlButton} onPress={toggleCamera}>
                <Text style={styles.controlButtonText}>{isCameraEnabled ? ui.cameraOn : ui.cameraOff}</Text>
              </Pressable>
              <Pressable style={styles.controlButton} onPress={toggleCameraFacing}>
                <Text style={styles.controlButtonText}>
                  {cameraFacingMode === "user" ? ui.frontCamera : ui.backCamera}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.controlButton, followActiveSpeaker && styles.realtimeButton]}
                onPress={() => setFollowActiveSpeaker((value) => !value)}
              >
                <Text style={styles.controlButtonText}>{ui.autoSpeakerToggle(followActiveSpeaker)}</Text>
              </Pressable>
              {focusedTrack ? (
                <Pressable
                  style={[styles.controlButton, pinnedTrackKey && styles.realtimeButton]}
                  onPress={() => {
                    const key = trackKey(focusedTrack);
                    setPinnedTrackKey((current) => (current === key ? null : key));
                  }}
                >
                  <Text style={styles.controlButtonText}>
                    {pinnedTrackKey === trackKey(focusedTrack) ? ui.unpinFocus : ui.pinFocus}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.controlSettingGroup}>
                <Text style={styles.langSelectorLabel}>{ui.subtitleLayout}</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[
                      styles.toggleChip,
                      subtitleDisplayMode === "dual" && styles.toggleChipActive,
                    ]}
                    onPress={() => setSubtitleDisplayMode("dual")}
                  >
                    <Text
                      style={[
                        styles.toggleChipText,
                        subtitleDisplayMode === "dual" && styles.toggleChipTextActive,
                      ]}
                    >
                      {ui.subtitleLayoutDual}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.toggleChip,
                      subtitleDisplayMode === "translationOnly" && styles.toggleChipActive,
                    ]}
                    onPress={() => setSubtitleDisplayMode("translationOnly")}
                  >
                    <Text
                      style={[
                        styles.toggleChipText,
                        subtitleDisplayMode === "translationOnly" &&
                          styles.toggleChipTextActive,
                      ]}
                    >
                      {ui.subtitleLayoutTranslationOnly}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.controlSettingGroup}>
                <Text style={styles.langSelectorLabel}>{ui.translatedVoiceSetting}</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.toggleChip, translatedVoiceEnabled && styles.toggleChipActive]}
                    onPress={() => setTtsEnabled(true)}
                  >
                    <Text
                      style={[
                        styles.toggleChipText,
                        translatedVoiceEnabled && styles.toggleChipTextActive,
                      ]}
                    >
                      {ui.translatedVoiceOn}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toggleChip, !translatedVoiceEnabled && styles.toggleChipActive]}
                    onPress={() => setTtsEnabled(false)}
                  >
                    <Text
                      style={[
                        styles.toggleChipText,
                        !translatedVoiceEnabled && styles.toggleChipTextActive,
                      ]}
                    >
                      {ui.translatedVoiceOff}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.controlSettingGroup}>
                <Text style={styles.langSelectorLabel}>{ui.fullTranslationSetting}</Text>
                <Pressable
                  style={[
                    styles.controlButton,
                    styles.controlButtonSecondary,
                    !visibleTargetSubtitleText && styles.controlButtonDisabled,
                  ]}
                  onPress={() => openExpandedSubtitle("target")}
                  disabled={!visibleTargetSubtitleText}
                >
                  <Text style={styles.controlButtonText}>{ui.viewFullTranslation}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
        ) : null}

        {shouldShowAccordionPanel("translation") ? (
        <View style={styles.accordionCard}>
            <Pressable
              style={styles.accordionHeader}
              onPress={() => toggleAccordionPanel("translation")}
            >
              <View style={styles.accordionHeaderText}>
                <Text style={styles.accordionTitle}>{ui.translation}</Text>
                {topStatusBadgeLabel ? (
                  <Text style={styles.accordionMeta}>
                    {topStatusBadgeLabel}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.accordionIcon}>{translationPanelOpen ? "−" : "+"}</Text>
            </Pressable>

          {translationPanelOpen ? (
            <ScrollView
              style={styles.translationPanelScroll}
              contentContainerStyle={styles.translationPanel}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {renderLanguageSettings("translation")}

              {isHostSession ? (
                <>
                  {translationEntitlement.loading ? (
                    <Text style={styles.realtimeStatus}>{ui.checkingCredits}</Text>
                  ) : null}
                  {translationRemainingLabel ? (
                    <Text style={styles.realtimeStatus}>
                      {ui.hostTranslationRemaining(translationRemainingLabel)}
                    </Text>
                  ) : null}
                  {!effectiveTranslationEnabled ? (
                    <Text style={styles.translationLockNotice}>
                      {effectiveTranslationLockMessage || ui.translationUnlockHint}
                    </Text>
                  ) : null}
                  {renderInCallTopUpCta()}

                </>
              ) : (
                <>
                  {translationRemainingLabel ? (
                    <Text style={styles.realtimeStatus}>
                      {ui.hostTranslationRemaining(translationRemainingLabel)}
                    </Text>
                  ) : null}
                  {!effectiveTranslationEnabled ? (
                    <Text style={styles.translationLockNotice}>
                      {effectiveTranslationLockMessage || ui.translationWaitHostHint}
                    </Text>
                  ) : null}
                  {renderInCallTopUpCta()}
                </>
              )}

              {targetVoiceLikelyUnavailable ? (
                <Text style={styles.realtimeStatus}>
                  {ui.translatedVoiceUnavailable(targetLanguageLabel)}
                </Text>
              ) : null}

              {manualDraftVisible && !useManualDraftFullscreen ? (
                <View style={styles.manualDraftCard}>
                  <Text style={styles.realtimeStatus}>{ui.verifyTextBeforeSend}</Text>
                  <TextInput
                    style={[styles.aiPromptInput, styles.manualDraftInput]}
                    value={manualDraftText}
                    onChangeText={setManualDraftText}
                    editable={!manualDraftSending}
                    multiline
                    textAlignVertical="top"
                    placeholder={ui.correctTextPlaceholder}
                    placeholderTextColor="#64748b"
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={dismissKeyboard}
                  />
                  <View style={styles.row}>
                    {keyboardVisible ? (
                      <Pressable style={styles.controlButton} onPress={dismissKeyboard}>
                        <Text style={styles.controlButtonText}>{ui.closeKeyboard}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.controlButton, manualDraftSending && styles.controlButtonDisabled]}
                      onPress={cancelManualDraft}
                      disabled={manualDraftSending}
                    >
                      <Text style={styles.controlButtonText}>{ui.cancel}</Text>
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
                        <Text style={styles.controlButtonText}>{ui.send}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {sourceText ? (
                <View style={styles.infoStack}>
                  <Text style={styles.realtimeStatus}>{ui.source} ({sourceLanguageLabel})</Text>
                  <Text style={[styles.sourceLine, sourceLanguageIsRtl && styles.rtlText]}>{sourceText}</Text>
                </View>
              ) : null}
              {captionText ? (
                <View style={styles.infoStack}>
                  <Text style={styles.realtimeStatus}>{ui.translation} ({targetLanguageLabel})</Text>
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
                            ? ui.retranslateBusy
                            : ui.retranslate}
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
                        (!translatedVoiceEnabled ||
                          translationBusy ||
                          !captionText.trim()) &&
                          styles.controlButtonDisabled,
                      ]}
                      onPress={replayCaption}
                      disabled={!translatedVoiceEnabled || translationBusy || !captionText.trim()}
                    >
                      <View style={styles.controlButtonContent}>
                        <View style={styles.controlButtonSpinnerSlot}>
                          {replayButtonActive ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : null}
                        </View>
                        <Text style={styles.controlButtonText} numberOfLines={1}>
                          {replayButtonActive ? ui.replayBusy : ui.replay}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                  {captionPhoneticBusy ? (
                    <Text style={styles.captionPhoneticLine}>{ui.phoneticLoading}</Text>
                  ) : captionPhoneticText ? (
                    <Text style={styles.captionPhoneticLine}>{ui.phonetic(captionPhoneticText)}</Text>
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
        </>
      )}
      {renderExpandedSubtitleModal()}
      {renderManualDraftFullscreenModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
  },
  topBarShell: {
    width: "100%",
    borderBottomWidth: 1,
    borderColor: "#1e293b",
  },
  topBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  topBarTablet: {
    width: "100%",
    maxWidth: 920,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topIdentity: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  topIdentityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  topIdentityCompact: {
    width: "100%",
    paddingRight: 0,
  },
  topIdentityTablet: {
    flex: 1,
    minWidth: 0,
    maxWidth: 640,
    paddingRight: 16,
  },
  topMetaActions: {
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
  },
  topMetaActionsCompact: {
    width: "100%",
    gap: 6,
  },
  topMetaActionsTablet: {
    gap: 10,
    flexShrink: 0,
  },
  topLocaleRow: {
    alignSelf: "flex-end",
  },
  topLocaleRowCompact: {
    width: "100%",
    alignItems: "flex-end",
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  topActionsCompact: {
    gap: 6,
    width: "100%",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  topActionsTablet: {
    justifyContent: "flex-end",
    flexWrap: "nowrap",
    gap: 10,
    flexShrink: 0,
  },
  topBrandLogo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    flexShrink: 0,
  },
  topTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
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
  topActionButtonTablet: {
    minWidth: 148,
    alignItems: "center",
    justifyContent: "center",
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
  leaveButtonDisabled: {
    opacity: 0.55,
  },
  leaveText: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "700",
  },
  roomRoot: {
    flex: 1,
  },
  roomAlertBanner: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    zIndex: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "rgba(120,53,15,0.9)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roomAlertBannerImmersive: {
    top: 20,
  },
  roomAlertText: {
    color: "#fff7ed",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  audioCallStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    gap: 14,
  },
  audioCallStageTablet: {
    paddingHorizontal: 32,
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
  audioCallCardTablet: {
    maxWidth: 720,
    paddingHorizontal: 24,
    paddingVertical: 24,
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
  audioCallControlsWrap: {
    flexWrap: "wrap",
    paddingHorizontal: 10,
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
  chatVideoBottomScroll: {
    maxHeight: "48%",
  },
  chatVideoBottomScrollContent: {
    paddingBottom: 10,
    gap: 6,
  },
  chatVideoTranslationCard: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 14,
    backgroundColor: "rgba(2,6,23,0.88)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  connectionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 30,
  },
  connectionBadgeTablet: {
    width: "100%",
    maxWidth: 1220,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
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
  connectionBadgeSummary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  connectionWarningBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "rgba(120,53,15,0.28)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  connectionWarningText: {
    color: "#fde68a",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  connectionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  connectionText: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  connectionMetaChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1d4ed8",
    backgroundColor: "rgba(30,64,175,0.22)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  connectionMetaChipWarning: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(146,64,14,0.28)",
  },
  connectionMetaChipText: {
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: "800",
  },
  connectionMetaChipAction: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  connectionMetaChipActionPrimary: {
    borderColor: "#38bdf8",
    backgroundColor: "#0c4a6e",
  },
  connectionMetaChipActionText: {
    color: "#e0f2fe",
    fontSize: 11,
    fontWeight: "800",
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
    left: 16,
    right: 16,
    top: 14,
    alignItems: "center",
    gap: 6,
    zIndex: 16,
  },
  subtitleOverlayFullscreen: {
    top: 72,
  },
  subtitleOverlayImmersive: {
    left: 10,
    right: 10,
    top: 18,
  },
  subtitleStack: {
    width: "100%",
    maxWidth: 280,
    gap: 6,
  },
  subtitleStackTablet: {
    maxWidth: 520,
  },
  subtitleSpeakerBadge: {
    alignSelf: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "rgba(8,47,73,0.9)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subtitleSpeakerBadgeText: {
    color: "#e0f2fe",
    fontSize: 11,
    fontWeight: "800",
  },
  subtitleSourceBubble: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "rgba(2,6,23,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  subtitleTargetBubble: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "rgba(12,74,110,0.76)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  subtitleBubblePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.995 }],
  },
  subtitleLabel: {
    color: "#bfdbfe",
    fontSize: 10,
    fontWeight: "700",
  },
  subtitleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  subtitleMetaActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  subtitleActionText: {
    color: "#e0f2fe",
    fontSize: 10,
    fontWeight: "800",
  },
  subtitleMutedBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "rgba(120,53,15,0.88)",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  subtitleMutedBadgeText: {
    color: "#fde68a",
    fontSize: 9,
    fontWeight: "800",
  },
  subtitleHintText: {
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
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
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#020617",
  },
  localPreviewCardDefaultPosition: {
    right: IOS_PREVIEW_CARD_MARGIN,
    top: IOS_PREVIEW_CARD_MARGIN,
  },
  localPreviewPressable: {
    flex: 1,
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
  panelDockTablet: {
    flex: 1,
    gap: 10,
    paddingHorizontal: 0,
    paddingBottom: 0,
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
  controlSettingGroup: {
    width: "100%",
    gap: 6,
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
  talkieButtonTablet: {
    minWidth: 0,
    width: "100%",
    maxWidth: 420,
    minHeight: 54,
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
    backgroundColor: "#1d4ed8",
    borderColor: "#93c5fd",
  },
  talkieButtonRecording: {
    backgroundColor: "#15803d",
    borderColor: "#86efac",
  },
  talkieButtonBusy: {
    backgroundColor: "#1e40af",
    borderColor: "#93c5fd",
  },
  talkieButtonPassive: {
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  talkieButtonLocked: {
    backgroundColor: "#1e293b",
    borderColor: "#64748b",
  },
  talkieOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    zIndex: 18,
  },
  talkieOverlayTablet: {
    alignItems: "center",
  },
  talkieOverlayCompact: {
    left: 12,
    right: 12,
    bottom: 14,
  },
  talkieOverlayImmersive: {
    bottom: 28,
  },
  immersiveControlsRoot: {
    position: "absolute",
    top: 18,
    left: 12,
    right: 12,
    zIndex: 22,
  },
  immersiveControlsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  immersiveControlButton: {
    flexGrow: 1,
    flexBasis: 0,
  },
  talkieStatusBanner: {
    alignSelf: "center",
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%",
  },
  talkieStatusBannerIdle: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
  },
  talkieStatusBannerActive: {
    backgroundColor: "#052e16",
    borderColor: "#22c55e",
  },
  talkieStatusBannerBusy: {
    backgroundColor: "#172554",
    borderColor: "#60a5fa",
  },
  talkieStatusBannerReview: {
    backgroundColor: "#3b0764",
    borderColor: "#d8b4fe",
  },
  talkieStatusBannerWarning: {
    backgroundColor: "#3f3f46",
    borderColor: "#a1a1aa",
  },
  talkieStatusText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.2,
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
  translationPanelScrollTablet: {
    maxHeight: 560,
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
  talkieRowCentered: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  rowSplit: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  roomSplitLayout: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  roomSplitStageColumn: {
    flex: 1,
    minWidth: 0,
  },
  roomSplitPanelColumn: {
    alignSelf: "stretch",
    minWidth: 0,
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
  languageSettingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  languageSwapButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  languageSwapButtonPressed: {
    backgroundColor: "#0c4a6e",
    borderColor: "#67e8f9",
  },
  languageSwapButtonText: {
    color: "#e0f2fe",
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
  toggleChipActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  toggleChipText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
  },
  toggleChipTextActive: {
    color: "#e0f2fe",
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
  warningText: {
    color: "#fde68a",
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
  subtitleSheetRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "rgba(2,6,23,0.66)",
  },
  subtitleSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  subtitleSheetCard: {
    maxHeight: "72%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#020617",
    overflow: "hidden",
  },
  subtitleSheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: "#1e293b",
  },
  subtitleSheetHeaderText: {
    flex: 1,
    gap: 4,
  },
  subtitleSheetTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800",
  },
  subtitleSheetMeta: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "600",
  },
  subtitleSheetCloseButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  subtitleSheetCloseButtonText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  subtitleSheetBody: {
    maxHeight: 320,
  },
  subtitleSheetBodyContent: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  subtitleSheetSourceText: {
    color: "#e2e8f0",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  },
  subtitleSheetTargetText: {
    color: "#f8fafc",
    fontSize: 17,
    lineHeight: 26,
    fontWeight: "700",
  },
  subtitleSheetActions: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
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
