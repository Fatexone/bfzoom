"use client";

/* eslint-disable react/no-unescaped-entities */

import {
  ChangeEvent,
  Dispatch,
  MouseEvent,
  RefObject,
  SetStateAction,
  TouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { auth } from "@/lib/firebaseConfig";
import { getIdToken, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { motion } from "framer-motion";
import {
  CarouselLayout,
  ConnectionStateToast,
  ChatToggle,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  PreJoin,
  RoomAudioRenderer,
  TrackToggle,
  useCreateLayoutContext,
  useDataChannel,
  useEnsureTrackRef,
  useLocalParticipant,
  useParticipants,
  usePinnedTracks,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import type { LocalUserChoices, TrackReferenceOrPlaceholder } from "@livekit/components-core";
import {
  isEqualTrackRef,
  isTrackReference,
  isTrackReferencePinned,
} from "@livekit/components-core";
import type { LocalParticipant, Participant } from "livekit-client";
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import {
  Info,
  Share2,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  SwitchCamera,
  ScreenShare,
  MessageCircle,
  Settings,
  Power,
  LogOut,
  Volume2,
  MoreHorizontal,
  Menu,
  X,
} from "lucide-react";

import AiPracticeNotebookSaveButton from "@/components/video/AiPracticeNotebookSaveButton";
import {
  isApplePhonePlatform,
  isAppleTouchPlatform,
  useAiPracticeViewportProfile,
} from "@/components/video/useAiPracticeViewportProfile";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";
import { getAuthHeader } from "@/lib/authHeader";
import {
  AI_PRACTICE_NOTEBOOK_ENRICHED_SECONDS,
  AI_PRACTICE_NOTEBOOK_SIMPLE_SECONDS,
  formatNotebookChargeMinutes,
  type AiPracticeNotebookSaveInput,
} from "@/lib/aiPracticeNotebook";
import { buildCreditsPageHref } from "@/lib/creditPacks";
import { dispatchTranslationEntitlementUpdatedEvent } from "@/lib/translationEntitlementEvents";
import { buildCanonicalLivekitInviteUrl } from "@/lib/livekitInviteLinks";
import {
  CAPTION_TARGETS_CONFIG,
  DEFAULT_CAPTION_TARGET,
  DEFAULT_SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_OPTIONS,
  SPEECH_LANG_BY_TARGET,
  TRANSLATION_MODE_HELP,
  type CaptionTargetCode,
  type SourceLanguageOption,
} from "./translationConfig";

type LiveKitTokenResponse = {
  token: string;
  room?: string;
  guestTtsToken?: string;
};
type InitialLivekitAuth = {
  token: string;
  guestTtsToken?: string;
};
type CaptionTarget = CaptionTargetCode;

type PushToTalkDraftCaptureSource = "speech" | "recording" | "manual";

type PushToTalkDraft = {
  id: number;
  transcript: string;
  elapsedSeconds: number;
  captureSource: PushToTalkDraftCaptureSource;
  requiresExplicitConfirmation: boolean;
};

type PushToTalkDraftReviewStatus = "ok" | "review" | "unclear";
type PushToTalkDraftReviewMode = "coach" | "translation";

type PushToTalkDraftReview = {
  status: PushToTalkDraftReviewStatus;
  message: string;
  correctedText: string;
  naturalText: string;
  familiarText: string;
  reviewedText: string;
};

type QueuePushToTalkDraftOptions = {
  captureSource?: PushToTalkDraftCaptureSource;
  requiresExplicitConfirmation?: boolean;
  forceEditing?: boolean;
  reviewOverride?: PushToTalkDraftReview | null;
};

// Utilitaire global pour l'affichage des badges d'état
const getBadgeClass = (active: boolean) =>
  `rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800 text-slate-500"}`;

const LK_URL =
  process.env.NEXT_PUBLIC_LIVEKIT_URL?.replace(/\/$/, "") || "";
const ROOM_HEARTBEAT_INTERVAL_MS = 30_000;
const ROOM_HEARTBEAT_TIMEOUT_MS = 8_000;

const REALTIME_VOICE_OPTIONS = [

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
];

const shouldForcePushToTalkCorrection = (input: string) => {
  const normalized = input
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= 1) return true;
  if (words.length <= 2) {
    if (normalized === "you" || normalized === "you you") return true;
    if (normalized === "oui" || normalized === "ok" || normalized === "okay") return true;
  }
  return false;
};

const normalizeComparableText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const sanitizePushToTalkDraftSuggestion = (candidate: string, sourceText: string) => {
  const cleaned = candidate.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return normalizeComparableText(cleaned) === normalizeComparableText(sourceText) ? "" : cleaned;
};

const hasPushToTalkDraftReviewSuggestions = (review: PushToTalkDraftReview | null) =>
  Boolean(
    review &&
      (review.correctedText.trim() ||
        review.naturalText.trim() ||
        review.familiarText.trim())
  );

const buildManualPushToTalkDraftReview = (
  message: string,
  reviewedText = ""
): PushToTalkDraftReview => ({
  status: "unclear",
  message,
  correctedText: "",
  naturalText: "",
  familiarText: "",
  reviewedText,
});

const isPushToTalkDraftReviewCurrent = (
  review: PushToTalkDraftReview | null,
  sourceText: string
) =>
  Boolean(
    review &&
      normalizeComparableText(review.reviewedText) ===
        normalizeComparableText(sourceText)
  );

const REALTIME_TRANSLATION_ENABLED = false;
const CAPTIONS_ALWAYS_ON = true;
const VOICE_TRANSLATION_ENABLED = false;
const ANNOTATION_TOOLS_ENABLED = false;

const REALTIME_SAMPLE_RATE = 24000;
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;
const normalizeRealtimeUrl = (value?: string) => (value ?? "").trim().replace(/\/+$/, "");
const REALTIME_RETRY_DELAYS_MS = [2000, 4000, 8000];
const REALTIME_MAX_RETRIES = REALTIME_RETRY_DELAYS_MS.length;
const REALTIME_STABLE_CONNECTION_MS = 3500;
const REALTIME_NON_RETRYABLE_CLOSE_CODES = new Set([1002, 1003, 1007, 1008, 1010, 1011]);
const REALTIME_OUTGOING_CHUNK_MS = 80;
const REALTIME_OUTGOING_FLUSH_MS = 120;
const REALTIME_OUTGOING_CHUNK_SAMPLES = Math.floor(
  (REALTIME_SAMPLE_RATE * REALTIME_OUTGOING_CHUNK_MS) / 1000
);
const REALTIME_MAX_BUFFERED_SAMPLES = REALTIME_SAMPLE_RATE * 2;
const REALTIME_WS_BACKLOG_LIMIT_BYTES = 512_000;
const TRANSLATOR_IDENTITY_PREFIX = "bfzoom-translator-";
const TRANSLATION_UNLOCK_HINT =
  "Traduction indisponible: tes 3 minutes d'essai gratuit sont epuisees et tu n'as plus de credits actifs. La visioconference simple reste disponible.";
const TRANSLATION_WAIT_HOST_HINT =
  "Traduction en attente: l'hote doit disposer de minutes offertes ou de credits actifs.";
const TRANSLATION_ACCESS_TOPIC = "bfzoom-translation-access";
const TALKIE_LOCK_TOPIC = "bfzoom-ptt-lock";
const TALKIE_LOCK_TIMEOUT_MS = 10_000;
const TALKIE_LOCK_HEARTBEAT_MS = 2_500;
const TALKIE_REMOTE_AUDIO_MUTED_VOLUME = 0;
const TALKIE_REMOTE_AUDIO_VOLUME_NORMAL = 1;
const AI_PARTNER_TRAINING_ENABLED = !["0", "false", "no", "off"].includes(
  (process.env.NEXT_PUBLIC_BFZOOM_AI_PARTNER_TRAINING_ENABLED || "").trim().toLowerCase()
);
const AI_PARTNER_NAME = "Partenaire IA";
const PUSH_TO_TALK_CANCEL_DISTANCE_PX = 72;
const PUSH_TO_TALK_AUTO_SEND_MS = 500;
const formatPushToTalkAutoSendDelay = (delayMs: number) =>
  delayMs < 1000 ? "<1s" : `${Math.round(delayMs / 1000)}s`;
const NOTEBOOK_SIMPLE_LABEL = `Ajouter au carnet (${formatNotebookChargeMinutes(
  AI_PRACTICE_NOTEBOOK_SIMPLE_SECONDS
)})`;
const NOTEBOOK_ENRICHED_LABEL = `Ajouter au carnet enrichi (${formatNotebookChargeMinutes(
  AI_PRACTICE_NOTEBOOK_ENRICHED_SECONDS
)})`;
type AiPartnerScenario = "auto" | "daily" | "travel" | "business" | "interview" | "society";
type AiPartnerTone = "friendly" | "professional" | "challenging";
type AiPartnerAvatarTheme = "neutral" | "boxing";
type AiPartnerFeedbackView = "target" | "source" | "fr";
type AiPartnerConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const AI_PARTNER_HISTORY_LIMIT = 6;
const AI_PARTNER_SCENARIO_OPTIONS: ReadonlyArray<{ value: AiPartnerScenario; label: string }> = [
  { value: "auto", label: "Auto (IA)" },
  { value: "daily", label: "Quotidien" },
  { value: "travel", label: "Voyage" },
  { value: "business", label: "Business" },
  { value: "interview", label: "Entretien" },
  { value: "society", label: "Societe & actualite" },
];
const AI_PARTNER_TONE_OPTIONS: ReadonlyArray<{ value: AiPartnerTone; label: string }> = [
  { value: "friendly", label: "Amical" },
  { value: "professional", label: "Professionnel" },
  { value: "challenging", label: "Exigeant" },
];
const AI_PARTNER_AVATAR_OPTIONS: ReadonlyArray<{
  value: AiPartnerAvatarTheme;
  label: string;
}> = [
  { value: "neutral", label: "Neutre" },
  { value: "boxing", label: "Boxeur" },
];
const AI_PARTNER_SCENARIO_PROMPTS: Record<AiPartnerScenario, string> = {
  auto: "automatic context detection from the learner message.",
  daily: "casual everyday conversation between two people.",
  travel: "travel context (airport, hotel, directions, restaurant).",
  business: "professional context (meeting, negotiation, client call).",
  interview: "job interview preparation context.",
  society:
    "social and civic debate (politics, discrimination, integration, public policy, society issues).",
};
const AI_PARTNER_SCENARIO_RULES: Record<AiPartnerScenario, string[]> = {
  auto: [
    "Infer the most relevant context from the learner message before replying.",
    "If context is unclear, use a neutral daily conversation context.",
  ],
  daily: [],
  travel: [],
  business: [],
  interview: [],
  society: [
    "Take a clear human-rights-first stance.",
    "Explicitly reject racism, xenophobia, antisemitism, islamophobia, and dehumanizing rhetoric.",
    "You may strongly criticize extremist ideas and hate-based narratives.",
    "Do not present unverified accusations as facts about named individuals; focus on ideas, statements, and policies.",
    "You are not connected to live internet news. If asked about current events, request a dated source/quote before asserting facts.",
  ],
};
const AI_PARTNER_TONE_PROMPTS: Record<AiPartnerTone, string> = {
  friendly: "warm, supportive, lightly witty, emotionally intelligent, and encouraging.",
  professional: "clear, concise, confident, and professional.",
  challenging: "direct, playful, and demanding to push the learner to improve without sounding rude.",
};
const buildAiPartnerSystemPrompt = (
  languageName: string,
  scenario: AiPartnerScenario,
  tone: AiPartnerTone
) =>
  [
    "You are a live conversation training partner in a video call.",
    `Conversation language: ${languageName}.`,
    `Scenario: ${AI_PARTNER_SCENARIO_PROMPTS[scenario]}`,
    `Tone: ${AI_PARTNER_TONE_PROMPTS[tone]}`,
    "Rules:",
    `- Reply only in ${languageName}.`,
    "- Keep responses short (1-2 sentences) but precise.",
    "- Be practical, conversational, and concrete.",
    "- Sound like a lively mentor: human, sharp, and easy to talk to.",
    "- Light humor, empathy, and a little perspective are welcome when they fit naturally.",
    "- Do not behave like a therapist or abstract philosopher. Stay useful and grounded.",
    "- Avoid vague, evasive, or overly neutral filler.",
    "- Keep the current thread alive. If the learner says yes, no, okay, maybe, or asks for more detail, treat it as a continuation of your latest question or explanation.",
    "- Ask one useful follow-up question.",
    "- Feedback must help the learner answer YOUR latest reply/question.",
    "- Do not focus only on correcting the learner previous sentence.",
    "- After your main reply, append a structured coaching block with EXACT tags:",
    "- <bfzoom_feedback>",
    "- Reponses possibles:",
    "- - Option 1: (short and simple reply the learner can say next)",
    "- - Option 2: (richer reply with better wording)",
    "- Relance utile:",
    "- - (one follow-up question the learner can ask to continue)",
    "- Verbes utiles:",
    "- - (two key verbs: infinitive + one conjugated form each)",
    "- Vocabulaire utile:",
    "- - (four useful words/expressions with tiny in-language hints)",
    "- Point grammaire:",
    "- - (one concrete grammar rule tied to the coach reply and next learner turn)",
    "- Lecon conseillee:",
    "- - (one short lesson pointer that helps this exact exchange)",
    "- Micro-defi:",
    "- - (one tiny challenge for the next learner answer)",
    "- </bfzoom_feedback>",
    `- Write everything in ${languageName}.`,
    ...AI_PARTNER_SCENARIO_RULES[scenario].map((rule) => `- ${rule}`),
  ].join("\n");
const buildAiPartnerFeedbackRecoveryPrompt = (languageName: string) =>
  [
    "You are generating a coaching feedback block for a language learner in a live call.",
    `Write everything only in ${languageName}.`,
    "Output strictly one block with these exact tags:",
    "<bfzoom_feedback>",
    "Reponses possibles:",
    "- Option 1: ...",
    "- Option 2: ...",
    "Relance utile:",
    "- ...",
    "Verbes utiles:",
    "- ...",
    "- ...",
    "Vocabulaire utile:",
    "- ...",
    "- ...",
    "- ...",
    "Point grammaire:",
    "- ...",
    "Lecon conseillee:",
    "- ...",
    "Micro-defi:",
    "- ...",
    "</bfzoom_feedback>",
    "Rules:",
    "- Make it specific to the latest coach reply and coach question.",
    "- Prioritize what the learner should say next to keep the conversation going.",
    "- Do not reuse previous feedback text verbatim.",
    "- Keep it concise and practical.",
  ].join("\n");
const BFZOOM_FEEDBACK_OPEN_TAG = "<bfzoom_feedback>";
const BFZOOM_FEEDBACK_CLOSE_TAG = "</bfzoom_feedback>";
const parseAiPartnerCoachPayload = (raw: string) => {
  const normalizedRaw = raw.replace(/\r\n/g, "\n").trim();
  if (!normalizedRaw) return { reply: "", feedback: "" };
  const blockRegex = new RegExp(
    `${BFZOOM_FEEDBACK_OPEN_TAG}([\\s\\S]*?)${BFZOOM_FEEDBACK_CLOSE_TAG}`,
    "i"
  );
  const blockMatch = normalizedRaw.match(blockRegex);
  const feedback = blockMatch
    ? blockMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          if (/^[*-]\s+/.test(line)) {
            return `• ${line.replace(/^[*-]\s+/, "").trim()}`;
          }
          return line;
        })
        .join("\n")
    : "";
  const reply = normalizedRaw
    .replace(blockRegex, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    reply: reply || normalizedRaw,
    feedback,
  };
};
const safeRandomId = () => {
  // Keep client IDs deterministic enough for UI/session needs without Web Crypto,
  // to avoid Safari iOS randomUUID context issues in some environments.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};
type InviteLinkKind = "smart";
type InviteLinks = Record<InviteLinkKind, string>;
type InviteCopyFeedback = InviteLinkKind | "shared";
const buildInviteLinks = (inviteId: string): InviteLinks => {
  return {
    smart: buildCanonicalLivekitInviteUrl(inviteId),
  };
};
const createLivekitRoomInviteId = async (roomId: string) => {
  const authHeader = await getAuthHeader();
  const res = await fetch("/api/livekit/invite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({ room: roomId }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    inviteId?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error || `Invite creation failed (${res.status})`);
  }
  const inviteId = (payload.inviteId || "").trim();
  if (!inviteId) {
    throw new Error("Invite creation returned no invite id.");
  }
  return inviteId;
};
const getInviteCopiedLabel = (value: InviteCopyFeedback, locale: UiLocale = "fr") => {
  const ui = LIVEKIT_UI_COPY[locale];
  if (value === "smart") return ui.linkCopied;
  if (value === "shared") return ui.inviteShareSent;
  return "OK";
};
const getLocalizedBackgroundOptionLabel = (
  optionId: string,
  ui: LiveKitUiText
) => {
  switch (optionId) {
    case "none":
      return ui.normalBackground;
    case "blur":
      return ui.blurBackground;
    case "studio":
      return ui.studioBackground;
    case "sunset":
      return ui.sunsetBackground;
    case "grid":
      return ui.gridBackground;
    default:
      return optionId;
  }
};
const buildMailtoHref = (subject: string, body: string) =>
  `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const buildSmsHref = (body: string) => {
  const encodedBody = encodeURIComponent(body);
  if (typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return `sms:&body=${encodedBody}`;
  }
  return `sms:?body=${encodedBody}`;
};

const openMailComposer = (subject: string, body: string) => {
  if (typeof window === "undefined") return;
  const href = buildMailtoHref(subject, body);
  try {
    window.location.assign(href);
  } catch {
    window.location.href = href;
  }
};
const buildVideoConferenceRoomHref = (
  roomId: string,
  isHost: boolean,
  options?: { resume?: boolean }
) => {
  const params = new URLSearchParams({ room: roomId.trim() });
  if (isHost) {
    params.set("host", "1");
  }
  if (options?.resume) {
    params.set("resume", "1");
  }
  return `/videoconference?${params.toString()}`;
};
const PREJOIN_CHOICES_STORAGE_PREFIX = "bfzoom:prejoin-choices";
const buildPreJoinChoicesStorageKey = (roomId: string, isHost: boolean) =>
  `${PREJOIN_CHOICES_STORAGE_PREFIX}:${roomId.trim()}:${isHost ? "host" : "guest"}`;

const sanitizeDisplayName = (value?: string) => {
  const trimmed = (value || "").trim();
  return trimmed.slice(0, 80);
};

const normalizePreJoinChoices = (
  value: unknown,
  fallbackName: string
): LocalUserChoices => {
  const candidate = (value && typeof value === "object"
    ? value
    : {}) as Partial<LocalUserChoices>;
  const username = sanitizeDisplayName(candidate.username) || fallbackName;
  return {
    username,
    audioEnabled: typeof candidate.audioEnabled === "boolean" ? candidate.audioEnabled : true,
    videoEnabled: typeof candidate.videoEnabled === "boolean" ? candidate.videoEnabled : true,
    audioDeviceId: typeof candidate.audioDeviceId === "string" ? candidate.audioDeviceId : "",
    videoDeviceId: typeof candidate.videoDeviceId === "string" ? candidate.videoDeviceId : "",
  };
};

const getDisconnectNotice = (reason?: DisconnectReason) => {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return "Session suspendue par le navigateur (souvent apres un appel entrant iPhone).";
    case DisconnectReason.USER_REJECTED:
      return "Appel interrompu: un autre appel a ete refuse par le systeme.";
    case DisconnectReason.USER_UNAVAILABLE:
      return "Appel interrompu: utilisateur temporairement indisponible (appel telephonique en cours).";
    case DisconnectReason.SIGNAL_CLOSE:
      return "Connexion interrompue (signal). Reprends la session en un clic.";
    case DisconnectReason.JOIN_FAILURE:
      return "La session a ete interrompue. Tente une reconnexion.";
    case DisconnectReason.STATE_MISMATCH:
      return "Session desynchronisee apres interruption. Reconnexion requise.";
    case DisconnectReason.UNKNOWN_REASON:
    default:
      return "Session interrompue (souvent apres un appel entrant iPhone).";
  }
};

const AUTO_RESUME_MAX_ATTEMPTS = 40;
const AUTO_RESUME_RETRY_DELAYS_MS = [1200, 2200, 3500, 5000, 7000, 9000];
const AUTO_RESUME_GRACE_PERIOD_MS = 5 * 60 * 1000;

const formatResumeCountdown = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatTranslationRemaining = (remainingSeconds?: number | null) => {
  if (typeof remainingSeconds !== "number" || !Number.isFinite(remainingSeconds)) {
    return "Synchronisation...";
  }
  if (remainingSeconds >= Number.MAX_SAFE_INTEGER / 2) {
    return "Illimite";
  }
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const openCreditsTopUpFromCall = () => {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const href = buildCreditsPageHref({ returnTo });
  const creditsWindow = window.open(href, "_blank", "noopener,noreferrer");
  if (!creditsWindow) {
    window.location.assign(href);
  }
};

type AnnotationPoint = { x: number; y: number };
type AnnotationStroke = {
  type: "stroke";
  points: AnnotationPoint[];
  color: string;
  width: number;
};
type AnnotationText = {
  type: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
};
type AnnotationEntry = AnnotationStroke | AnnotationText;

type CaptionPayload = {
  id?: string;
  text?: string;
  roomId?: string;
  from?: string;
  timestamp?: number;
  target?: CaptionTargetCode;
  targetLang?: string;
  audioTrackPublished?: boolean;
  sourceText?: string;
  sourceLang?: string;
  sourceLangName?: string;
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

type TalkieLockPayload = {
  roomId?: string;
  holder?: string;
  holderName?: string;
  action?: "claim" | "release" | "heartbeat";
  expiresAt?: number;
  timestamp?: number;
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

const parseCoachFeedbackLines = (feedback: string) =>
  feedback
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const suggestionText = line.startsWith("•") ? stripCoachSuggestionPrefix(line) : "";
      const phoneticId = suggestionText ? `${index}:${suggestionText}` : "";
      return {
        id: phoneticId || `${index}:${line}`,
        text: line,
        suggestionText,
        phoneticId,
      };
    });

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

type LiveKitUiText = {
  shareKeyPoint: string;
  askSummary: string;
  close: string;
  send: string;
  sendAsIs: string;
  edit: string;
  cancel: string;
  autoSendIn: (delayLabel: string) => string;
  simpleSuggestion: string;
  naturalVersion: string;
  familiarVersion: string;
  applyCorrection: string;
  useNaturalVersion: string;
  useFamiliarVersion: string;
  inviteShareSent: string;
  inviteEmailSubject: string;
  inviteEmailBody: string;
  verifyBeforeTranslation: string;
  verifyBeforeSend: string;
  analysisBeforeTranslation: string;
  analysisInProgress: string;
  noVoiceDetected: string;
  incompleteDetection: string;
  disableRealtimeForPushToTalk: string;
  sourceLabel: (language: string) => string;
  translationLabel: (language: string) => string;
  share: string;
  shareAria: string;
  microphone: string;
  camera: string;
  cameraBusy: string;
  enableCameraAria: string;
  disableCameraAria: string;
  flip: string;
  flipCameraAria: string;
  screen: string;
  chat: string;
  settings: string;
  more: string;
  moreActionsAria: string;
  endForAll: string;
  ending: string;
  endShort: string;
  leave: string;
  localPlayback: string;
  blocked: string;
  holdToTalk: string;
  releaseToTranslate: string;
  translating: string;
  talkieBusyBy: (name: string) => string;
  talkieInfo: string;
  translationRemaining: string;
  translationRemainingHost: string;
  topUpNow: string;
  askHostToTopUp: string;
  sourceCaptured: string;
  directSpeech: string;
  screenShareInProgress: (trackName?: string) => string;
  hideGallery: string;
  showGallery: string;
  stopSharing: string;
  stopShareConfirm: string;
  shareRoom: string;
  smartLink: string;
  smartHint: string;
  shareOptionsHint: string;
  sendEmail: string;
  sendSms: string;
  shareViaDevice: string;
  emailReady: string;
  copyLink: string;
  linkCopied: string;
  copyShort: string;
  settingsTitle: string;
  cameraSection: string;
  hostSection: string;
  hostOptions: string;
  hostReserved: string;
  hostLinkHint: string;
  cameraAndCaptionsTitle: string;
  cameraAndCaptionsHint: string;
  cameraAndCaptionsInfo: string;
  autoFrame: string;
  autoFrameInfo: string;
  active: string;
  inactive: string;
  captionSize: string;
  captionSizeInfo: string;
  videoFit: string;
  videoFitInfo: string;
  fill: string;
  fit: string;
  forceFit: string;
  forceFitHint: string;
  backgroundTitle: string;
  backgroundInfo: string;
  normalBackground: string;
  blurBackground: string;
  studioBackground: string;
  sunsetBackground: string;
  gridBackground: string;
  dallePromptPlaceholder: string;
  generate: string;
  generating: string;
  save: string;
  overlayTextOptional: string;
  overlayTextPlaceholder: string;
  overlayTextHint: string;
  aiGeneratingStatus: string;
  aiBackgroundActiveStatus: string;
  generateThenActivate: string;
  aiGenerationHostOnly: string;
  importImage: string;
  importedBackgrounds: string;
  aiGalleryTitle: string;
  delete: string;
  flipCamera: string;
  activate: string;
  remove: string;
  aiBackgroundActiveCard: string;
  translationLanguages: string;
  spokenLanguage: string;
  communicationLanguage: string;
  personalReceptionLanguage: string;
  info: string;
  receptionInfoLabel: string;
  open: string;
  collapse: string;
  noMessages: string;
  messagesVisible: string;
  writeIn: string;
  writeMessagePlaceholder: string;
  preview: string;
  listen: string;
  stop: string;
  sentTranslation: string;
  returnLabel: string;
  mobileReviewRequired: string;
  mobileTranscriptionUnclear: string;
  mobileTranscriptionFailed: string;
};

const LIVEKIT_UI_COPY: Record<UiLocale, LiveKitUiText> = {
  fr: {
    shareKeyPoint: "Partager un point clé",
    askSummary: "Demander un résumé",
    close: "Fermer",
    send: "Envoyer",
    sendAsIs: "Envoyer tel quel",
    edit: "Corriger",
    cancel: "Annuler",
    autoSendIn: (delayLabel) => `Envoi auto dans ${delayLabel}`,
    simpleSuggestion: "Suggestion simple",
    naturalVersion: "Version naturelle",
    familiarVersion: "Version familiere",
    applyCorrection: "Appliquer la correction",
    useNaturalVersion: "Utiliser la version naturelle",
    useFamiliarVersion: "Utiliser la version familiere",
    inviteShareSent: "Partage envoye",
    inviteEmailSubject: "Invitation BFZoom",
    inviteEmailBody: "Rejoins ma visioconference BFZoom avec ce lien.",
    verifyBeforeTranslation: "Verification avant traduction",
    verifyBeforeSend: "Verification avant envoi",
    analysisBeforeTranslation: "Analyse avant traduction en cours...",
    analysisInProgress: "Analyse en cours...",
    noVoiceDetected: "Aucune voix detectee. Maintiens le bouton puis parle.",
    incompleteDetection:
      "Verifie la phrase captee puis clique Envoyer. La detection semble incomplete.",
    disableRealtimeForPushToTalk:
      "Desactive Realtime pour utiliser le mode appuyer pour parler.",
    sourceLabel: (language) => `Source (${language})`,
    translationLabel: (language) => `Traduction (${language})`,
    share: "Partager",
    shareAria: "Partager le lien",
    microphone: "Micro",
    camera: "Camera",
    cameraBusy: "Camera...",
    enableCameraAria: "Activer la camera",
    disableCameraAria: "Couper la camera",
    flip: "Retourner",
    flipCameraAria: "Retourner la camera",
    screen: "Ecran",
    chat: "Chat",
    settings: "Reglages",
    more: "Plus",
    moreActionsAria: "Plus d'actions",
    endForAll: "Terminer pour tous",
    ending: "Fermeture...",
    endShort: "Terminer",
    leave: "Quitter",
    localPlayback: "Lecture locale",
    blocked: "BLOQUE",
    holdToTalk: "Maintenir pour parler",
    releaseToTranslate: "Relache pour traduire",
    translating: "Traduction...",
    talkieBusyBy: (name) => `Talkie occupe par ${name}.`,
    talkieInfo: 'Talkie traduction: maintiens "Maintenir pour parler", puis relache.',
    translationRemaining: "Temps traduction restant: ",
    translationRemainingHost: "Temps traduction restant (hote): ",
    topUpNow: "Recharger maintenant",
    askHostToTopUp: "Demande a l'hote de recharger pour reactiver la traduction.",
    sourceCaptured: "Source captee",
    directSpeech: "Oral direct",
    screenShareInProgress: (trackName) =>
      `Partage d’écran en cours${trackName ? ` • ${trackName}` : ""}`,
    hideGallery: "Masquer galerie",
    showGallery: "Afficher galerie",
    stopSharing: "Arrêter le partage",
    stopShareConfirm: "Arrêter le partage d’écran ?",
    shareRoom: "Partager la salle",
    smartLink: "Lien intelligent",
    smartHint: "Invite en un clic: app mobile si installée, sinon navigateur.",
    shareOptionsHint: "Choisis comment envoyer ce lien: mail, SMS, copie ou partage de l'appareil.",
    sendEmail: "Envoyer par email",
    sendSms: "Envoyer par SMS",
    shareViaDevice: "Partager via l'appareil",
    emailReady: "Email pret ✅",
    copyLink: "Copier le lien",
    linkCopied: "Lien copie ✅",
    copyShort: "Copie",
    settingsTitle: "Reglages",
    cameraSection: "Camera",
    hostSection: "Hote",
    hostOptions: "Options hote",
    hostReserved: "Gestion hote reservee a l'hote.",
    hostLinkHint: "Ouvre le lien de salle en mode hote pour les afficher.",
    cameraAndCaptionsTitle: "Camera & sous-titres",
    cameraAndCaptionsHint: "Ajuste le cadrage et controle la transcription automatique.",
    cameraAndCaptionsInfo: "Reglages de la camera et des sous-titres.",
    autoFrame: "Auto-cadrage",
    autoFrameInfo: "Garde ton visage centre automatiquement.",
    active: "Actif",
    inactive: "Inactif",
    captionSize: "Taille sous-titres",
    captionSizeInfo: "Ajuste la taille du texte affiche.",
    videoFit: "Cadrage video",
    videoFitInfo: "Remplir coupe l'image, Entier affiche toute l'image.",
    fill: "Remplir",
    fit: "Entier",
    forceFit: "Forcer l'entier",
    forceFitHint: "Reapplique « Entier » pour voir tout le fond DALL·E.",
    backgroundTitle: "Arriere-plan",
    backgroundInfo: "Choisis, importe ou supprime les fonds depuis les reglages.",
    normalBackground: "Normal",
    blurBackground: "Flou",
    studioBackground: "Studio",
    sunsetBackground: "Coucher",
    gridBackground: "Grille",
    dallePromptPlaceholder: "Prompt (ex: studio zen, lumiere douce)",
    generate: "Generer",
    generating: "Generation...",
    save: "Enregistrer",
    overlayTextOptional: "Texte a integrer (optionnel)",
    overlayTextPlaceholder: "Ex: Focus, Discipline",
    overlayTextHint: "Le texte peut varier selon le rendu DALL·E.",
    aiGeneratingStatus: "Generation IA en cours...",
    aiBackgroundActiveStatus: "Fond IA actif.",
    generateThenActivate: "Genere un fond puis active-le ci-dessous.",
    aiGenerationHostOnly: "Generation IA reservee a l'hote.",
    importImage: "Importer une image",
    importedBackgrounds: "Fonds importes",
    aiGalleryTitle: "Galerie IA",
    delete: "Supprimer",
    flipCamera: "Retourner la camera",
    activate: "Activer",
    remove: "Supprimer",
    aiBackgroundActiveCard: "Fond IA actif · genere un nouveau prompt pour le remplacer.",
    translationLanguages: "Langues de traduction",
    spokenLanguage: "Langue que tu parles",
    communicationLanguage: "Langue de communication (texte + voix)",
    personalReceptionLanguage: "Langue de réception (personnelle)",
    info: "Info",
    receptionInfoLabel: "Info langue de reception",
    open: "Ouvrir",
    collapse: "Replier",
    noMessages: "Aucun message dans la salle.",
    messagesVisible: "Messages visibles par tous les participants.",
    writeIn: "J’écris en",
    writeMessagePlaceholder: "Ecris un message...",
    preview: "Aperçu",
    listen: "Ecouter",
    stop: "Stop",
    sentTranslation: "Traduction envoyée:",
    returnLabel: "Retour",
    mobileReviewRequired: "Relis puis valide la phrase avant envoi depuis le web mobile.",
    mobileTranscriptionUnclear:
      "La transcription mobile est vide ou incertaine. Corrige la phrase ou réessaie.",
    mobileTranscriptionFailed:
      "La transcription mobile a échoué. Corrige manuellement la phrase ou réessaie.",
  },
  en: {
    shareKeyPoint: "Share a key point",
    askSummary: "Ask for a summary",
    close: "Close",
    send: "Send",
    sendAsIs: "Send as is",
    edit: "Edit",
    cancel: "Cancel",
    autoSendIn: (delayLabel) => `Auto-send in ${delayLabel}`,
    simpleSuggestion: "Simple suggestion",
    naturalVersion: "Natural version",
    familiarVersion: "Casual version",
    applyCorrection: "Apply correction",
    useNaturalVersion: "Use natural version",
    useFamiliarVersion: "Use casual version",
    inviteShareSent: "Shared",
    inviteEmailSubject: "BFZoom invitation",
    inviteEmailBody: "Join my BFZoom video conference with this link.",
    verifyBeforeTranslation: "Review before translation",
    verifyBeforeSend: "Review before sending",
    analysisBeforeTranslation: "Checking before translation...",
    analysisInProgress: "Analysis in progress...",
    noVoiceDetected: "No voice detected. Hold the button and speak.",
    incompleteDetection: "Check the captured phrase, then click Send. Detection seems incomplete.",
    disableRealtimeForPushToTalk:
      "Disable Realtime to use push-to-talk mode.",
    sourceLabel: (language) => `Source (${language})`,
    translationLabel: (language) => `Translation (${language})`,
    share: "Share",
    shareAria: "Share link",
    microphone: "Mic",
    camera: "Camera",
    cameraBusy: "Camera...",
    enableCameraAria: "Enable camera",
    disableCameraAria: "Turn camera off",
    flip: "Flip",
    flipCameraAria: "Flip camera",
    screen: "Screen",
    chat: "Chat",
    settings: "Settings",
    more: "More",
    moreActionsAria: "More actions",
    endForAll: "End for everyone",
    ending: "Closing...",
    endShort: "End",
    leave: "Leave",
    localPlayback: "Local playback",
    blocked: "LOCKED",
    holdToTalk: "Hold to talk",
    releaseToTranslate: "Release to translate",
    translating: "Translating...",
    talkieBusyBy: (name) => `Talkie is currently used by ${name}.`,
    talkieInfo: 'Translation talkie: hold "Hold to talk", then release.',
    translationRemaining: "Translation time left: ",
    translationRemainingHost: "Translation time left (host): ",
    topUpNow: "Top up now",
    askHostToTopUp: "Ask the host to top up to reactivate translation.",
    sourceCaptured: "Captured source",
    directSpeech: "Direct speech",
    screenShareInProgress: (trackName) =>
      `Screen sharing in progress${trackName ? ` • ${trackName}` : ""}`,
    hideGallery: "Hide gallery",
    showGallery: "Show gallery",
    stopSharing: "Stop sharing",
    stopShareConfirm: "Stop screen sharing?",
    shareRoom: "Share room",
    smartLink: "Smart link",
    smartHint: "One-click invite: mobile app if installed, otherwise the browser.",
    shareOptionsHint: "Choose how to send this link: email, SMS, copy, or device share.",
    sendEmail: "Send by email",
    sendSms: "Send by SMS",
    shareViaDevice: "Share via device",
    emailReady: "Email ready ✅",
    copyLink: "Copy link",
    linkCopied: "Link copied ✅",
    copyShort: "Copied",
    settingsTitle: "Settings",
    cameraSection: "Camera",
    hostSection: "Host",
    hostOptions: "Host options",
    hostReserved: "Host controls are reserved for the host.",
    hostLinkHint: "Open the room link in host mode to display them.",
    cameraAndCaptionsTitle: "Camera & captions",
    cameraAndCaptionsHint: "Adjust framing and control automatic transcription.",
    cameraAndCaptionsInfo: "Camera and captions settings.",
    autoFrame: "Auto-framing",
    autoFrameInfo: "Keeps your face centered automatically.",
    active: "Active",
    inactive: "Inactive",
    captionSize: "Caption size",
    captionSizeInfo: "Adjust the displayed text size.",
    videoFit: "Video framing",
    videoFitInfo: "Fill crops the image, Fit shows the full image.",
    fill: "Fill",
    fit: "Fit",
    forceFit: "Force fit",
    forceFitHint: "Reapply “Fit” to show the full DALL·E background.",
    backgroundTitle: "Background",
    backgroundInfo: "Choose, import, or remove backgrounds from settings.",
    normalBackground: "Normal",
    blurBackground: "Blur",
    studioBackground: "Studio",
    sunsetBackground: "Sunset",
    gridBackground: "Grid",
    dallePromptPlaceholder: "Prompt (e.g. zen studio, soft light)",
    generate: "Generate",
    generating: "Generating...",
    save: "Save",
    overlayTextOptional: "Text to include (optional)",
    overlayTextPlaceholder: "E.g. Focus, Discipline",
    overlayTextHint: "The text may vary depending on the DALL·E render.",
    aiGeneratingStatus: "AI generation in progress...",
    aiBackgroundActiveStatus: "AI background active.",
    generateThenActivate: "Generate a background, then activate it below.",
    aiGenerationHostOnly: "AI generation is reserved for the host.",
    importImage: "Import an image",
    importedBackgrounds: "Imported backgrounds",
    aiGalleryTitle: "AI gallery",
    delete: "Delete",
    flipCamera: "Flip camera",
    activate: "Activate",
    remove: "Remove",
    aiBackgroundActiveCard: "AI background active. Generate a new prompt to replace it.",
    translationLanguages: "Translation languages",
    spokenLanguage: "Language you speak",
    communicationLanguage: "Communication language (text + voice)",
    personalReceptionLanguage: "Reception language (personal)",
    info: "Info",
    receptionInfoLabel: "Reception language info",
    open: "Open",
    collapse: "Collapse",
    noMessages: "No messages in this room.",
    messagesVisible: "Messages visible to all participants.",
    writeIn: "I write in",
    writeMessagePlaceholder: "Write a message...",
    preview: "Preview",
    listen: "Listen",
    stop: "Stop",
    sentTranslation: "Sent translation:",
    returnLabel: "Back",
    mobileReviewRequired: "Review and confirm the sentence before sending from mobile web.",
    mobileTranscriptionUnclear:
      "The mobile transcription is empty or uncertain. Edit the sentence or try again.",
    mobileTranscriptionFailed:
      "The mobile transcription failed. Edit the sentence manually or try again.",
  },
};

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
  const lockReason =
    typeof raw.lockReason === "string" ? raw.lockReason.trim() : "";
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

const isTranslatorParticipantIdentity = (identity: string) =>
  identity.trim().toLowerCase().startsWith(TRANSLATOR_IDENTITY_PREFIX);
const isRealtimeNonRetryableCloseCode = (code: number) =>
  REALTIME_NON_RETRYABLE_CLOSE_CODES.has(code);

type ActionControlsProps = {
  visible: boolean;
  onAction: (type: string) => void;
  onClose: () => void;
};

function ActionControls({ visible, onAction, onClose }: ActionControlsProps) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  if (!visible) return null;
  return (
    <div className="absolute inset-x-0 bottom-[calc(var(--lk-control-bar-height)+60px)] z-30 flex justify-center px-4">
      <div className="flex gap-2 rounded-full bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-800 shadow-lg">
        <button type="button" onClick={() => onAction("share-point")} className="rounded-full border border-slate-200 px-3 py-1">
          {ui.shareKeyPoint}
        </button>
        <button type="button" onClick={() => onAction("ask-summary")} className="rounded-full border border-slate-200 px-3 py-1">
          {ui.askSummary}
        </button>
        <button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-3 py-1">
          {ui.close}
        </button>
      </div>
    </div>
  );
}

type PushToTalkDraftModalProps = {
  draftText: string;
  editing: boolean;
  review: PushToTalkDraftReview | null;
  reviewBusy: boolean;
  reviewMode?: PushToTalkDraftReviewMode;
  showAutoSendHint: boolean;
  notebookEnabled?: boolean;
  notebookBaseText?: string;
  notebookRoomId?: string;
  notebookTargetLanguageCode?: string;
  notebookTargetLanguageName?: string;
  notebookVoice?: string;
  onChangeText: (nextValue: string) => void;
  onSubmit: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onApplySuggestion: (nextValue: string) => void;
};

function PushToTalkDraftModal({
  draftText,
  editing,
  review,
  reviewBusy,
  reviewMode = "coach",
  showAutoSendHint,
  notebookEnabled = false,
  notebookBaseText = "",
  notebookRoomId = "",
  notebookTargetLanguageCode = "",
  notebookTargetLanguageName = "",
  notebookVoice = "",
  onChangeText,
  onSubmit,
  onEdit,
  onCancel,
  onApplySuggestion,
}: PushToTalkDraftModalProps) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const viewportProfile = useAiPracticeViewportProfile();
  const isCompactViewport = viewportProfile.isPhone;
  const [portalReady, setPortalReady] = useState(false);
  const isTranslationReview = reviewMode === "translation";
  const reviewIsCurrent = isPushToTalkDraftReviewCurrent(review, draftText);
  const reviewSuggestions = reviewIsCurrent
    ? [
        {
          id: "corrected",
          title: ui.simpleSuggestion,
          actionLabel: ui.applyCorrection,
          text: review?.correctedText.trim() || "",
        },
        {
          id: "natural",
          title: ui.naturalVersion,
          actionLabel: ui.useNaturalVersion,
          text: review?.naturalText.trim() || "",
        },
        {
          id: "familiar",
          title: ui.familiarVersion,
          actionLabel: ui.useFamiliarVersion,
          text: review?.familiarText.trim() || "",
        },
      ].filter((item, index, items) => {
        if (!item.text) return false;
        const normalized = normalizeComparableText(item.text);
        return items.findIndex((candidate) => normalizeComparableText(candidate.text) === normalized) === index;
      })
    : [];
  const sendLabel =
    reviewIsCurrent && review?.status && review.status !== "ok"
      ? ui.sendAsIs
      : ui.send;
  const reviewToneClass = reviewBusy
    ? "border-sky-300/70 bg-sky-500/10 text-sky-50"
    : review?.status === "unclear"
    ? "border-amber-300/70 bg-amber-500/10 text-amber-50"
    : review?.status === "review"
    ? "border-rose-300/70 bg-rose-500/10 text-rose-50"
    : "border-emerald-300/70 bg-emerald-500/10 text-emerald-50";
  const canSaveReviewSuggestions =
    notebookEnabled &&
    reviewIsCurrent &&
    notebookTargetLanguageCode.trim().length > 0 &&
    notebookTargetLanguageName.trim().length > 0;
  const modalTitle = isTranslationReview
    ? ui.verifyBeforeTranslation
    : ui.verifyBeforeSend;
  const busyLabel = isTranslationReview
    ? ui.analysisBeforeTranslation
    : ui.analysisInProgress;

  useEffect(() => {
    setPortalReady(true);
    return () => setPortalReady(false);
  }, []);

  if (!portalReady || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-140 flex justify-center px-3 ${
        isCompactViewport ? "items-center" : "items-end"
      }`}
      style={{
        paddingTop: isCompactViewport ? "calc(env(safe-area-inset-top, 0px) + 0.75rem)" : undefined,
        paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${isCompactViewport ? "0.75rem" : "1rem"})`,
      }}
    >
      <div className="absolute inset-0 bg-slate-950/38 backdrop-blur-[1px]" />
      <div
        className={`relative flex w-full flex-col overflow-hidden border shadow-2xl ${
          isCompactViewport
            ? "max-h-[calc(100dvh-1.5rem)] max-w-[min(96vw,36rem)] rounded-2xl"
            : "max-h-[min(78vh,34rem)] max-w-[min(92vw,32rem)] rounded-lg"
        }`}
        style={{
          backgroundColor: "rgba(15, 23, 42, 0.98)",
          color: "#f8fafc",
          borderColor: "rgba(148, 163, 184, 0.88)",
        }}
      >
        <div className={isCompactViewport ? "overflow-y-auto px-4 py-4" : "overflow-y-auto px-3 py-3"}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-100">{modalTitle}</p>
          {editing ? (
            <textarea
              value={draftText}
              onChange={(event) => onChangeText(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-md border border-slate-500/80 bg-slate-900/80 px-2 py-1.5 text-[12px] text-slate-50 outline-none ring-sky-400/60 focus:ring-1"
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap wrap-break-word text-[12px] text-slate-100">
              {draftText}
            </p>
          )}
          {(reviewBusy || (reviewIsCurrent && review?.message)) && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${reviewToneClass}`}>
              {reviewBusy ? busyLabel : review?.message}
            </div>
          )}
          {reviewIsCurrent &&
            hasPushToTalkDraftReviewSuggestions(review) &&
            reviewSuggestions.length > 0 && (
              <div className="mt-3 space-y-2">
                {reviewSuggestions.map((suggestion) => (
                  <div
                    key={`${suggestion.id}:${suggestion.text}`}
                    className="rounded-lg border border-slate-600/80 bg-slate-900/70 px-3 py-2"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                      {suggestion.title}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap wrap-break-word text-[12px] text-slate-50">
                      {suggestion.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => onApplySuggestion(suggestion.text)}
                      className="mt-2 inline-flex items-center rounded-full border border-sky-300/80 bg-sky-700/70 px-3 py-1 text-[11px] font-semibold text-white"
                    >
                      {suggestion.actionLabel}
                    </button>
                    {canSaveReviewSuggestions && (
                      <AiPracticeNotebookSaveButton
                        payload={{
                          kind: "draft_review",
                          mode: "simple",
                          baseText: notebookBaseText || review?.reviewedText || draftText,
                          targetText: suggestion.text,
                          targetLanguageCode: notebookTargetLanguageCode,
                          targetLanguageName: notebookTargetLanguageName,
                          correctedText: review?.correctedText || "",
                          naturalText: review?.naturalText || "",
                          familiarText: review?.familiarText || "",
                          contextLabel: suggestion.title,
                          roomId: notebookRoomId,
                          voice: notebookVoice,
                        }}
                        label={NOTEBOOK_SIMPLE_LABEL}
                        className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/8 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-white/12 disabled:opacity-60"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
        <div
          className={`border-t border-slate-700/70 bg-slate-950/94 ${
            isCompactViewport ? "px-4 py-3" : "px-3 py-3"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSubmit}
            className="inline-flex items-center rounded-full border border-emerald-300/80 bg-emerald-600/85 px-3 py-1 text-[11px] font-semibold text-white"
          >
            {sendLabel}
          </button>
          {!editing && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center rounded-full border border-sky-300/80 bg-sky-700/70 px-3 py-1 text-[11px] font-semibold text-white"
            >
              {ui.edit}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-full border border-slate-300/70 bg-slate-700/70 px-3 py-1 text-[11px] font-semibold text-slate-100"
          >
            {ui.cancel}
          </button>
          {showAutoSendHint && (
            <span className="text-[10px] text-slate-300">
              {ui.autoSendIn(formatPushToTalkAutoSendDelay(PUSH_TO_TALK_AUTO_SEND_MS))}
            </span>
          )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function InfoBubble({
  text,
  label = "Info",
  align = "center",
}: {
  text: string;
  label?: string;
  align?: "left" | "center" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const alignClass =
    align === "left"
      ? "left-0 translate-x-0"
      : align === "right"
      ? "right-0 translate-x-0"
      : "left-1/2 -translate-x-1/2";

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="group relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        title={text}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border shadow-sm"
        style={{
          backgroundColor: "rgba(15, 23, 42, 0.98)",
          color: "#f8fafc",
          borderColor: "rgba(148, 163, 184, 0.9)",
        }}
      >
        <Info className="h-3 w-3" />
      </button>
      <div
        className={`absolute top-full z-40 mt-2 w-64 rounded-lg border px-3 py-2 text-[11px] font-medium shadow-xl transition-opacity duration-150 ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        } ${alignClass}`}
        style={{
          backgroundColor: "rgba(15, 23, 42, 0.99)",
          color: "#f8fafc",
          borderColor: "rgba(148, 163, 184, 0.9)",
          boxShadow: "0 10px 26px rgba(2, 6, 23, 0.6)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

type TranslateWithOpenAIOptions = {
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  fromCode?: string;
  toCode?: string;
  guestToken?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  intent?: "translation" | "default";
};

type PhoneticWithOpenAIOptions = {
  signal?: AbortSignal;
  targetCode?: string;
  guestToken?: string;
};

const resolveLanguageNameFromCode = (code?: string) => {
  if (!code) return "";
  const normalized = code.trim().toLowerCase();
  if (!normalized) return "";
  const sourceMatch = SOURCE_LANGUAGE_OPTIONS.find((item) => item.code === normalized);
  if (sourceMatch?.name) return sourceMatch.name;
  const targetMatch = CAPTION_TARGETS_CONFIG.find((item) => item.code === normalized);
  if (targetMatch?.name) return targetMatch.name;
  return normalized.toUpperCase();
};

const normalizeLanguageKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const shouldShowPhoneticAidForLanguage = (languageCode?: string) => {
  const normalized = String(languageCode || "").trim().toLowerCase();
  return Boolean(normalized) && normalized !== "fr";
};

const stripCoachSuggestionPrefix = (line: string) =>
  line
    .replace(/^•\s*/, "")
    .replace(/^Option\s*\d+\s*:\s*/i, "")
    .trim();

const resolveSpeechLocaleFromLanguage = (language?: string) => {
  const raw = (language || "").trim();
  if (!raw) return "";
  if (/^[a-z]{2}-[a-z]{2}$/i.test(raw)) {
    const [languagePart = "", regionPart = ""] = raw.split("-");
    return `${languagePart.toLowerCase()}-${regionPart.toUpperCase()}`;
  }
  if (/^[a-z]{2}$/i.test(raw)) {
    const normalizedCode = raw.toLowerCase();
    const sourceByCode = SOURCE_LANGUAGE_OPTIONS.find((item) => item.code === normalizedCode);
    if (sourceByCode?.recognitionLocale) return sourceByCode.recognitionLocale;
    const targetByCode = CAPTION_TARGETS_CONFIG.find((item) => item.code === normalizedCode);
    if (targetByCode?.speechLocale) return targetByCode.speechLocale;
  }
  const key = normalizeLanguageKey(raw);
  if (!key) return "";
  const sourceByName = SOURCE_LANGUAGE_OPTIONS.find((item) =>
    [item.code, item.label, item.name].some((candidate) => normalizeLanguageKey(candidate) === key)
  );
  if (sourceByName?.recognitionLocale) return sourceByName.recognitionLocale;
  const targetByName = CAPTION_TARGETS_CONFIG.find((item) =>
    [item.code, item.label, item.name].some((candidate) => normalizeLanguageKey(candidate) === key)
  );
  return targetByName?.speechLocale || "";
};

const estimateChatTranslationSeconds = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const byWords = Math.ceil(words / 2);
  const byChars = Math.ceil(trimmed.length / 24);
  return Math.max(1, Math.min(30, Math.max(byWords, byChars)));
};

const GUEST_TRANSLATION_CACHE_LIMIT = 160;

const normalizeCaptionTargetCode = (value?: string): CaptionTargetCode | null => {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  return CAPTION_TARGETS_CONFIG.some((item) => item.code === normalized)
    ? (normalized as CaptionTargetCode)
    : null;
};

const resolveCaptionDisplayTarget = (
  target?: string | null,
  fallback?: string | null
): CaptionTarget =>
  (normalizeCaptionTargetCode(target || undefined) ??
    normalizeCaptionTargetCode(fallback || undefined) ??
    DEFAULT_CAPTION_TARGET) as CaptionTarget;

const buildCaptionFallbackMessage = (
  requestedTargetName: string,
  actualTarget?: string | null
) => {
  const actualName =
    resolveLanguageNameFromCode(actualTarget || undefined) ||
    String(actualTarget || "").trim().toUpperCase() ||
    "la langue source";
  return `Reception ${requestedTargetName} indisponible pour ce message. Lecture locale suspendue, texte affiche en ${actualName}.`;
};

const buildTranslationCacheKey = (
  text: string,
  fromCode?: string,
  toCode?: string
) => {
  const normalizedText = text.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedFrom = (fromCode || "auto").trim().toLowerCase() || "auto";
  const normalizedTo = (toCode || "auto").trim().toLowerCase() || "auto";
  return `${normalizedFrom}->${normalizedTo}:${normalizedText}`;
};

const upsertLruValue = (
  cache: Map<string, string>,
  key: string,
  value: string,
  limit: number
) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > limit) {
    const first = cache.keys().next().value;
    if (typeof first === "string") cache.delete(first);
  }
};

const buildTranslationRequestTuning = (text: string) => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const maxTokens = Math.max(96, Math.min(260, Math.round(words * 2.2) + 64));
  return {
    maxTokens,
    temperature: 0.1,
    timeoutMs: 14_000,
  };
};

const getCaptionThrottleMs = (text: string) => {
  const length = text.trim().length;
  if (length <= 24) return 240;
  if (length <= 80) return 300;
  return 360;
};

const playChatNotificationTone = () => {
  if (typeof window === "undefined") return;
  const maybeWindow = window as Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = maybeWindow.AudioContext || maybeWindow.webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.03, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
    oscillator.onended = () => {
      void context.close().catch(() => {});
    };
  } catch {
    // Ignore audio cue failures on browsers requiring extra gestures.
  }
};

const buildLanguageDescriptor = (name: string, code?: string) => {
  const normalizedCode = (code || "").trim().toLowerCase();
  const resolvedNameFromCode = resolveLanguageNameFromCode(normalizedCode);
  const normalizedName = name.trim();
  const finalName = resolvedNameFromCode || normalizedName || (normalizedCode ? normalizedCode.toUpperCase() : "Unknown");
  const finalCode = normalizedCode || "";
  const label = finalCode ? `${finalName} (${finalCode.toUpperCase()})` : finalName;
  return {
    code: finalCode,
    name: finalName,
    label,
  };
};

const buildTranslateMessages = (
  text: string,
  from: string,
  to: string,
  fromCode?: string,
  toCode?: string
) => {
  const source = buildLanguageDescriptor(from, fromCode);
  const target = buildLanguageDescriptor(to, toCode);
  const sameLanguage =
    Boolean(source.code && target.code && source.code === target.code) ||
    source.name.toLowerCase() === target.name.toLowerCase();

  const systemPrompt = sameLanguage
    ? `Source and target language are the same (${source.label}). Return the input unchanged.`
    : `You are a strict translator. Translate from ${source.label} to ${target.label}. Output only the translated text in ${target.label}, never in the source language, no explanations, no quotes.`;

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: text,
    },
  ];
};

const buildPhoneticMessages = (text: string, target: string, targetCode?: string) => {
  const targetLanguage = buildLanguageDescriptor(target, targetCode);
  return [
    {
      role: "system",
      content: `You are a pronunciation assistant. Convert the input text written in ${targetLanguage.label} into Latin-script phonetic pronunciation. Do not translate. Return only the phonetic text, preserving punctuation and sentence order.`,
    },
    {
      role: "user",
      content: text,
    },
  ];
};

const buildPhoneticBatchMessages = (
  texts: string[],
  target: string,
  targetCode?: string
) => {
  const targetLanguage = buildLanguageDescriptor(target, targetCode);
  return [
    {
      role: "system",
      content: [
        "You are a pronunciation assistant.",
        `For each input item written in ${targetLanguage.label}, convert it into Latin-script phonetic pronunciation.`,
        "Do not translate.",
        'Return valid JSON only with the exact shape {"items":[{"text":"original","phonetic":"latin phonetic"}]}.',
        'Copy each original input exactly into the "text" field and preserve input order.',
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({ items: texts }),
    },
  ];
};

const buildPushToTalkDraftReviewMessages = (
  text: string,
  target: string,
  targetCode?: string,
  mode: PushToTalkDraftReviewMode = "coach",
  captureSource: PushToTalkDraftCaptureSource = "speech"
) => {
  const targetLanguage = buildLanguageDescriptor(target, targetCode);
  const isTranslationReview = mode === "translation";
  const isRecordedAudioReview = captureSource === "recording";
  return [
    {
      role: "system",
      content: [
        isTranslationReview
          ? "You review a speech-to-text transcript before it is translated and sent in a video conference."
          : "You are a language coach reviewing a speech-to-text transcript before it is sent.",
        `Working language: ${targetLanguage.label}.`,
        "Return valid JSON only.",
        'Use the exact shape {"status":"ok|review|unclear","message":"short French message","correctedText":"","naturalText":"","familiarText":""}.',
        'The "message" must be short, clear, and in French.',
        isTranslationReview
          ? 'Do not mention any coach, AI, or assistant in the "message".'
          : 'You may mention the coach in the "message" when useful.',
        "All suggested sentences must stay in the working language, never in French.",
        isRecordedAudioReview
          ? "This transcript comes from a recorded web audio clip and may contain speech-recognition mistakes."
          : "",
        isTranslationReview
          ? 'Use status "ok" only when the sentence is understandable and acceptable enough to translate and send as-is.'
          : 'Use status "ok" only when the sentence is understandable and acceptable enough to send as-is.',
        isRecordedAudioReview
          ? 'Be conservative: prefer status "review" or "unclear" unless the sentence is clearly correct and safe to send.'
          : "",
        'Use status "review" when the sentence is understandable but incorrect, awkward, or unnatural.',
        'Use status "unclear" when the transcript likely contains speech-recognition mistakes or is hard to understand.',
        "correctedText must be the minimal corrected version.",
        "naturalText should be a smoother, more natural version.",
        "familiarText should be an optional colloquial variant when relevant.",
      ].join(" "),
    },
    {
      role: "user",
      content: text.trim(),
    },
  ];
};

const toFriendlyAiError = (message: string) => {
  const normalized = (message || "").trim();
  if (/unauthorized|401/i.test(normalized)) {
    return "Session expiree. Reconnecte-toi puis reessaie.";
  }
  if (/forbidden|403/i.test(normalized)) {
    return "Acces refuse a la traduction pour ce compte.";
  }
  if (/insufficient_quota|quota|billing|credits?.*epuise/i.test(normalized)) {
    return "Quota API voix/traduction epuise temporairement. Recharge le billing OpenAI.";
  }
  if (/rate limit|429/i.test(normalized)) {
    return "Limite atteinte. Reessaie dans quelques secondes.";
  }
  return normalized || "Service de traduction indisponible.";
};

const readApiErrorMessage = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return `${response.status} ${response.statusText}`.trim() || "Erreur serveur.";
  }
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
};

const isBackgroundEffectsBlockedOnBrowser = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIosWebKit = isAppleTouchPlatform() && /AppleWebKit/i.test(ua);
  return isIosWebKit;
};

async function fetchStreamedOpenAI(
  messages: unknown,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  guestToken?: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    intent?: "translation" | "default";
  }
) {
  const authHeader = await getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader,
  };
  if (!authHeader.Authorization && guestToken?.trim()) {
    headers["x-bfzoom-guest-tts-token"] = guestToken.trim();
  }
  const res = await fetch("/api/openai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages,
      stream: true,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      timeoutMs: options?.timeoutMs,
      intent: options?.intent,
    }),
    signal,
  });

  if (!res.ok) {
    const errorPayload = await res.json().catch(() => ({}));
    throw new Error(
      (errorPayload as { error?: string })?.error || "Erreur de streaming OpenAI"
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Flux non disponible");
  }

  const decoder = new TextDecoder();
  let accumulated = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      accumulated += chunk;
      onChunk(chunk);
    }
  }

  return accumulated;
}

const translateWithOpenAi = async (
  text: string,
  from: string,
  to: string,
  {
    onChunk,
    signal,
    fromCode,
    toCode,
    guestToken,
    maxTokens,
    temperature,
    timeoutMs,
    intent = "translation",
  }: TranslateWithOpenAIOptions = {}
) => {
  if (!process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
    // Keep backwards compatibility for environments where the key is only server-side.
  }
  const tuning = buildTranslationRequestTuning(text);
  const requestMaxTokens = Number.isFinite(maxTokens) ? maxTokens : tuning.maxTokens;
  const requestTemperature = Number.isFinite(temperature)
    ? temperature
    : tuning.temperature;
  const requestTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : tuning.timeoutMs;

  if (onChunk) {
    return fetchStreamedOpenAI(
      buildTranslateMessages(text, from, to, fromCode, toCode),
      onChunk,
      signal,
      guestToken,
      {
        maxTokens: requestMaxTokens,
        temperature: requestTemperature,
        timeoutMs: requestTimeoutMs,
        intent,
      }
    );
  }

  const authHeader = await getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader,
  };
  if (!authHeader.Authorization && guestToken?.trim()) {
    headers["x-bfzoom-guest-tts-token"] = guestToken.trim();
  }
  const res = await fetch("/api/openai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: buildTranslateMessages(text, from, to, fromCode, toCode),
      maxTokens: requestMaxTokens,
      temperature: requestTemperature,
      timeoutMs: requestTimeoutMs,
      intent,
    }),
    signal,
  });
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    if (!res.ok) throw new Error(raw || "Erreur traduction");
  }
  if (!res.ok) {
    const errMessage = (data as { error?: string })?.error || "Erreur traduction";
    throw new Error(errMessage);
  }
  const choice = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0];
  return choice?.message?.content?.trim() || "";
};

const phoneticWithOpenAi = async (
  text: string,
  target: string,
  { signal, targetCode, guestToken }: PhoneticWithOpenAIOptions = {}
) => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const authHeader = await getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader,
  };
  if (!authHeader.Authorization && guestToken?.trim()) {
    headers["x-bfzoom-guest-tts-token"] = guestToken.trim();
  }
  const response = await fetch("/api/openai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: buildPhoneticMessages(trimmed, target, targetCode),
    }),
    signal,
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    if (!response.ok) throw new Error(raw || "Erreur phonetique");
  }
  if (!response.ok) {
    const errMessage = (data as { error?: string })?.error || "Erreur phonetique";
    throw new Error(errMessage);
  }
  const choice = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0];
  return choice?.message?.content?.trim() || "";
};

const phoneticBatchWithOpenAi = async (
  texts: string[],
  target: string,
  { signal, targetCode, guestToken }: PhoneticWithOpenAIOptions = {}
) => {
  const uniqueTexts = Array.from(
    new Set(
      texts
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  if (uniqueTexts.length === 0) return new Map<string, string>();

  const authHeader = await getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader,
  };
  if (!authHeader.Authorization && guestToken?.trim()) {
    headers["x-bfzoom-guest-tts-token"] = guestToken.trim();
  }
  const response = await fetch("/api/openai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: buildPhoneticBatchMessages(uniqueTexts, target, targetCode),
      jsonMode: true,
      maxTokens: Math.max(220, Math.min(700, uniqueTexts.length * 70)),
      temperature: 0.1,
      timeoutMs: 16_000,
    }),
    signal,
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    if (!response.ok) throw new Error(raw || "Erreur phonetique");
  }
  if (!response.ok) {
    const errMessage = (data as { error?: string })?.error || "Erreur phonetique";
    throw new Error(errMessage);
  }

  const content = String(
    (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content || ""
  ).trim();
  if (!content) return new Map<string, string>();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return new Map<string, string>();
  }

  const items = Array.isArray((parsed as { items?: unknown[] })?.items)
    ? ((parsed as { items: unknown[] }).items as Array<{ text?: unknown; phonetic?: unknown }>)
    : [];
  const results = new Map<string, string>();
  for (const item of items) {
    const sourceText = String(item?.text || "").trim();
    const phoneticText = String(item?.phonetic || "").trim();
    if (!sourceText) continue;
    results.set(sourceText, phoneticText);
  }
  return results;
};

const reviewPushToTalkDraftWithOpenAi = async (
  text: string,
  target: string,
  {
    signal,
    targetCode,
    guestToken,
    mode = "coach",
    captureSource = "speech",
  }: PhoneticWithOpenAIOptions & {
    mode?: PushToTalkDraftReviewMode;
    captureSource?: PushToTalkDraftCaptureSource;
  } = {}
) => {
  const trimmed = text.trim();
  const isTranslationReview = mode === "translation";
  if (!trimmed) {
    return {
      status: "unclear" as PushToTalkDraftReviewStatus,
      message: "Le texte capte semble incomplet.",
      correctedText: "",
      naturalText: "",
      familiarText: "",
      reviewedText: "",
    };
  }
  const authHeader = await getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader,
  };
  if (!authHeader.Authorization && guestToken?.trim()) {
    headers["x-bfzoom-guest-tts-token"] = guestToken.trim();
  }
  const response = await fetch("/api/openai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: buildPushToTalkDraftReviewMessages(
        trimmed,
        target,
        targetCode,
        mode,
        captureSource
      ),
      jsonMode: true,
      maxTokens: 260,
      temperature: 0.1,
      timeoutMs: 12_000,
      intent: "coach_ai",
    }),
    signal,
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    if (!response.ok) throw new Error(raw || "Erreur d'analyse avant envoi");
  }
  if (!response.ok) {
    const errMessage = (data as { error?: string })?.error || "Erreur d'analyse avant envoi";
    throw new Error(errMessage);
  }
  const content = String(
    (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content || ""
  ).trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }

  const rawStatus = String((parsed as { status?: unknown })?.status || "").trim().toLowerCase();
  const status: PushToTalkDraftReviewStatus =
    rawStatus === "ok" || rawStatus === "review" || rawStatus === "unclear"
      ? (rawStatus as PushToTalkDraftReviewStatus)
      : "review";
  const message = String((parsed as { message?: unknown })?.message || "").trim();
  return {
    status,
    message:
      message ||
      (status === "ok"
        ? "La phrase semble correcte."
        : status === "unclear"
        ? isTranslationReview
          ? "La phrase semble avoir ete mal captee."
          : "Le coach pense que la phrase a ete mal captee."
        : isTranslationReview
        ? "Une correction est recommandee avant traduction."
        : "Le coach recommande une correction avant envoi."),
    correctedText: sanitizePushToTalkDraftSuggestion(
      String((parsed as { correctedText?: unknown })?.correctedText || ""),
      trimmed
    ),
    naturalText: sanitizePushToTalkDraftSuggestion(
      String((parsed as { naturalText?: unknown })?.naturalText || ""),
      trimmed
    ),
    familiarText: sanitizePushToTalkDraftSuggestion(
      String((parsed as { familiarText?: unknown })?.familiarText || ""),
      trimmed
    ),
    reviewedText: trimmed,
  };
};

const downsampleBuffer = (buffer: Float32Array, inputRate: number, outputRate: number) => {
  if (outputRate === inputRate) return buffer;
  const sampleRateRatio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
};

function useGuestCaptionPlayer(
  voice: string,
  onPlaybackIssue?: (message: string) => void,
  guestTtsToken?: string
) {
  const guestAudioRef = useRef<HTMLAudioElement | null>(null);
  const guestAudioUrlRef = useRef<string | null>(null);
  const guestWebAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const unlockContextRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const playbackIssueNotifiedRef = useRef(false);
  const pendingPlaybackRef = useRef<{ text: string; target?: CaptionTargetCode } | null>(null);
  const playCaptionRef = useRef<((text: string, target?: CaptionTargetCode) => Promise<void>) | null>(
    null
  );
  const replayingPendingRef = useRef(false);
  const playbackChainRef = useRef<Promise<void>>(Promise.resolve());
  const playbackGenerationRef = useRef(0);
  const activePlaybackCancelRef = useRef<(() => void) | null>(null);
  const activeTtsAbortRef = useRef<AbortController | null>(null);

  const clearPlaybackIssue = useCallback(() => {
    playbackIssueNotifiedRef.current = false;
  }, []);

  const notifyPlaybackIssue = useCallback(
    (message: string) => {
      if (playbackIssueNotifiedRef.current) return;
      playbackIssueNotifiedRef.current = true;
      onPlaybackIssue?.(message);
    },
    [onPlaybackIssue]
  );

  const releaseGuestAudioUrl = useCallback(() => {
    if (!guestAudioUrlRef.current) return;
    URL.revokeObjectURL(guestAudioUrlRef.current);
    guestAudioUrlRef.current = null;
  }, []);

  const clearActivePlaybackCancel = useCallback((cancel?: (() => void) | null) => {
    if (!cancel || activePlaybackCancelRef.current === cancel) {
      activePlaybackCancelRef.current = null;
    }
  }, []);

  const stopGuestWebAudio = useCallback(() => {
    const source = guestWebAudioSourceRef.current;
    guestWebAudioSourceRef.current = null;
    if (!source) return;
    try {
      source.stop();
    } catch {}
    try {
      source.disconnect();
    } catch {}
  }, []);

  const isAbortError = useCallback((error: unknown) => {
    if (error instanceof DOMException) {
      return error.name === "AbortError";
    }
    return (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    );
  }, []);

  const unlockGuestAudio = useCallback(async () => {
    if (typeof window === "undefined") return false;
    if (audioUnlockedRef.current) return true;

    const maybeWindow = window as Window & typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = maybeWindow.AudioContext || maybeWindow.webkitAudioContext;
    if (!AudioContextCtor) {
      audioUnlockedRef.current = true;
      return true;
    }

    try {
      const context = unlockContextRef.current ?? new AudioContextCtor();
      unlockContextRef.current = context;
      if (context.state === "suspended") {
        await context.resume();
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.01);
      audioUnlockedRef.current = true;
      return true;
    } catch {
      return false;
    }
  }, []);

  const playWithSpeechSynthesis = useCallback(async (
    text: string,
    target?: CaptionTargetCode,
    isCurrentPlayback?: () => boolean
  ) => {
    if (typeof window === "undefined") return false;
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      return false;
    }
    if (isCurrentPlayback && !isCurrentPlayback()) return false;

    try {
      const speech = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const preferredLocale = target ? SPEECH_LANG_BY_TARGET[target] : "";
      if (preferredLocale) {
        utterance.lang = preferredLocale;
      }
      const availableVoices = speech.getVoices();
      if (availableVoices.length) {
        const preferredLower = preferredLocale.toLowerCase();
        const preferredPrefix = preferredLower.split("-")[0];
        const preferredVoice = preferredLocale
          ? availableVoices.find((item) => item.lang?.toLowerCase() === preferredLower) ||
            availableVoices.find((item) =>
              item.lang?.toLowerCase().startsWith(preferredPrefix)
            )
          : null;
        if (preferredLocale && !preferredVoice) {
          // No local voice for this target language: report failure so caller can keep server TTS path.
          return false;
        }
        const selectedVoice =
          preferredVoice ||
          availableVoices.find((item) => item.default) ||
          availableVoices[0];
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang || utterance.lang;
        }
      }

      guestAudioRef.current?.pause();
      releaseGuestAudioUrl();
      guestAudioRef.current = null;
      stopGuestWebAudio();
      speech.cancel();

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        let startTimeoutId = 0;
        let endTimeoutId = 0;
        const cancelPlayback = () => {
          try {
            speech.cancel();
          } catch {}
          finish(false);
        };
        activePlaybackCancelRef.current = cancelPlayback;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearActivePlaybackCancel(cancelPlayback);
          window.clearTimeout(startTimeoutId);
          window.clearTimeout(endTimeoutId);
          utterance.onstart = null;
          utterance.onend = null;
          utterance.onerror = null;
          resolve(ok && (!isCurrentPlayback || isCurrentPlayback()));
        };
        if (isCurrentPlayback && !isCurrentPlayback()) {
          finish(false);
          return;
        }
        startTimeoutId = window.setTimeout(() => finish(false), 2600);
        utterance.onstart = () => {
          window.clearTimeout(startTimeoutId);
          // Safety timeout in case onend never fires on some engines.
          endTimeoutId = window.setTimeout(() => finish(false), 60000);
        };
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        speech.speak(utterance);
      });
    } catch {
      return false;
    }
  }, [clearActivePlaybackCancel, releaseGuestAudioUrl, stopGuestWebAudio]);

  const hasLocalVoiceForTarget = useCallback((target?: CaptionTargetCode) => {
    if (!target || typeof window === "undefined") return true;
    if (!("speechSynthesis" in window)) return false;
    const preferredLocale = SPEECH_LANG_BY_TARGET[target] || "";
    if (!preferredLocale) return true;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
      // Voice list can be lazy-loaded by browser; keep optimistic in this case.
      return true;
    }
    const preferredLower = preferredLocale.toLowerCase();
    const preferredPrefix = preferredLower.split("-")[0];
    return voices.some((item) => {
      const lang = (item.lang || "").toLowerCase();
      return lang === preferredLower || lang.startsWith(preferredPrefix);
    });
  }, []);

  const playWithWebAudio = useCallback(async (
    audioData: ArrayBuffer,
    isCurrentPlayback?: () => boolean
  ) => {
    if (typeof window === "undefined") return false;
    const maybeWindow = window as Window & typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = maybeWindow.AudioContext || maybeWindow.webkitAudioContext;
    if (!AudioContextCtor) return false;
    if (isCurrentPlayback && !isCurrentPlayback()) return false;
    try {
      const context = unlockContextRef.current ?? new AudioContextCtor();
      unlockContextRef.current = context;
      if (context.state === "suspended") {
        await context.resume();
      }
      if (context.state !== "running") {
        return false;
      }
      const decoded = await context.decodeAudioData(audioData.slice(0));
      if (isCurrentPlayback && !isCurrentPlayback()) {
        return false;
      }
      await new Promise<void>((resolve) => {
        const source = context.createBufferSource();
        guestWebAudioSourceRef.current = source;
        source.buffer = decoded;
        source.connect(context.destination);
        const finish = () => {
          clearActivePlaybackCancel(cancelPlayback);
          if (guestWebAudioSourceRef.current === source) {
            guestWebAudioSourceRef.current = null;
          }
          try {
            source.disconnect();
          } catch {}
          resolve();
        };
        const cancelPlayback = () => {
          try {
            source.stop();
          } catch {}
          finish();
        };
        activePlaybackCancelRef.current = cancelPlayback;
        source.onended = () => {
          finish();
        };
        if (isCurrentPlayback && !isCurrentPlayback()) {
          cancelPlayback();
          return;
        }
        source.start();
      });
      return !isCurrentPlayback || isCurrentPlayback();
    } catch {
      return false;
    }
  }, [clearActivePlaybackCancel]);

  const playWithHtmlAudio = useCallback(async (
    audioBlob: Blob,
    target?: CaptionTargetCode,
    isCurrentPlayback?: () => boolean
  ) => {
    if (typeof window === "undefined") return false;
    if (isCurrentPlayback && !isCurrentPlayback()) return false;
    try {
      const url = URL.createObjectURL(audioBlob);
      guestAudioRef.current?.pause();
      releaseGuestAudioUrl();
      stopGuestWebAudio();
      let audio = guestAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.autoplay = true;
        audio.muted = false;
        audio.volume = 1;
        audio.setAttribute("playsinline", "true");
        audio.setAttribute("webkit-playsinline", "true");
        guestAudioRef.current = audio;
      }
      if (target && SPEECH_LANG_BY_TARGET[target]) {
        audio.lang = SPEECH_LANG_BY_TARGET[target];
      }
      guestAudioUrlRef.current = url;
      audio.src = url;
      audio.currentTime = 0;
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        let timeoutId = 0;
        const cleanup = () => {
          audio?.removeEventListener("ended", onEnded);
          audio?.removeEventListener("error", onError);
          audio?.removeEventListener("stalled", onError);
          audio?.removeEventListener("abort", onError);
          window.clearTimeout(timeoutId);
        };
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearActivePlaybackCancel(cancelPlayback);
          cleanup();
          resolve(ok && (!isCurrentPlayback || isCurrentPlayback()));
        };
        const cancelPlayback = () => {
          try {
            audio?.pause();
            if (audio) {
              audio.currentTime = 0;
            }
          } catch {}
          finish(false);
        };
        activePlaybackCancelRef.current = cancelPlayback;
        const onEnded = () => finish(true);
        const onError = () => cancelPlayback();
        audio.addEventListener("ended", onEnded, { once: true });
        audio.addEventListener("error", onError, { once: true });
        audio.addEventListener("stalled", onError, { once: true });
        audio.addEventListener("abort", onError, { once: true });
        timeoutId = window.setTimeout(() => cancelPlayback(), 60000);
        if (isCurrentPlayback && !isCurrentPlayback()) {
          finish(false);
          return;
        }
        void audio.play().catch(() => {
          finish(false);
        });
      });
    } catch {
      releaseGuestAudioUrl();
      return false;
    }
  }, [clearActivePlaybackCancel, releaseGuestAudioUrl, stopGuestWebAudio]);

  const playCaption = useCallback(
    async (text: string, target?: CaptionTargetCode, generation = playbackGenerationRef.current) => {
      const trimmedText = text.trim();
      if (!trimmedText) return;
      const isCurrentPlayback = () => playbackGenerationRef.current === generation;
      if (!isCurrentPlayback()) return;
      const fallbackMessage =
        "Audio iPhone/iPad bloque. Touche l'ecran une fois pour activer l'audio, puis reessaie.";
      const rememberForUserTap = (message = fallbackMessage) => {
        if (!isCurrentPlayback()) return;
        pendingPlaybackRef.current = { text: trimmedText, target };
        notifyPlaybackIssue(message);
      };
      let ttsAbortController: AbortController | null = null;
      try {
        const authHeader = await getAuthHeader({ forceRefresh: true });
        if (!isCurrentPlayback()) return;
        const guestToken = guestTtsToken?.trim();
        const ttsHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...authHeader,
        };
        if (guestToken) {
          ttsHeaders["x-bfzoom-guest-tts-token"] = guestToken;
        }
        const hasServerTtsAuthorization = Boolean(
          ttsHeaders.Authorization || ttsHeaders["x-bfzoom-guest-tts-token"]
        );

        if (!hasServerTtsAuthorization) {
          await unlockGuestAudio();
          if (!isCurrentPlayback()) return;
          const spoken = await playWithSpeechSynthesis(trimmedText, target, isCurrentPlayback);
          if (!isCurrentPlayback()) return;
          if (!spoken) {
            const targetName =
              resolveLanguageNameFromCode(target) || target?.toUpperCase() || "cette langue";
            const localVoiceMissing = target ? !hasLocalVoiceForTarget(target) : false;
            rememberForUserTap(
              localVoiceMissing
                ? `Voix locale indisponible pour ${targetName}. Rejoins la room pour renouveler le TTS serveur.`
                : fallbackMessage
            );
          } else {
            pendingPlaybackRef.current = null;
            clearPlaybackIssue();
          }
          return;
        }
        ttsAbortController = new AbortController();
        activeTtsAbortRef.current?.abort();
        activeTtsAbortRef.current = ttsAbortController;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: ttsHeaders,
          signal: ttsAbortController.signal,
          body: JSON.stringify({ text: trimmedText, voice, format: "mp3" }),
        });
        if (activeTtsAbortRef.current === ttsAbortController) {
          activeTtsAbortRef.current = null;
        }
        if (!isCurrentPlayback()) return;
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          if (!isCurrentPlayback()) return;
          const serverMessage = toFriendlyAiError(data?.error || "Erreur TTS serveur.");
          console.warn("Guest server TTS failed", data?.error || `HTTP ${res.status}`);
          const spoken = await playWithSpeechSynthesis(trimmedText, target, isCurrentPlayback);
          if (!isCurrentPlayback()) return;
          if (spoken) {
            pendingPlaybackRef.current = null;
            clearPlaybackIssue();
            return;
          }
          const targetName =
            resolveLanguageNameFromCode(target) || target?.toUpperCase() || "cette langue";
          const localVoiceMissing = target ? !hasLocalVoiceForTarget(target) : false;
          throw new Error(
            localVoiceMissing
              ? `TTS serveur indisponible (${serverMessage}) et voix locale absente pour ${targetName}.`
              : `TTS serveur indisponible (${serverMessage}).`
          );
        }
        const audioBlob = await res.blob();
        if (!isCurrentPlayback()) return;
        await unlockGuestAudio();
        if (!isCurrentPlayback()) return;
        const played =
          (await playWithHtmlAudio(audioBlob, target, isCurrentPlayback)) ||
          (await playWithWebAudio(await audioBlob.arrayBuffer(), isCurrentPlayback));
        if (!isCurrentPlayback()) return;
        if (played) {
          pendingPlaybackRef.current = null;
          clearPlaybackIssue();
          return;
        }
        const spoken = await playWithSpeechSynthesis(trimmedText, target, isCurrentPlayback);
        if (!isCurrentPlayback()) return;
        if (!spoken) {
          rememberForUserTap();
        } else {
          pendingPlaybackRef.current = null;
          clearPlaybackIssue();
        }
      } catch (err) {
        if (activeTtsAbortRef.current === ttsAbortController) {
          activeTtsAbortRef.current = null;
        }
        if (isAbortError(err) || !isCurrentPlayback()) {
          return;
        }
        const spoken = await playWithSpeechSynthesis(trimmedText, target, isCurrentPlayback);
        if (!isCurrentPlayback()) return;
        if (spoken) {
          pendingPlaybackRef.current = null;
          clearPlaybackIssue();
          return;
        }
        const message = err instanceof Error ? err.message : "Erreur TTS locale";
        rememberForUserTap(toFriendlyAiError(message));
        console.warn("Guest TTS failed", err);
      }
    },
    [
      clearPlaybackIssue,
      playWithHtmlAudio,
      hasLocalVoiceForTarget,
      isAbortError,
      notifyPlaybackIssue,
      playWithWebAudio,
      playWithSpeechSynthesis,
      unlockGuestAudio,
      guestTtsToken,
      voice,
    ]
  );

  useEffect(() => {
    const enqueuePlayback = async (text: string, target?: CaptionTargetCode) => {
      const generation = playbackGenerationRef.current;
      const next = playbackChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (playbackGenerationRef.current !== generation) return;
          await playCaption(text, target, generation);
        });
      playbackChainRef.current = next;
      await next;
    };
    playCaptionRef.current = enqueuePlayback;
    return () => {
      playCaptionRef.current = null;
    };
  }, [playCaption]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFirstInteraction = () => {
      void (async () => {
        await unlockGuestAudio();
        const pending = pendingPlaybackRef.current;
        if (!pending || replayingPendingRef.current) return;
        replayingPendingRef.current = true;
        pendingPlaybackRef.current = null;
        try {
          await playCaptionRef.current?.(pending.text, pending.target);
        } finally {
          replayingPendingRef.current = false;
        }
      })();
    };
    window.addEventListener("pointerdown", handleFirstInteraction, { passive: true });
    window.addEventListener("touchstart", handleFirstInteraction, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
      activeTtsAbortRef.current?.abort();
      activeTtsAbortRef.current = null;
      activePlaybackCancelRef.current?.();
      clearActivePlaybackCancel();
      releaseGuestAudioUrl();
      guestAudioRef.current?.pause();
      guestAudioRef.current = null;
      stopGuestWebAudio();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (unlockContextRef.current) {
        void unlockContextRef.current.close();
        unlockContextRef.current = null;
      }
      pendingPlaybackRef.current = null;
      replayingPendingRef.current = false;
      playbackChainRef.current = Promise.resolve();
    };
  }, [clearActivePlaybackCancel, releaseGuestAudioUrl, stopGuestWebAudio, unlockGuestAudio]);

  const speakCaption = useCallback(async (text: string, target?: CaptionTargetCode) => {
    const generation = playbackGenerationRef.current;
    const next = playbackChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (playbackGenerationRef.current !== generation) return;
        await playCaption(text, target, generation);
      });
    playbackChainRef.current = next;
    await next;
  }, [playCaption]);

  const stopCaptionPlayback = useCallback(() => {
    playbackGenerationRef.current += 1;
    pendingPlaybackRef.current = null;
    replayingPendingRef.current = false;
    playbackChainRef.current = Promise.resolve();
    activeTtsAbortRef.current?.abort();
    activeTtsAbortRef.current = null;
    activePlaybackCancelRef.current?.();
    clearActivePlaybackCancel();
    guestAudioRef.current?.pause();
    if (guestAudioRef.current) {
      guestAudioRef.current.currentTime = 0;
    }
    stopGuestWebAudio();
    releaseGuestAudioUrl();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [clearActivePlaybackCancel, releaseGuestAudioUrl, stopGuestWebAudio]);

  return {
    speakCaption,
    stopCaptionPlayback,
  };
}

const useAnnotationOverlay = () => {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const annotationsRef = useRef<AnnotationEntry[]>([]);
  const lastCanvasSizeRef = useRef({ width: 0, height: 0 });
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [brushColor, setBrushColor] = useState("#f87171");
  const [brushWidth, setBrushWidth] = useState(3);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<number | null>(null);
  const drawingEnabledRef = useRef(drawingEnabled);
  const brushColorRef = useRef(brushColor);
  const brushWidthRef = useRef(brushWidth);
  useEffect(() => {
    drawingEnabledRef.current = drawingEnabled;
  }, [drawingEnabled]);
  useEffect(() => {
    brushColorRef.current = brushColor;
  }, [brushColor]);
  useEffect(() => {
    brushWidthRef.current = brushWidth;
  }, [brushWidth]);

  const drawToCanvas = useCallback((items: AnnotationEntry[]) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    items.forEach((item) => {
      if (item.type === "stroke") {
        if (item.points.length === 0) return;
        ctx.beginPath();
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        item.points.forEach((point, index) => {
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();
      } else {
        ctx.fillStyle = item.color;
        ctx.font = `${item.fontSize}px "Inter", "Segoe UI", sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(item.text, item.x * canvas.width, item.y * canvas.height);
      }
    });
  }, []);

  const updateAnnotations = useCallback(
    (updater: (prev: AnnotationEntry[]) => AnnotationEntry[]) => {
      const next = updater(annotationsRef.current);
      annotationsRef.current = next;
      drawToCanvas(next);
      return next;
    },
    [drawToCanvas]
  );

  useEffect(() => {
    drawToCanvas(annotationsRef.current);
  }, [drawToCanvas]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width || 1;
      canvas.height = rect.height || 1;
      lastCanvasSizeRef.current = { width: canvas.width, height: canvas.height };
      drawToCanvas(annotationsRef.current);
    };
    resize();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (observer) {
      observer.observe(canvas);
      observer.observe(canvas.parentElement ?? canvas);
    }
    return () => {
      observer?.disconnect();
    };
  }, [drawToCanvas]);

  const getPointFromEvent = (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ): AnnotationPoint | null => {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pointEvent = "touches" in event ? event.touches[0] : event;
    if (!pointEvent) return null;
    const x = (pointEvent.clientX - rect.left) / rect.width;
    const y = (pointEvent.clientY - rect.top) / rect.height;
    return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
  };

  const handleAnnotationStart = useCallback(
    (event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
      if (!drawingEnabledRef.current) return;
      event.preventDefault();
      const point = getPointFromEvent(event);
      if (!point) return;
      updateAnnotations((prev) => {
    const stroke: AnnotationStroke = {
      type: "stroke",
      points: [point],
      color: brushColorRef.current,
      width: brushWidthRef.current,
    };
        currentStrokeRef.current = prev.length;
        return [...prev, stroke];
      });
      isDrawingRef.current = true;
    },
    [updateAnnotations]
  );

  const handleAnnotationMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
      if (!drawingEnabledRef.current || !isDrawingRef.current || currentStrokeRef.current === null) return;
      event.preventDefault();
      const point = getPointFromEvent(event);
      if (!point) return;
      updateAnnotations((prev) => {
        const index = currentStrokeRef.current;
        if (index === null || index >= prev.length) return prev;
        const next = [...prev];
          const prevStroke = next[index];
          if (prevStroke.type !== "stroke") return prev;
          const stroke = { ...prevStroke, points: [...prevStroke.points, point] };
          next[index] = stroke;
        return next;
      });
    },
    [updateAnnotations]
  );

  const stopAnnotation = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    currentStrokeRef.current = null;
  }, []);

  const undoAnnotation = useCallback(() => {
    updateAnnotations((prev) => prev.slice(0, -1));
  }, [updateAnnotations]);

  const clearAnnotations = useCallback(() => {
    updateAnnotations(() => []);
  }, [updateAnnotations]);

  const addTextEntry = useCallback(
    (entry: AnnotationText) => {
      updateAnnotations((prev) => [...prev, entry]);
    },
    [updateAnnotations]
  );

  const addStroke = useCallback(
    (stroke: AnnotationStroke) => {
      updateAnnotations((prev) => [...prev, stroke]);
    },
    [updateAnnotations]
  );

  const setAnnotations = useCallback(
    (entries: AnnotationEntry[]) => {
      annotationsRef.current = entries;
      drawToCanvas(entries);
    },
    [drawToCanvas]
  );

  const getAnnotations = useCallback(() => annotationsRef.current, []);
  const getLatestStroke = useCallback(() => {
    const next = annotationsRef.current;
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const entry = next[i];
      if (entry.type === "stroke") return entry;
    }
    return null;
  }, []);

  return {
    overlayRef,
    drawingEnabled,
    setDrawingEnabled,
    brushColor,
    setBrushColor,
    brushWidth,
    setBrushWidth,
    handleAnnotationStart,
    handleAnnotationMove,
    stopAnnotation,
    undoAnnotation,
    clearAnnotations,
    addStroke,
    addTextEntry,
    setAnnotations,
    getAnnotations,
    getLatestStroke,
  };
};

type AnnotationMessageBase = {
  roomId?: string;
};

type AnnotationStrokeMessage = AnnotationMessageBase & {
  type: "stroke";
  stroke: AnnotationStroke;
};

type AnnotationUndoMessage = AnnotationMessageBase & {
  type: "undo";
};

type AnnotationClearMessage = AnnotationMessageBase & {
  type: "clear";
};

type AnnotationSyncMessage = AnnotationMessageBase & {
  type: "sync";
  entries: AnnotationEntry[];
};

type AnnotationTextMessage = AnnotationMessageBase & {
  type: "text";
  entry: AnnotationText;
};

type AnnotationSyncRequestMessage = AnnotationMessageBase & {
  type: "sync-request";
};

type AnnotationMessage =
  | AnnotationStrokeMessage
  | AnnotationUndoMessage
  | AnnotationClearMessage
  | AnnotationSyncMessage
  | AnnotationTextMessage
  | AnnotationSyncRequestMessage;

const ANNOTATION_TOPIC = "bfzoom-annotations";

const useAnnotationSync = ({ roomId, isHost }: { roomId: string; isHost: boolean }) => {
  const annotationOverlay = useAnnotationOverlay();
  const { addStroke, addTextEntry, setAnnotations, getAnnotations, undoAnnotation, clearAnnotations } =
    annotationOverlay;
  const { message, send } = useDataChannel(ANNOTATION_TOPIC);
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant?.identity;
  const canSendAnnotations =
    room.state === ConnectionState.Connected ||
    room.state === ConnectionState.Reconnecting ||
    room.state === ConnectionState.SignalReconnecting;

  const broadcast = useCallback(
    async (payload: AnnotationMessage) => {
      if (!roomId || !send || !canSendAnnotations) return;
      const encoder = new TextEncoder();
      try {
        await send(
          encoder.encode(JSON.stringify({ roomId, ...payload })),
          {
            reliable: true,
            topic: ANNOTATION_TOPIC,
          }
        );
      } catch (err) {
        const errorName = (err as { name?: string } | null)?.name || "";
        const errorMessage =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
        if (
          errorName === "UnexpectedConnectionState" ||
          /UnexpectedConnectionState|PC manager is closed|connection.+closed/i.test(errorMessage)
        ) {
          return;
        }
        console.warn("Impossible d'envoyer la payload d'annotation", err);
      }
    },
    [canSendAnnotations, roomId, send]
  );

  useEffect(() => {
    if (!message?.payload) return;
    const decoder = new TextDecoder();
    try {
      const text = decoder.decode(message.payload);
      const payload = JSON.parse(text) as AnnotationMessage;
      if (payload.roomId && payload.roomId !== roomId) return;
      if (message.from?.identity && message.from.identity === localIdentity) return;
      switch (payload.type) {
        case "stroke":
          if (payload.stroke) {
            addStroke(payload.stroke);
          }
          break;
        case "text":
          if (payload.entry) {
            addTextEntry(payload.entry);
          }
          break;
        case "undo":
          undoAnnotation();
          break;
        case "clear":
          clearAnnotations();
          break;
        case "sync":
          if (Array.isArray(payload.entries)) {
            setAnnotations(payload.entries);
          }
          break;
        case "sync-request":
          if (isHost) {
            const entries = getAnnotations();
            void broadcast({ type: "sync", entries });
          }
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn("Annotation payload invalide", err);
    }
  }, [
    message,
    roomId,
    localIdentity,
    addStroke,
    addTextEntry,
    undoAnnotation,
    clearAnnotations,
    setAnnotations,
    isHost,
    broadcast,
    getAnnotations,
  ]);

  useEffect(() => {
    if (isHost) return;
    void broadcast({ type: "sync-request" });
  }, [isHost, broadcast]);

  const sendStroke = useCallback(
    (stroke: AnnotationStroke) => {
      if (!isHost || stroke.points.length === 0) return;
      void broadcast({ type: "stroke", stroke });
    },
    [isHost, broadcast]
  );

  const sendUndo = useCallback(() => {
    if (!isHost) return;
    void broadcast({ type: "undo" });
  }, [isHost, broadcast]);

  const sendClear = useCallback(() => {
    if (!isHost) return;
    void broadcast({ type: "clear" });
  }, [isHost, broadcast]);

  const sendTextEntry = useCallback(
    (entry: AnnotationText) => {
      if (!isHost) return;
      void broadcast({ type: "text", entry });
    },
    [isHost, broadcast]
  );

  return {
    ...annotationOverlay,
    sendStroke,
    sendUndo,
    sendClear,
    sendTextEntry,
  };
};

const useHostRoomHeartbeat = ({
  room,
  roomId,
  isHost,
  sessionMode,
}: {
  room: Room;
  roomId: string;
  isHost: boolean;
  sessionMode: "conference" | "chat";
}) => {
  const heartbeatInFlightRef = useRef(false);

  const sendHeartbeat = useCallback(async () => {
    if (!isHost || sessionMode !== "conference") return;
    if (!roomId.trim()) return;
    const canHeartbeat =
      room.state === ConnectionState.Connected ||
      room.state === ConnectionState.Reconnecting ||
      room.state === ConnectionState.SignalReconnecting;
    if (!canHeartbeat || heartbeatInFlightRef.current) return;

    heartbeatInFlightRef.current = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeoutId =
      typeof window === "undefined"
        ? null
        : window.setTimeout(() => controller?.abort(), ROOM_HEARTBEAT_TIMEOUT_MS);
    try {
      const authHeader = await getAuthHeader();
      if (!("Authorization" in authHeader) || !authHeader.Authorization) {
        return;
      }
      await fetch("/api/livekit/room/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({ room: roomId }),
        signal: controller?.signal,
        cache: "no-store",
      });
    } catch {
      // Heartbeat failure should not disrupt an active call.
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      heartbeatInFlightRef.current = false;
    }
  }, [isHost, room, roomId, sessionMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isHost || sessionMode !== "conference") return;
    void sendHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, ROOM_HEARTBEAT_INTERVAL_MS);
    const onPageShow = () => {
      void sendHeartbeat();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      heartbeatInFlightRef.current = false;
    };
  }, [isHost, sendHeartbeat, sessionMode]);
};

type AnnotationLayerProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  drawingEnabled: boolean;
  setDrawingEnabled: Dispatch<SetStateAction<boolean>>;
  brushColor: string;
  setBrushColor: (value: string) => void;
  brushWidth: number;
  setBrushWidth: (value: number) => void;
  handleAnnotationStart: (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ) => void;
  handleAnnotationMove: (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ) => void;
  stopAnnotation: () => void;
  undoAnnotation: () => void;
  clearAnnotations: () => void;
  onAnnotationStop?: () => void;
  onAnnotationUndo?: () => void;
  onAnnotationClear?: () => void;
  onAnnotationText?: (entry: AnnotationText) => void;
  isHost: boolean;
  drawerOpen: boolean;
};

type ControlTabId = "feutre" | "stickers";

type StickerLibraryItem = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: "sport" | "joie" | "mouvement";
  assetPath?: string;
};

type StickerInstance = {
  instanceId: string;
  stickerId: string;
  x: number;
  y: number;
};

const CONTROL_TABS: { id: ControlTabId; label: string }[] = [
  { id: "feutre", label: "Feutre" },
  { id: "stickers", label: "Stickers" },
];

const STICKER_LIBRARY: StickerLibraryItem[] = [
  {
    id: "sprint",
    label: "Sprint",
    emoji: "💨",
    description: "Dynamisme",
    category: "mouvement",
    assetPath: "/stickers/sprint.svg",
  },
  {
    id: "muscle",
    label: "Force",
    emoji: "💪",
    description: "Réussite",
    category: "sport",
    assetPath: "/stickers/muscle.svg",
  },
  {
    id: "trophy",
    label: "Succès",
    emoji: "🏆",
    description: "Victoire",
    category: "joie",
    assetPath: "/stickers/trophy.svg",
  },
  {
    id: "fire",
    label: "Énergie",
    emoji: "🔥",
    description: "Ardeur",
    category: "mouvement",
    assetPath: "/stickers/fire.svg",
  },
  {
    id: "cheer",
    label: "Bravo",
    emoji: "🎉",
    description: "Encouragement",
    category: "joie",
    assetPath: "/stickers/cheer.svg",
  },
  {
    id: "rocket",
    label: "Boost",
    emoji: "🚀",
    description: "Élan",
    category: "sport",
    assetPath: "/stickers/rocket.svg",
  },
  {
    id: "motion",
    label: "Mouvement",
    emoji: "🤸",
    description: "Souplesse",
    category: "mouvement",
    assetPath: "/stickers/motion.svg",
  },
  {
    id: "smile",
    label: "Sourire",
    emoji: "😁",
    description: "Motivation",
    category: "joie",
    assetPath: "/stickers/smile.svg",
  },
];

const AnnotationLayer = (props: AnnotationLayerProps) => {
  const {
    overlayRef,
    drawingEnabled,
    setDrawingEnabled,
    brushColor,
    setBrushColor,
    brushWidth,
    setBrushWidth,
    handleAnnotationStart,
    handleAnnotationMove,
    stopAnnotation,
    undoAnnotation,
    clearAnnotations,
    onAnnotationStop,
    onAnnotationUndo,
    onAnnotationClear,
    onAnnotationText,
    isHost,
  } = props;
  const [mode, setMode] = useState<"draw" | "text">("draw");
  const [textDraft, setTextDraft] = useState("");
  const [textAnchor, setTextAnchor] = useState<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevModeRef = useRef<"draw" | "text">(mode);
  useEffect(() => {
    if (mode === "text") {
      setDrawingEnabled(false);
    } else if (prevModeRef.current === "text") {
      setDrawingEnabled(true);
      setTextAnchor(null);
    }
    prevModeRef.current = mode;
  }, [mode, setDrawingEnabled]);

  useEffect(() => {
    if (textAnchor && inputRef.current) {
      inputRef.current.focus();
    }
  }, [textAnchor]);

  const commitText = () => {
    if (!textAnchor || !textDraft.trim()) {
      setTextAnchor(null);
      setTextDraft("");
      return;
    }
    const entry: AnnotationText = {
      type: "text",
      x: textAnchor.x,
      y: textAnchor.y,
      text: textDraft.trim(),
      color: brushColor,
      fontSize: Math.max(16, brushWidth * 4),
    };
    onAnnotationText?.(entry);
    setTextAnchor(null);
    setTextDraft("");
  };

  const cancelText = () => {
    setTextAnchor(null);
    setTextDraft("");
  };

  const [controlsOpen, setControlsOpen] = useState(false);
  const toggleControls = () => setControlsOpen((prev) => !prev);
  const [activeTab, setActiveTab] = useState<ControlTabId>("feutre");
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [stickersOnScreen, setStickersOnScreen] = useState<StickerInstance[]>([]);
  const [draggingStickerId, setDraggingStickerId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const selectedSticker = selectedStickerId
    ? STICKER_LIBRARY.find((item) => item.id === selectedStickerId)
    : null;

  useEffect(() => {
    if (!overlayRef.current) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingStickerId) return;
      event.preventDefault();
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const deltaX = event.clientX - rect.left - dragOffsetRef.current.x;
      const deltaY = event.clientY - rect.top - dragOffsetRef.current.y;
      const x = Math.min(1, Math.max(0, deltaX / rect.width));
      const y = Math.min(1, Math.max(0, deltaY / rect.height));
      setStickersOnScreen((prev) =>
        prev.map((instance) =>
          instance.instanceId === draggingStickerId
            ? { ...instance, x, y }
            : instance
        )
      );
    };
    const handlePointerUp = () => setDraggingStickerId(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingStickerId, overlayRef]);

  const handleStickerSelect = (stickerId: string) => {
    setSelectedStickerId(stickerId);
    setMode("draw");
    setStickersOnScreen((prev) => [
      ...prev,
      {
        instanceId: `${stickerId}-${Date.now().toString(36)}`,
        stickerId,
        x: 0.5,
        y: 0.5,
      },
    ]);
  };

  const handleStickerRemove = (instanceId: string) => {
    setStickersOnScreen((prev) => prev.filter((item) => item.instanceId !== instanceId));
  };

  const handleCanvasClick = (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ) => {
    if (mode === "draw") {
      handleAnnotationStart(event);
      return;
    }
    event.preventDefault();
    const canvas = overlayRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in event ? event.touches[0] : event;
    const x = (point.clientX - rect.left) / rect.width;
    const y = (point.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setTextAnchor({
      x,
      y,
      left: point.clientX,
      top: point.clientY,
    });
    setTextDraft("");
  };

  const handleCanvasMove = (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ) => {
    if (mode === "draw") {
      handleAnnotationMove(event);
    }
  };

  const handleCanvasUp = () => {
    if (mode === "draw") {
      stopAnnotation();
      onAnnotationStop?.();
    }
  };

  const handleUndo = () => {
    undoAnnotation();
    onAnnotationUndo?.();
  };

  const handleClear = () => {
    clearAnnotations();
    onAnnotationClear?.();
    setStickersOnScreen([]);
    setSelectedStickerId(null);
  };

  const overlayPointerEvents =
    drawingEnabled || mode === "text" || Boolean(draggingStickerId)
      ? "auto"
      : "none";
  const overlayCursor = draggingStickerId
    ? "grabbing"
    : drawingEnabled
    ? "crosshair"
    : mode === "text"
    ? "text"
    : "default";

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <canvas
        ref={overlayRef}
        className="h-full w-full"
        style={{
          pointerEvents: overlayPointerEvents,
          cursor: overlayCursor,
        }}
        onMouseDown={handleCanvasClick}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasUp}
        onMouseLeave={handleCanvasUp}
        onTouchStart={handleCanvasClick}
        onTouchMove={handleCanvasMove}
        onTouchEnd={handleCanvasUp}
      />
      {stickersOnScreen.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {stickersOnScreen.map((sticker) => {
            const meta = STICKER_LIBRARY.find((item) => item.id === sticker.stickerId);
            if (!meta) return null;
              return (
                <div
                  key={sticker.instanceId}
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                  style={{
                    left: `${sticker.x * 100}%`,
                    top: `${sticker.y * 100}%`,
                  }}
                >
                  <div
                    role="presentation"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = overlayRef.current?.getBoundingClientRect();
                      if (rect) {
                        const centerX = rect.left + sticker.x * rect.width;
                        const centerY = rect.top + sticker.y * rect.height;
                        dragOffsetRef.current = {
                          x: event.clientX - centerX,
                          y: event.clientY - centerY,
                        };
                      }
                      setDraggingStickerId(sticker.instanceId);
                    }}
                    className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/90 text-slate-900 shadow-lg transition hover:scale-110 hover:bg-white"
                    style={{ touchAction: "none" }}
                  >
                    {meta.assetPath ? (
                      <Image
                        src={meta.assetPath}
                        alt={meta.label}
                        width={56}
                        height={56}
                        className="h-full w-full object-contain"
                        draggable={false}
                        unoptimized
                      />
                    ) : (
                      <span className="text-3xl">{meta.emoji}</span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleStickerRemove(sticker.instanceId);
                      }}
                      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-semibold text-white shadow"
                      aria-label={`Supprimer ${meta.label}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
          })}
        </div>
      )}
      {textAnchor && (
        <input
          ref={inputRef}
          className="absolute z-40 rounded border border-slate-400 bg-white/90 px-2 py-1 text-sm"
          style={{
            left: textAnchor.left,
            top: textAnchor.top,
            transform: "translate(-50%, -100%)",
          }}
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitText();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelText();
            }
          }}
        />
      )}
      {isHost && ANNOTATION_TOOLS_ENABLED && (
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={toggleControls}
            className="rounded-full border border-white/40 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow backdrop-blur transition hover:bg-white/20"
          >
            <span aria-hidden className="text-lg leading-none">
              ⋮
            </span>
            <span className="sr-only">
              {controlsOpen
                ? "Masquer les outils de dessin"
                : "Afficher les outils de dessin"}
            </span>
          </button>
          {controlsOpen && !props.drawerOpen && (
            <motion.div
              drag
              dragMomentum={false}
              dragConstraints={{ left: -200, right: 200, top: -200, bottom: 200 }}
              className="w-72 space-y-3 rounded-3xl bg-black/70 px-3 py-3 text-white backdrop-blur shadow-2xl"
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                    drawingEnabled
                      ? "bg-sky-500 text-white shadow-lg"
                      : "bg-white/80 text-slate-900 shadow"
                  }`}
                  onClick={() => setDrawingEnabled((value) => !value)}
                >
                  {drawingEnabled ? "Feutre actif" : "Activer le feutre"}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-slate-900 shadow"
                  onClick={handleUndo}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-slate-900 shadow"
                  onClick={handleClear}
                >
                  Effacer tout
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {CONTROL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
                      activeTab === tab.id
                        ? "bg-white text-slate-900 shadow"
                        : "bg-white/10 text-white/70"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {activeTab === "feutre" && (
                  <div className="space-y-3">
                    <label className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em]">
                      <span>Couleur</span>
                      <input
                        type="color"
                        value={brushColor}
                        onChange={(event) => setBrushColor(event.target.value)}
                        className="h-6 w-8 cursor-pointer rounded border border-white/40 bg-white/10 p-0"
                      />
                    </label>
                    <label className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em]">
                      <span>Épaisseur</span>
                      <input
                        type="range"
                        min={1}
                        max={12}
                        value={brushWidth}
                        onChange={(event) => setBrushWidth(Number(event.target.value))}
                        className="h-2 w-24 cursor-pointer accent-white"
                      />
                    </label>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/70">
                      {drawingEnabled
                        ? "Dessine librement puis efface si besoin"
                        : "Active le feutre pour dessiner"}
                    </p>
                  </div>
                )}
              {activeTab === "stickers" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {STICKER_LIBRARY.map((sticker) => (
                      <button
                          key={sticker.id}
                          type="button"
                          onClick={() => handleStickerSelect(sticker.id)}
                          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-sm font-semibold transition ${
                            selectedSticker?.id === sticker.id
                              ? "border-sky-400 bg-sky-500/80 text-white shadow-lg"
                              : "border-white/30 bg-white/10 text-white/80"
                          }`}
                        >
                          {sticker.assetPath ? (
                            <Image
                              src={sticker.assetPath}
                              alt={sticker.label}
                              width={40}
                              height={40}
                              className="h-10 w-10 object-contain"
                              draggable={false}
                              unoptimized
                            />
                          ) : (
                            <span className="text-2xl">{sticker.emoji}</span>
                          )}
                          <span className="text-[10px] uppercase tracking-[0.2em] text-white/70">
                            {sticker.label}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-white/70">
                      Clique sur un sticker pour l'ajouter automatiquement au centre de la scène. Tu peux ensuite glisser le sticker où tu veux sur l’écran.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
};

const floatToPcm16 = (buffer: Float32Array) => {
  const output = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.max(-1, Math.min(1, buffer[i]));
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output;
};

const pcm16ToFloat = (buffer: Int16Array) => {
  const output = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    output[i] = buffer[i] / 0x8000;
  }
  return output;
};

const base64FromArrayBuffer = (buffer: ArrayBufferLike) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const base64ToInt16 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
};

type RealtimeStatus = "idle" | "connecting" | "open" | "closed" | "error";

const useRealtimeTranslation = ({
  enabled,
  isHost,
  captionTargetName,
  captionSourceName,
  realtimeVoice,
  localParticipant,
  onError,
  onStatus,
  onUnavailable,
}: {
  enabled: boolean;
  isHost: boolean;
  captionTargetName: string;
  captionSourceName?: string;
  realtimeVoice: string;
  localParticipant?: LocalParticipant;
  onError: (message: string) => void;
  onStatus?: (status: RealtimeStatus) => void;
  onUnavailable?: (reason: string) => void;
}) => {
  const wsRef = useRef<WebSocket | null>(null);
  const wsOpeningRef = useRef(false);
  const realtimeWorkletRef = useRef<AudioWorkletNode | null>(null);
  const pendingStopRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const trackRef = useRef<LocalAudioTrack | null>(null);
  const outputTimeRef = useRef(0);
  const retryStateRef = useRef({ attempts: 0 });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingPcmQueueRef = useRef<number[]>([]);
  const outgoingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const droppedChunksRef = useRef(false);
  const clearStableOpenTimer = useCallback(() => {
    if (stableOpenTimerRef.current) {
      clearTimeout(stableOpenTimerRef.current);
      stableOpenTimerRef.current = null;
    }
  }, []);

  const buildSessionUpdate = useCallback(() => {
    return {
      type: "session.update",
      session: {
        instructions: `You are a real-time interpreter. Translate ${
          captionSourceName || "French"
        } to ${captionTargetName}. Output only the translated speech in the target language.`,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: realtimeVoice,
        modalities: ["audio"],
        turn_detection: {
          type: "server_vad",
          threshold: 0.45,
          prefix_padding_ms: 120,
          silence_duration_ms: 260,
        },
      },
    };
  }, [captionTargetName, captionSourceName, realtimeVoice]);

  const stopRealtime = useCallback(async () => {
    if (wsOpeningRef.current && wsRef.current) {
      console.log("[realtime] stopRealtime deferred until ws opens");
      pendingStopRef.current = true;
      return;
    }
    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      console.log("[realtime] stopRealtime closing ws", {
        readyState: wsRef.current.readyState,
        opening: wsOpeningRef.current,
      });
      wsRef.current.close();
      wsRef.current = null;
      wsOpeningRef.current = false;
    }
    clearStableOpenTimer();
    if (outgoingFlushTimerRef.current) {
      clearTimeout(outgoingFlushTimerRef.current);
      outgoingFlushTimerRef.current = null;
    }
    outgoingPcmQueueRef.current = [];
    droppedChunksRef.current = false;
    const publishedTrack = trackRef.current;
    if (publishedTrack && localParticipant) {
      const hasPublication = localParticipant
        .getTrackPublications()
        .some((pub) => pub.track === publishedTrack);
      if (hasPublication) {
        try {
          await localParticipant.unpublishTrack(publishedTrack);
        } catch {}
      }
      publishedTrack.stop();
      if (trackRef.current === publishedTrack) {
        trackRef.current = null;
      }
    }
    if (destinationRef.current) {
      destinationRef.current.disconnect();
      destinationRef.current = null;
    }
    if (contextRef.current) {
      try {
        await contextRef.current.close();
      } catch {}
      contextRef.current = null;
    }
    if (realtimeWorkletRef.current) {
      realtimeWorkletRef.current.port.onmessage = null;
      realtimeWorkletRef.current.disconnect();
      realtimeWorkletRef.current = null;
    }
    outputTimeRef.current = 0;
  }, [clearStableOpenTimer, localParticipant]);

  useEffect(() => {
    if (!enabled || !isHost) {
      onStatus?.("idle");
      void stopRealtime();
      return;
    }
    const realtimeUrl = normalizeRealtimeUrl(REALTIME_URL);
    if (!realtimeUrl) {
      onError("Realtime: URL manquante.");
      onStatus?.("error");
      return;
    }
    if (!localParticipant) return;
    let cancelled = false;

    const startRealtime = async () => {
      try {
        onError("");
        onStatus?.("connecting");
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          onError("Realtime: micro indisponible.");
          onStatus?.("error");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const context = contextRef.current ?? new AudioContext();
        contextRef.current = context;
        if (context.state === "suspended") {
          try {
            await context.resume();
          } catch {}
        }
        const source = context.createMediaStreamSource(stream);
        const gain = context.createGain();
        gain.gain.value = 0;
        const destination = destinationRef.current ?? context.createMediaStreamDestination();
        destinationRef.current = destination;

        sourceRef.current = source;
        gainRef.current = gain;

        const ensureTrack = async () => {
          if (!localParticipant) return false;
          if (trackRef.current) return true;
          const [audioTrack] = destination.stream.getAudioTracks();
          if (!audioTrack) {
            onError("Realtime: aucun flux audio.");
            return false;
          }
          const localTrack = new LocalAudioTrack(audioTrack, undefined, true);
          trackRef.current = localTrack;
          try {
            await localParticipant.publishTrack(localTrack, { source: Track.Source.ScreenShareAudio });
          } catch {
            onError("Realtime: publication audio impossible.");
            localTrack.stop();
            trackRef.current = null;
            return false;
          }
          return true;
        };

        await ensureTrack();

        if (
          wsRef.current &&
          wsRef.current.readyState !== WebSocket.CLOSED &&
          wsRef.current.readyState !== WebSocket.CLOSING
        ) {
          return;
        }
        const ws = new WebSocket(realtimeUrl, "realtime");
        wsRef.current = ws;
        wsOpeningRef.current = true;
        outputTimeRef.current = 0;
        const scheduleReconnect = (reason: string) => {
          if (cancelled) return;
          if (retryTimerRef.current) return;
          if (retryStateRef.current.attempts >= REALTIME_MAX_RETRIES) {
            onError(`Realtime indisponible (${reason}). Coupe Start Realtime puis utilise Start Translate.`);
            onStatus?.("error");
            onUnavailable?.(reason);
            return;
          }
          const delay =
            REALTIME_RETRY_DELAYS_MS[
              Math.min(retryStateRef.current.attempts, REALTIME_RETRY_DELAYS_MS.length - 1)
            ];
          retryStateRef.current.attempts += 1;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (cancelled) return;
            void startRealtime();
          }, delay);
        };

        const clearOutgoingFlushTimer = () => {
          if (outgoingFlushTimerRef.current) {
            clearTimeout(outgoingFlushTimerRef.current);
            outgoingFlushTimerRef.current = null;
          }
        };

        const sendAudioChunk = (pcm16: Int16Array) => {
          const currentWs = wsRef.current;
          if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;
          if (currentWs.bufferedAmount > REALTIME_WS_BACKLOG_LIMIT_BYTES) {
            if (!droppedChunksRef.current) {
              droppedChunksRef.current = true;
              onError("Realtime: reseau surcharge, reprise en mode faible latence.");
            }
            return;
          }
          if (droppedChunksRef.current && currentWs.bufferedAmount < REALTIME_WS_BACKLOG_LIMIT_BYTES / 4) {
            droppedChunksRef.current = false;
            onError("");
          }
          const base64 = base64FromArrayBuffer(pcm16.buffer);
          currentWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
        };

        const flushOutgoingQueue = () => {
          clearOutgoingFlushTimer();
          const queue = outgoingPcmQueueRef.current;
          if (!queue.length) return;
          while (queue.length > 0) {
            const chunk = Int16Array.from(queue.splice(0, REALTIME_OUTGOING_CHUNK_SAMPLES));
            if (!chunk.length) break;
            sendAudioChunk(chunk);
          }
        };

        const scheduleFlushOutgoingQueue = () => {
          if (outgoingFlushTimerRef.current) return;
          outgoingFlushTimerRef.current = setTimeout(() => {
            flushOutgoingQueue();
          }, REALTIME_OUTGOING_FLUSH_MS);
        };

        await context.audioWorklet.addModule("/audio/realtime-processor.js");
        const workletNode = new AudioWorkletNode(context, "realtime-processor");
        realtimeWorkletRef.current = workletNode;
        workletNode.port.onmessage = (event) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const input = event.data as Float32Array;
          const downsampled = downsampleBuffer(input, context.sampleRate, REALTIME_SAMPLE_RATE);
          if (!downsampled) return;
          const pcm16 = floatToPcm16(downsampled);
          const queue = outgoingPcmQueueRef.current;
          for (let i = 0; i < pcm16.length; i += 1) {
            queue.push(pcm16[i]);
          }
          if (queue.length > REALTIME_MAX_BUFFERED_SAMPLES) {
            queue.splice(0, queue.length - REALTIME_SAMPLE_RATE);
          }
          while (queue.length >= REALTIME_OUTGOING_CHUNK_SAMPLES) {
            const chunk = Int16Array.from(queue.splice(0, REALTIME_OUTGOING_CHUNK_SAMPLES));
            sendAudioChunk(chunk);
          }
          scheduleFlushOutgoingQueue();
        };

        source.connect(workletNode);
        workletNode.connect(gain);
        gain.connect(context.destination);

        ws.onopen = () => {
          onStatus?.("open");
          console.log("[realtime] ws.onopen");
          wsOpeningRef.current = false;
          clearOutgoingFlushTimer();
          clearStableOpenTimer();
          stableOpenTimerRef.current = setTimeout(() => {
            retryStateRef.current.attempts = 0;
            stableOpenTimerRef.current = null;
          }, REALTIME_STABLE_CONNECTION_MS);
          outgoingPcmQueueRef.current = [];
          droppedChunksRef.current = false;
          if (pendingStopRef.current) {
            pendingStopRef.current = false;
            void stopRealtime();
            return;
          }
          ws.send(JSON.stringify(buildSessionUpdate()));
          ws.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio"] } }));
        };

        ws.onmessage = async (event) => {
          let message: { type?: string; delta?: string; error?: { message?: string } } | null = null;
          try {
            message = JSON.parse(typeof event.data === "string" ? event.data : "");
          } catch {
            return;
          }
          if (!message?.type) return;
          if (message.type === "response.audio.delta" && message.delta) {
            const pcm16 = base64ToInt16(message.delta);
            const floatData = pcm16ToFloat(pcm16);
            const buffer = context.createBuffer(1, floatData.length, REALTIME_SAMPLE_RATE);
            buffer.copyToChannel(floatData, 0);
            const sourceNode = context.createBufferSource();
            sourceNode.buffer = buffer;
            sourceNode.connect(destination);
            const startAt = Math.max(context.currentTime, outputTimeRef.current);
            sourceNode.start(startAt);
            outputTimeRef.current = startAt + buffer.duration;
          }
          if (message.type === "response.done") {
            ws.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio"] } }));
          }
          if (message.type === "error") {
            onError(message.error?.message || "Realtime: erreur inconnue.");
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          clearOutgoingFlushTimer();
          outgoingPcmQueueRef.current = [];
          onError("Realtime: connexion impossible.");
          onStatus?.("error");
          scheduleReconnect("connexion websocket");
        };
        ws.onclose = (event) => {
          console.log("[realtime] ws.onclose", { code: event.code, reason: event.reason });
          wsOpeningRef.current = false;
          clearStableOpenTimer();
          clearOutgoingFlushTimer();
          outgoingPcmQueueRef.current = [];
          droppedChunksRef.current = false;
          if (pendingStopRef.current) {
            pendingStopRef.current = false;
          }
          wsRef.current = null;
          if (cancelled) return;
          if (event.code && isRealtimeNonRetryableCloseCode(event.code)) {
            const reason = `fermeture websocket ${event.code}`;
            onError(`Realtime indisponible (${reason}). Bascule auto vers Traduction vocale.`);
            onStatus?.("error");
            onUnavailable?.(reason);
            return;
          }
          if (event.code && event.code !== 1000) {
            onError(`Realtime: connexion fermee (${event.code}).`);
            onStatus?.("error");
            scheduleReconnect(`fermeture websocket ${event.code}`);
            return;
          }
          onStatus?.("closed");
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur Realtime.";
        onError(`Realtime: ${message}`);
        onStatus?.("error");
      }
    };

    void startRealtime();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      clearStableOpenTimer();
      void stopRealtime();
    };
  }, [
    enabled,
    isHost,
    localParticipant,
    onError,
    onStatus,
    stopRealtime,
    buildSessionUpdate,
    clearStableOpenTimer,
    onUnavailable,
  ]);

  useEffect(() => {
    if (!enabled || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(buildSessionUpdate()));
  }, [enabled, buildSessionUpdate]);
};

export default function LiveKitCall({
  roomId,
  onParticipantCount,
  isHost,
  guestInviteId,
  sessionIdentity,
  initialLivekitAuth,
  aiTrainingAutoStart = false,
  defaultDisplayName,
  onLeave,
  audioOnly,
  skipPreJoin = false,
  sessionMode = "conference",
}: {
  roomId: string;
  onParticipantCount?: (count: number) => void;
  isHost: boolean;
  guestInviteId?: string;
  sessionIdentity?: string;
  initialLivekitAuth?: InitialLivekitAuth;
  aiTrainingAutoStart?: boolean;
  defaultDisplayName?: string;
  onLeave?: () => void;
  audioOnly?: boolean;
  skipPreJoin?: boolean;
  sessionMode?: "conference" | "chat";
}) {
  const router = useRouter();
  const isChatSession = sessionMode === "chat";
  const [token, setToken] = useState<string>("");
  const [guestTtsToken, setGuestTtsToken] = useState("");
  const [error, setError] = useState<string>("");
  const [tokenRetryTrigger, setTokenRetryTrigger] = useState(0);
  const [roomMountKey, setRoomMountKey] = useState(0);
  const [disconnectNotice, setDisconnectNotice] = useState("");
  const [autoResumeActive, setAutoResumeActive] = useState(false);
  const [autoResumeAttempt, setAutoResumeAttempt] = useState(0);
  const [autoResumeGraceRemainingMs, setAutoResumeGraceRemainingMs] = useState(0);
  const [sessionUser, setSessionUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [translationEntitlement, setTranslationEntitlement] =
    useState<TranslationEntitlementState>(DEFAULT_TRANSLATION_ENTITLEMENT);
  const translationConsumeQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const manualLeaveRef = useRef(false);
  const autoResumeAttemptsRef = useRef(0);
  const autoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResumeInFlightRef = useRef(false);
  const autoResumeGraceDeadlineRef = useRef<number | null>(null);
  const refreshTranslationEntitlement = useCallback(async () => {
    if (!isHost && !isChatSession) {
      setTranslationEntitlement({
        ...DEFAULT_TRANSLATION_ENTITLEMENT,
        loading: false,
      });
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
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
      const idToken = await getIdToken(currentUser, true);
      const response = await fetch("/api/translation/entitlement", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setTranslationEntitlement((prev) => ({
          ...prev,
          loading: false,
        }));
        return;
      }
      setTranslationEntitlement(normalizeTranslationEntitlement(payload));
    } catch {
      setTranslationEntitlement((prev) => ({
        ...prev,
        loading: false,
      }));
    }
  }, [isChatSession, isHost]);

  useEffect(() => {
    if (translationEntitlement.loading) return;
    dispatchTranslationEntitlementUpdatedEvent({
      enabled: translationEntitlement.enabled,
      isAdmin: translationEntitlement.isAdmin,
      isPremium: translationEntitlement.isPremium,
      totalSecondsRemaining: translationEntitlement.totalSecondsRemaining,
      freeSecondsRemaining: translationEntitlement.freeSecondsRemaining,
      paidSecondsRemaining: translationEntitlement.paidSecondsRemaining,
    });
  }, [
    translationEntitlement.enabled,
    translationEntitlement.freeSecondsRemaining,
    translationEntitlement.isAdmin,
    translationEntitlement.isPremium,
    translationEntitlement.loading,
    translationEntitlement.paidSecondsRemaining,
    translationEntitlement.totalSecondsRemaining,
  ]);

  const consumeTranslationSeconds = useCallback(
    async (seconds: number, origin: "local" | "remote") => {
      if (!isHost && !isChatSession) return true;
      const currentUser = auth.currentUser;
      if (!currentUser) return false;
      const safeSeconds = Math.max(1, Math.min(300, Math.floor(seconds || 1)));
      const executeConsume = async () => {
        try {
          const idToken = await getIdToken(currentUser);
          const response = await fetch("/api/translation/consume", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              seconds: safeSeconds,
              origin,
              roomId,
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
          if (response.status === 402) {
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

      const queuedConsume = translationConsumeQueueRef.current.then(
        executeConsume,
        executeConsume
      );
      translationConsumeQueueRef.current = queuedConsume.then(
        () => true,
        () => true
      );
      return queuedConsume;
    },
    [
      isChatSession,
      isHost,
      roomId,
    ]
  );
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setSessionUser(nextUser);
    });
    return () => unsubscribe();
  }, []);
  useEffect(() => {
    void refreshTranslationEntitlement();
  }, [refreshTranslationEntitlement, sessionUser, tokenRetryTrigger]);
  const handleResumeAfterInterrupt = useCallback(() => {
    manualLeaveRef.current = false;
    setDisconnectNotice("");
    setToken("");
    setGuestTtsToken("");
    setError("");
    setRoomMountKey((prev) => prev + 1);
    setTokenRetryTrigger((prev) => prev + 1);
  }, []);
  const clearAutoResumeState = useCallback(() => {
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
    autoResumeInFlightRef.current = false;
    autoResumeAttemptsRef.current = 0;
    autoResumeGraceDeadlineRef.current = null;
    setAutoResumeAttempt(0);
    setAutoResumeGraceRemainingMs(0);
    setAutoResumeActive(false);
  }, []);
  const handleRetryToken = useCallback(() => {
    clearAutoResumeState();
    setToken("");
    setGuestTtsToken("");
    setError("");
    setDisconnectNotice("");
    setTokenRetryTrigger((prev) => prev + 1);
  }, [clearAutoResumeState]);
  const handleManualLeave = useCallback(() => {
    manualLeaveRef.current = true;
    clearAutoResumeState();
    setDisconnectNotice("");
  }, [clearAutoResumeState]);
  const handleQuitAfterInterrupt = useCallback(() => {
    handleManualLeave();
    if (onLeave) {
      onLeave();
      return;
    }
    router.push("/");
  }, [handleManualLeave, onLeave, router]);
  const triggerAutoResumeNow = useCallback(() => {
    if (manualLeaveRef.current) return;
    if (autoResumeInFlightRef.current) return;
    const graceDeadline = autoResumeGraceDeadlineRef.current;
    if (graceDeadline && Date.now() >= graceDeadline) {
      setAutoResumeActive(false);
      setDisconnectNotice(
        "Interruption prolongee. La reprise automatique est arretee: clique sur Reprendre la visioconference."
      );
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (autoResumeAttemptsRef.current >= AUTO_RESUME_MAX_ATTEMPTS) {
      setAutoResumeActive(false);
      setDisconnectNotice(
        "Reconnexion automatique en pause. Clique sur Reprendre la visioconference."
      );
      return;
    }
    autoResumeAttemptsRef.current += 1;
    setAutoResumeAttempt(autoResumeAttemptsRef.current);
    autoResumeInFlightRef.current = true;
    handleResumeAfterInterrupt();
  }, [handleResumeAfterInterrupt]);
  const scheduleAutoResume = useCallback(
    (customDelayMs?: number) => {
      if (manualLeaveRef.current) return;
      if (autoResumeAttemptsRef.current >= AUTO_RESUME_MAX_ATTEMPTS) {
        setAutoResumeActive(false);
        return;
      }
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
      setAutoResumeActive(true);
      const delay =
        customDelayMs ??
        AUTO_RESUME_RETRY_DELAYS_MS[
          Math.min(autoResumeAttemptsRef.current, AUTO_RESUME_RETRY_DELAYS_MS.length - 1)
        ];
      autoResumeTimerRef.current = setTimeout(() => {
        autoResumeTimerRef.current = null;
        triggerAutoResumeNow();
      }, delay);
    },
    [triggerAutoResumeNow]
  );
  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (!autoResumeActive) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const tryReconnectWhenForeground = () => {
      if (!autoResumeActive) return;
      if (document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
      triggerAutoResumeNow();
    };
    document.addEventListener("visibilitychange", tryReconnectWhenForeground);
    window.addEventListener("focus", tryReconnectWhenForeground);
    window.addEventListener("online", tryReconnectWhenForeground);
    window.addEventListener("pageshow", tryReconnectWhenForeground);
    return () => {
      document.removeEventListener("visibilitychange", tryReconnectWhenForeground);
      window.removeEventListener("focus", tryReconnectWhenForeground);
      window.removeEventListener("online", tryReconnectWhenForeground);
      window.removeEventListener("pageshow", tryReconnectWhenForeground);
    };
  }, [autoResumeActive, triggerAutoResumeNow]);
  useEffect(() => {
    if (!autoResumeActive) return;
    if (!autoResumeGraceDeadlineRef.current) return;
    const tick = () => {
      const deadline = autoResumeGraceDeadlineRef.current;
      if (!deadline) return;
      const remaining = Math.max(0, deadline - Date.now());
      setAutoResumeGraceRemainingMs(remaining);
      if (remaining > 0) return;
      autoResumeGraceDeadlineRef.current = null;
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
      autoResumeInFlightRef.current = false;
      setAutoResumeActive(false);
      setDisconnectNotice(
        "Fenetre de reprise automatique depassee. Clique sur Reprendre la visioconference."
      );
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoResumeActive]);
  const [backgroundMode, setBackgroundMode] = useState<string>("none");
  const [customBackgrounds, setCustomBackgrounds] = useState<BackgroundOption[]>([]);
  const [aiBackgroundUrl, setAiBackgroundUrl] = useState<string | null>(null);
  const [aiGallery, setAiGallery] = useState<AiGalleryItem[]>([]);
  const aiBackgroundOption = useMemo(
    () =>
      aiBackgroundUrl
        ? {
            id: "ai",
            label: "IA",
            mode: "image" as const,
            imagePath: aiBackgroundUrl,
          }
        : null,
    [aiBackgroundUrl]
  );
  const backgroundOptions = useMemo(() => {
    const base = [...BACKGROUND_OPTIONS, ...customBackgrounds];
    return aiBackgroundOption ? [...base, aiBackgroundOption] : base;
  }, [customBackgrounds, aiBackgroundOption]);

  const handleAiImageGenerated = useCallback((url: string) => {
    setAiBackgroundUrl(url);
    setBackgroundMode("ai");
  }, []);

  const handleClearAiBackground = useCallback(() => {
    setAiBackgroundUrl(null);
    setBackgroundMode((prev) => (prev === "ai" ? "none" : prev));
  }, []);

  const handleAiGallerySave = useCallback(
    (prompt: string, image: string) => {
      const item: AiGalleryItem = {
        id: safeRandomId(),
        prompt,
        image,
        createdAt: Date.now(),
      };
      setAiGallery((prev) => {
        const filtered = prev.filter((entry) => entry.image !== image);
        const nextList = [item, ...filtered].slice(0, 12);
        return nextList;
      });
    },
    []
  );

  const handleAiGallerySelect = useCallback(
    (item: AiGalleryItem) => {
      handleAiImageGenerated(item.image);
    },
    [handleAiImageGenerated]
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(AI_GALLERY_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed: AiGalleryItem[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setAiGallery(parsed);
      }
    } catch {
      // ignore corrupt data
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (aiGallery.length === 0) {
        window.localStorage.removeItem(AI_GALLERY_STORAGE_KEY);
      } else {
        window.localStorage.setItem(AI_GALLERY_STORAGE_KEY, JSON.stringify(aiGallery));
      }
    } catch {
      console.warn("Impossible d'enregistrer la galerie IA");
    }
  }, [aiGallery]);
  const loadCustomBackgrounds = useCallback(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(CUSTOM_BACKGROUND_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed: BackgroundOption[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setCustomBackgrounds(parsed.slice(0, CUSTOM_BACKGROUND_LIMIT));
      }
    } catch {
      // ignore invalid saved data
    }
  }, []);
  useEffect(() => {
    loadCustomBackgrounds();
  }, [loadCustomBackgrounds]);
  const persistCustomBackgrounds = useCallback(() => {
    if (typeof window === "undefined") return;
    if (customBackgrounds.length === 0) {
      window.localStorage.removeItem(CUSTOM_BACKGROUND_STORAGE_KEY);
      return;
    }
    try {
      window.localStorage.setItem(
        CUSTOM_BACKGROUND_STORAGE_KEY,
        JSON.stringify(customBackgrounds)
      );
    } catch (error) {
      console.warn("Impossible d'enregistrer les fonds personnalisés:", error);
    }
  }, [customBackgrounds]);
  useEffect(() => {
    persistCustomBackgrounds();
  }, [persistCustomBackgrounds]);

  const addCustomBackground = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") return;
      const next: BackgroundOption = {
        id: `${CUSTOM_BACKGROUND_PREFIX}-${Date.now()}`,
        label: file.name,
        mode: "image",
        imagePath: result,
      };
      setCustomBackgrounds((prev) => {
        const nextList = [next, ...prev].slice(0, CUSTOM_BACKGROUND_LIMIT);
        return nextList;
      });
      setBackgroundMode(next.id);
    };
    reader.readAsDataURL(file);
  }, []);
  const removeCustomBackground = useCallback(
    (id: string) => {
      setCustomBackgrounds((prev) => prev.filter((item) => item.id !== id));
      setBackgroundMode((prev) => (prev === id ? "none" : prev));
    },
    []
  );
  const preJoinStorageKey = useMemo(
    () => buildPreJoinChoicesStorageKey(roomId, isHost),
    [isHost, roomId]
  );
  const fallbackPreJoinName = useMemo(
    () => sanitizeDisplayName(defaultDisplayName) || (isHost ? "Hote" : "Invite"),
    [defaultDisplayName, isHost]
  );
  const [preJoinChoices, setPreJoinChoices] = useState<LocalUserChoices | null>(null);
  const preJoinRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    preJoinRestoreAttemptedRef.current = false;
  }, [preJoinStorageKey]);
  useEffect(() => {
    if (!skipPreJoin) return;
    preJoinRestoreAttemptedRef.current = true;
    setPreJoinChoices((current) =>
      current ??
      normalizePreJoinChoices(
        {
          username: fallbackPreJoinName,
          audioEnabled: true,
          // The AI exercise swaps to the coach stage immediately, so avoid
          // publishing camera tracks only to disable them right after join.
          videoEnabled: !audioOnly && !aiTrainingAutoStart,
        },
        fallbackPreJoinName
      )
    );
  }, [aiTrainingAutoStart, audioOnly, fallbackPreJoinName, skipPreJoin]);
  useEffect(() => {
    if (preJoinChoices) return;
    if (preJoinRestoreAttemptedRef.current) return;
    preJoinRestoreAttemptedRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(preJoinStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      setPreJoinChoices(normalizePreJoinChoices(parsed, fallbackPreJoinName));
    } catch {
      // Ignore invalid session cache.
    }
  }, [fallbackPreJoinName, preJoinChoices, preJoinStorageKey]);
  useEffect(() => {
    if (!preJoinChoices) return;
    if (typeof window === "undefined") return;
    const normalized = normalizePreJoinChoices(preJoinChoices, fallbackPreJoinName);
    try {
      window.sessionStorage.setItem(preJoinStorageKey, JSON.stringify(normalized));
    } catch {
      // Ignore private mode / quota errors.
    }
  }, [fallbackPreJoinName, preJoinChoices, preJoinStorageKey]);
  const [autoFrame, setAutoFrame] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(CAPTIONS_ALWAYS_ON);
  const [captionSize, setCaptionSize] = useState<"sm" | "md" | "lg">("md");
  const [captionTarget, setCaptionTarget] = useState<CaptionTargetCode>(DEFAULT_CAPTION_TARGET);
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguageOption["code"]>(
    DEFAULT_SOURCE_LANGUAGE
  );
  const sourceLanguageOption = useMemo(
    () =>
      SOURCE_LANGUAGE_OPTIONS.find((item) => item.code === sourceLanguage) ??
      SOURCE_LANGUAGE_OPTIONS[0],
    [sourceLanguage]
  );
  const sourceLanguageName = sourceLanguageOption.name;
  const sourceLanguageLocale = sourceLanguageOption.recognitionLocale;
  const [ttsEnabled, setTtsEnabled] = useState(VOICE_TRANSLATION_ENABLED);
  const [hostLocalTtsEnabled, setHostLocalTtsEnabled] = useState(false);
  const [shareMicToGuests, setShareMicToGuests] = useState(true);
  const [guestTtsEnabled, setGuestTtsEnabled] = useState(true);
  const [guestCaptionTarget, setGuestCaptionTarget] = useState<CaptionTargetCode>(captionTarget);
  const [respondInTrainingLanguage, setRespondInTrainingLanguage] = useState(false);
  useEffect(() => {
    if (translationEntitlement.enabled) return;
    setGuestTtsEnabled(false);
  }, [translationEntitlement.enabled]);

  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [realtimeVoiceInput, setRealtimeVoiceInput] = useState(
    process.env.NEXT_PUBLIC_REALTIME_VOICE || "ash"
  );
  const [realtimeError, setRealtimeError] = useState("");
  const [ttsError, setTtsError] = useState("");
  const [videoFit, setVideoFit] = useState<"cover" | "contain">("cover");
  const forcedContainRef = useRef(false);
  const aiVideoFitRestoreRef = useRef<"cover" | "contain">("cover");
  const realtimeAvailable = Boolean(REALTIME_URL);
  const onRealtimeError = useCallback((message: string) => setRealtimeError(message), []);
  const onTtsError = useCallback((message: string) => setTtsError(message), []);
  const captionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget)?.name || "English",
    [captionTarget]
  );
  useEffect(() => {
    if (backgroundMode === "ai") {
      if (!forcedContainRef.current && videoFit !== "contain") {
        forcedContainRef.current = true;
        aiVideoFitRestoreRef.current = videoFit;
        setVideoFit("contain");
      }
      return;
    }
    if (!forcedContainRef.current) return;
    forcedContainRef.current = false;
    if (videoFit === "contain") {
      setVideoFit(aiVideoFitRestoreRef.current);
    }
  }, [backgroundMode, videoFit]);
  const prevHostCaptionTargetRef = useRef<CaptionTargetCode>(captionTarget);
  useEffect(() => {
    if (guestCaptionTarget === prevHostCaptionTargetRef.current) {
      setGuestCaptionTarget(captionTarget);
    }
    prevHostCaptionTargetRef.current = captionTarget;
  }, [captionTarget, guestCaptionTarget]);
  const handleSourceLanguageChange = useCallback(
    (value: SourceLanguageOption["code"]) => {
      setSourceLanguage(value);
    },
    []
  );
  const handleGuestCaptionTargetChange = useCallback(
    (target: CaptionTargetCode) => {
      setGuestCaptionTarget(target);
    },
    []
  );
  const handleRespondInTrainingLanguageChange = useCallback((next: boolean) => {
    setRespondInTrainingLanguage(next);
  }, []);
  const captionsSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const hasSpeechRecognition =
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
    const hasRecorderFallback =
      typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    return hasSpeechRecognition || hasRecorderFallback;
  }, []);
  const insecureHttpMediaContext = useMemo(() => {
    if (typeof window === "undefined") return false;
    const { protocol, hostname } = window.location;
    const isLoopbackHost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    return protocol === "http:" && !isLoopbackHost;
  }, []);


  const identity = useMemo(() => sessionIdentity?.trim() || safeRandomId(), [sessionIdentity]);
  const isMobileDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }, []);
  const roomOptions = useMemo(
    () => ({
      adaptiveStream: {
        pauseVideoInBackground: true,
        pixelDensity: isMobileDevice ? 1 : 2,
      },
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        resolution: isMobileDevice ? { width: 1280, height: 720 } : { width: 1280, height: 720 },
        frameRate: isMobileDevice ? 24 : 30,
      },
    }),
    [isMobileDevice]
  );

  useEffect(() => {
    if (!CAPTIONS_ALWAYS_ON || captionsEnabled) return;
    setCaptionsEnabled(true);
  }, [captionsEnabled]);

  useEffect(() => {
    if (VOICE_TRANSLATION_ENABLED || !ttsEnabled) return;
    setTtsEnabled(false);
  }, [ttsEnabled]);

  useEffect(() => {
    if (REALTIME_TRANSLATION_ENABLED || !realtimeEnabled) return;
    setRealtimeEnabled(false);
  }, [realtimeEnabled]);

  useEffect(() => {
    if (VOICE_TRANSLATION_ENABLED || !hostLocalTtsEnabled) return;
    setHostLocalTtsEnabled(false);
  }, [hostLocalTtsEnabled]);

  useEffect(() => {
    if (!realtimeEnabled) return;
    if (ttsError) setTtsError("");
    if (shareMicToGuests) setShareMicToGuests(false);
  }, [realtimeEnabled, ttsError, shareMicToGuests]);

  useEffect(() => {
    if (!isHost || !realtimeEnabled) return;
    if (captionsEnabled) return;
    setCaptionsEnabled(true);
  }, [captionsEnabled, isHost, realtimeEnabled]);

  useEffect(() => {
    if (!REALTIME_TRANSLATION_ENABLED) return;
    if (!isHost || !roomId) return;

    let cancelled = false;
    const action = realtimeEnabled ? "ensure" : "release";

    const syncTranslatorWorker = async () => {
      try {
        const authHeader = await getAuthHeader({ forceRefresh: true });
        const response = await fetch("/api/livekit/translator/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            action,
            room: roomId,
            sourceLanguage,
            targetLanguage: captionTarget,
            voice: realtimeVoiceInput,
          }),
        });
        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(raw || `Translator orchestrator error (${response.status})`);
        }
      } catch (error) {
        if (cancelled) return;
        if (realtimeEnabled) {
          onRealtimeError(
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
          const authHeader = await getAuthHeader({ forceRefresh: true });
          await fetch("/api/livekit/translator/session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({
              action: "release",
              room: roomId,
            }),
          });
        } catch {}
      })();
    };
  }, [
    captionTarget,
    isHost,
    onRealtimeError,
    realtimeEnabled,
    realtimeVoiceInput,
    roomId,
    sourceLanguage,
  ]);

  useEffect(() => {
    if (realtimeEnabled) return;
    if (realtimeError) setRealtimeError("");
  }, [realtimeEnabled, realtimeError]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!roomId) {
      setToken("");
      setGuestTtsToken("");
      setError("");
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setToken("");
    setGuestTtsToken("");
    setError("");

    const fetchToken = async () => {
      try {
        const displayName =
          sanitizeDisplayName(preJoinChoices?.username) ||
          sanitizeDisplayName(defaultDisplayName) ||
          (isHost ? `Hôte-${identity.slice(0, 6)}` : `Invité-${identity.slice(0, 6)}`);
        let res: Response;
        if (!isHost && guestInviteId) {
          if (tokenRetryTrigger === 0 && initialLivekitAuth?.token?.trim()) {
            const nextToken = initialLivekitAuth.token.trim();
            if (!nextToken || nextToken.split(".").length !== 3) {
              throw new Error("Token LiveKit invalide");
            }
            if (!cancelled) {
              autoResumeInFlightRef.current = false;
              if (autoResumeActive) {
                clearAutoResumeState();
                setDisconnectNotice("");
              }
              setToken(nextToken);
              setGuestTtsToken(initialLivekitAuth.guestTtsToken?.trim() || "");
            }
            return;
          }
          const authHeader = await getAuthHeader({ forceRefresh: true });
          res = await fetch("/api/livekit/invite/redeem", {
            signal: controller.signal,
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({
              invite: guestInviteId,
              identity,
              name: displayName,
              includeGuestTtsToken: true,
            }),
          });
        } else {
          if (!isHost && !isChatSession) {
            throw new Error(
              "Cette visioconférence n'accepte plus les codes de room. Utilise une invitation BFZoom."
            );
          }
          const authHeader = await getAuthHeader({ forceRefresh: true });
          res = await fetch("/api/livekit/token", {
            signal: controller.signal,
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({
              room: roomId,
              identity,
              name: displayName,
              role: isHost ? "host" : "guest",
              sessionMode,
              includeGuestTtsToken: true,
            }),
          });
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `Token LiveKit error (${res.status})${body ? `: ${body}` : ""}`
          );
        }
        const raw = await res.text();
        let nextToken = raw.trim();
        let nextGuestTtsToken = "";
        try {
          const parsed = JSON.parse(raw) as { token?: string; guestTtsToken?: string };
          if (typeof parsed.token === "string") {
            nextToken = parsed.token.trim();
          }
          if (typeof parsed.guestTtsToken === "string") {
            nextGuestTtsToken = parsed.guestTtsToken.trim();
          }
        } catch {
          // Backward compatible: previous API returned plain text token.
        }
        if (!nextToken || nextToken.split(".").length !== 3) {
          throw new Error("Token LiveKit invalide");
        }
        if (!cancelled) {
          autoResumeInFlightRef.current = false;
          if (autoResumeActive) {
            clearAutoResumeState();
            setDisconnectNotice("");
          }
          setToken(nextToken);
          setGuestTtsToken(nextGuestTtsToken);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : "Erreur inconnue lors de la génération du token.";
        autoResumeInFlightRef.current = false;
        const shouldAutoRetry = autoResumeActive && !manualLeaveRef.current;
        if (shouldAutoRetry && autoResumeAttemptsRef.current < AUTO_RESUME_MAX_ATTEMPTS) {
          setError("");
          setDisconnectNotice(
            `Reconnexion automatique en cours (${autoResumeAttemptsRef.current}/${AUTO_RESUME_MAX_ATTEMPTS})...`
          );
          scheduleAutoResume();
          return;
        }
        if (shouldAutoRetry) {
          setAutoResumeActive(false);
          setDisconnectNotice(
            "Reconnexion automatique impossible pour le moment. Reprends manuellement la visioconference."
          );
        }
        setGuestTtsToken("");
        setError(message);
      }
    };

    void fetchToken();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    roomId,
    identity,
    isHost,
    isChatSession,
    guestInviteId,
    initialLivekitAuth?.guestTtsToken,
    initialLivekitAuth?.token,
    preJoinChoices?.username,
    defaultDisplayName,
    sessionMode,
    tokenRetryTrigger,
    autoResumeActive,
    clearAutoResumeState,
    scheduleAutoResume,
  ]);

  if (!LK_URL) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 text-red-800 p-4">
        Configuration LiveKit manquante : `NEXT_PUBLIC_LIVEKIT_URL`.
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
        <p className="font-semibold">Erreur LiveKit</p>
        <p className="text-sm text-red-800/80 wrap-break-word">{error}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-red-800">
          <button
            onClick={handleRetryToken}
            className="rounded-full border border-red-200 bg-white px-3 py-1 font-semibold text-red-700 hover:bg-red-50 transition"
          >
            Réessayer la connexion
          </button>
          <span>Si cela persiste, vérifie la configuration LiveKit (NEXT_PUBLIC_LIVEKIT_URL, token).</span>
        </div>
      </div>
    );
  }

  if (disconnectNotice) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Visioconference interrompue</p>
        <p className="mt-1 text-sm text-amber-900/80">{disconnectNotice}</p>
        <p className="mt-1 text-xs text-amber-900/70">
          iOS ne permet pas de gerer les appels telephoniques entrants depuis le navigateur. BFZoom peut par contre reprendre la session juste apres l'appel.
        </p>
        {autoResumeActive && autoResumeGraceRemainingMs > 0 && (
          <p className="mt-1 text-xs font-semibold text-amber-900/80">
            Fenetre de reprise automatique: {formatResumeCountdown(autoResumeGraceRemainingMs)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!autoResumeActive && (
            <button
              type="button"
              onClick={() => {
                clearAutoResumeState();
                handleResumeAfterInterrupt();
              }}
              className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              Reprendre la visioconference
            </button>
          )}
          {autoResumeActive && (
            <p className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900">
              Reconnexion auto ({autoResumeAttempt}/{AUTO_RESUME_MAX_ATTEMPTS})
            </p>
          )}
          <button
            type="button"
            onClick={handleQuitAfterInterrupt}
            className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200"
          >
            Quitter
          </button>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">
        Connexion LiveKit en cours...
      </div>
    );
  }

  if (!preJoinChoices) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-slate-950 text-slate-100 rounded-2xl border border-slate-800">
        <div className="w-full max-w-md p-6">
          <PreJoin
            defaults={{
              username: fallbackPreJoinName,
              audioEnabled: true,
              videoEnabled: true,
            }}
            joinLabel="Rejoindre"
            userLabel="Nom"
            micLabel="Micro"
            camLabel="Camera"
            onSubmit={(values) =>
              setPreJoinChoices(normalizePreJoinChoices(values, fallbackPreJoinName))
            }
          />
          <p className="mt-4 text-xs text-slate-400 text-center">
            Active ton micro et ta camera puis clique sur Rejoindre.
          </p>
          {insecureHttpMediaContext && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              HTTP sur reseau local detecte. Safari/Chrome peuvent bloquer micro/camera.
              Utilise HTTPS (tunnel) ou l'app iOS native.
            </p>
          )}
        </div>
      </div>
    );
  }

  const audioOptions =
    preJoinChoices.audioEnabled === false
      ? false
      : {
          deviceId: preJoinChoices.audioDeviceId || undefined,
        };
  const videoOptions =
    audioOnly || preJoinChoices.videoEnabled === false
      ? false
      : {
          deviceId: preJoinChoices.videoDeviceId || undefined,
        };

  return (
    <div className="w-full">
      <LiveKitRoom
        key={`lk-room-${roomId}-${roomMountKey}`}
        token={token}
        serverUrl={LK_URL}
        connect
        data-lk-theme="default"
        audio={audioOptions}
        video={videoOptions}
        options={roomOptions}
        onDisconnected={(reason) => {
          const clientInitiated = manualLeaveRef.current;
          manualLeaveRef.current = false;
          if (clientInitiated) {
            if (onLeave) {
              onLeave();
              return;
            }
            router.push("/");
            return;
          }
          const notice = getDisconnectNotice(reason);
          if (autoResumeTimerRef.current) {
            clearTimeout(autoResumeTimerRef.current);
            autoResumeTimerRef.current = null;
          }
          autoResumeInFlightRef.current = false;
          autoResumeAttemptsRef.current = 0;
          autoResumeGraceDeadlineRef.current = Date.now() + AUTO_RESUME_GRACE_PERIOD_MS;
          setAutoResumeAttempt(0);
          setAutoResumeGraceRemainingMs(AUTO_RESUME_GRACE_PERIOD_MS);
          setAutoResumeActive(true);
          setDisconnectNotice(
            notice || "Session interrompue. Tentative de reconnexion automatique..."
          );
          scheduleAutoResume(700);
        }}
        className="lk-room rounded-2xl border border-slate-200 bg-black"
      >
        <LiveKitParticipantCount onCount={onParticipantCount} />
        {audioOnly ? (
          <div className="flex h-64 items-center justify-center text-sm text-white/70">
            Appel vocal en cours · microphone uniquement
          </div>
        ) : (
          <LiveKitVideo
            backgroundMode={backgroundMode}
            backgroundOptions={backgroundOptions}
            customBackgrounds={customBackgrounds}
            onAddCustomBackground={addCustomBackground}
            onRemoveCustomBackground={removeCustomBackground}
            aiBackgroundUrl={aiBackgroundUrl}
            onAiImageGenerated={handleAiImageGenerated}
            onClearAiBackground={handleClearAiBackground}
            aiGallery={aiGallery}
            onSaveAiBackground={handleAiGallerySave}
            onAiGallerySelect={handleAiGallerySelect}
            onRefreshTranslationEntitlement={refreshTranslationEntitlement}
            roomId={roomId}
            isHost={isHost}
            onChangeBackground={setBackgroundMode}
            autoFrame={autoFrame}
            onToggleAutoFrame={() => setAutoFrame((value) => !value)}
            captionsEnabled={captionsEnabled}
            captionsSupported={captionsSupported}
            onToggleCaptions={() => {
              if (CAPTIONS_ALWAYS_ON) return;
              setCaptionsEnabled((value) => !value);
            }}
            onDisableCaptions={() => {
              if (CAPTIONS_ALWAYS_ON) return;
              setCaptionsEnabled(false);
            }}
            captionTarget={captionTarget}
            onChangeCaptionTarget={setCaptionTarget}
            sourceLanguageOption={sourceLanguageOption}
            sourceLanguage={sourceLanguage}
            onChangeSourceLanguage={handleSourceLanguageChange}
            respondInTrainingLanguage={respondInTrainingLanguage}
            onChangeRespondInTrainingLanguage={handleRespondInTrainingLanguageChange}
            ttsEnabled={ttsEnabled}
            onToggleTts={() => {
              if (!VOICE_TRANSLATION_ENABLED) return;
              setTtsEnabled((value) => !value);
            }}
            realtimeEnabled={realtimeEnabled}
            realtimeAvailable={REALTIME_TRANSLATION_ENABLED && Boolean(REALTIME_URL)}
            realtimeVoice={realtimeVoiceInput}
            onChangeRealtimeVoice={setRealtimeVoiceInput}
            onToggleRealtime={() => {
              if (!REALTIME_TRANSLATION_ENABLED) return;
              setRealtimeEnabled((value) => !value);
            }}
            realtimeError={realtimeError}
            onRealtimeError={onRealtimeError}
            hostLocalTtsEnabled={hostLocalTtsEnabled}
            onToggleHostLocalTts={() => {
              if (!VOICE_TRANSLATION_ENABLED) return;
              setHostLocalTtsEnabled((value) => !value);
            }}
            shareMicToGuests={shareMicToGuests}
            onToggleShareMicToGuests={() => setShareMicToGuests((value) => !value)}
            guestCaptionTarget={guestCaptionTarget}
            onChangeGuestCaptionTarget={handleGuestCaptionTargetChange}
            guestTtsEnabled={guestTtsEnabled}
            onToggleGuestTts={() => setGuestTtsEnabled((value) => !value)}
            guestTtsToken={guestTtsToken}
            translationEnabled={translationEntitlement.enabled}
            translationLockMessage={translationEntitlement.lockReason}
            translationRemainingSeconds={translationEntitlement.totalSecondsRemaining}
            onConsumeTranslationSeconds={consumeTranslationSeconds}
            ttsError={ttsError}
            onTtsError={setTtsError}
            captionSize={captionSize}
            onChangeCaptionSize={setCaptionSize}
            videoFit={videoFit}
            onChangeVideoFit={setVideoFit}
            onLeaveSession={handleManualLeave}
            aiTrainingAutoStart={aiTrainingAutoStart}
            sessionMode={sessionMode}
          />
        )}
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}

function LiveKitParticipantCount({
  onCount,
}: {
  onCount?: (count: number) => void;
}) {
  const remoteParticipants = useRemoteParticipants();

  useEffect(() => {
    const count = remoteParticipants.length + 1;
    if (onCount) onCount(count);
  }, [remoteParticipants.length, onCount]);

  return null;
}

type BackgroundOption = {
  id: string;
  label: string;
  mode: "none" | "blur" | "image";
  imagePath?: string;
};

const CUSTOM_BACKGROUND_STORAGE_KEY = "bfzoom:custom-backgrounds";
const CUSTOM_BACKGROUND_PREFIX = "custom";
const CUSTOM_BACKGROUND_LIMIT = 5;
const AI_GALLERY_STORAGE_KEY = "bfzoom:ai-gallery";
const BROKEN_AI_IMAGE_STORAGE_KEY = "bfzoom:broken-ai-images";

type AiGalleryItem = {
  id: string;
  prompt: string;
  image: string;
  createdAt: number;
};
const BACKGROUND_OPTIONS: BackgroundOption[] = [
  { id: "none", label: "Normal", mode: "none" },
  { id: "blur", label: "Flou", mode: "blur" },
  { id: "studio", label: "Studio", mode: "image", imagePath: "/backgrounds/studio.svg" },
  { id: "sunset", label: "Coucher", mode: "image", imagePath: "/backgrounds/sunset.svg" },
  { id: "grid", label: "Grille", mode: "image", imagePath: "/backgrounds/grid.svg" },
];

function useMediaQueryFlag(query: string) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const apply = () => setIsMobile(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, [query]);

  return isMobile;
}

function useIsMobileViewport(breakpoint = 900) {
  return useMediaQueryFlag(`(max-width: ${breakpoint}px)`);
}

function LiveKitVideo({
  backgroundMode,
  backgroundOptions,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiBackgroundUrl,
  onAiImageGenerated,
  onClearAiBackground,
  aiGallery,
  onSaveAiBackground,
  onAiGallerySelect,
  onRefreshTranslationEntitlement,
  roomId,
  isHost,
  onChangeBackground,
  autoFrame,
  onToggleAutoFrame,
  captionsEnabled,
  captionsSupported,
  onToggleCaptions,
  captionTarget,
  onChangeCaptionTarget,
  sourceLanguageOption,
  sourceLanguage,
  onChangeSourceLanguage,
  respondInTrainingLanguage,
  onChangeRespondInTrainingLanguage,
  ttsEnabled,
  onToggleTts,
  realtimeEnabled,
  realtimeAvailable,
  realtimeVoice,
  onChangeRealtimeVoice,
  onToggleRealtime,
  realtimeError,
  onRealtimeError,
  hostLocalTtsEnabled,
  onToggleHostLocalTts,
  shareMicToGuests,
  onToggleShareMicToGuests,
  guestCaptionTarget,
  onChangeGuestCaptionTarget,
  guestTtsEnabled,
  onToggleGuestTts,
  guestTtsToken,
  translationEnabled,
  translationLockMessage,
  translationRemainingSeconds,
  onConsumeTranslationSeconds,
  ttsError,
  onTtsError,
  onDisableCaptions,
  captionSize,
  onChangeCaptionSize,
  videoFit,
  onChangeVideoFit,
  onLeaveSession,
  aiTrainingAutoStart = false,
  sessionMode = "conference",
}: {
  backgroundMode: string;
  backgroundOptions: BackgroundOption[];
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onClearAiBackground: () => void;
  aiGallery: AiGalleryItem[];
  onSaveAiBackground: (prompt: string, image: string) => void;
  onAiGallerySelect: (item: AiGalleryItem) => void;
  onRefreshTranslationEntitlement: () => Promise<void> | void;
  roomId: string;
  isHost: boolean;
  onChangeBackground: (mode: string) => void;
  autoFrame: boolean;
  onToggleAutoFrame: () => void;
  captionsEnabled: boolean;
  captionsSupported: boolean;
  onToggleCaptions: () => void;
  captionTarget: CaptionTarget;
  onChangeCaptionTarget: (target: CaptionTarget) => void;
  sourceLanguageOption: SourceLanguageOption;
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  respondInTrainingLanguage: boolean;
  onChangeRespondInTrainingLanguage: (next: boolean) => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  realtimeEnabled: boolean;
  realtimeAvailable: boolean;
  realtimeVoice: string;
  onChangeRealtimeVoice: (voice: string) => void;
  onToggleRealtime: () => void;
  realtimeError: string;
  onRealtimeError: (message: string) => void;
  hostLocalTtsEnabled: boolean;
  onToggleHostLocalTts: () => void;
  shareMicToGuests: boolean;
  onToggleShareMicToGuests: () => void;
  guestCaptionTarget: CaptionTarget;
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  guestTtsEnabled: boolean;
  onToggleGuestTts: () => void;
  guestTtsToken: string;
  translationEnabled: boolean;
  translationLockMessage: string;
  translationRemainingSeconds?: number | null;
  onConsumeTranslationSeconds: (
    seconds: number,
    origin: "local" | "remote"
  ) => Promise<boolean>;
  ttsError: string;
  onTtsError: (message: string) => void;
  onDisableCaptions: () => void;
  captionSize: "sm" | "md" | "lg";
  onChangeCaptionSize: (size: "sm" | "md" | "lg") => void;
  videoFit: "cover" | "contain";
  onChangeVideoFit: (fit: "cover" | "contain") => void;
  onLeaveSession: () => void;
  aiTrainingAutoStart?: boolean;
  sessionMode?: "conference" | "chat";
}) {
  const viewportProfile = useAiPracticeViewportProfile();
  const isMobileDevice = viewportProfile.isPhone;
  const isIPhone = viewportProfile.isApplePhone;
  const backgroundEffectsDisabled = useMemo(() => {
    return isBackgroundEffectsBlockedOnBrowser();
  }, []);
  const useMobileLayout = viewportProfile.isPhone;
  const { cameraTrack, isCameraEnabled, localParticipant } = useLocalParticipant();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const realtimeCaptionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget)?.name || "English",
    [captionTarget]
  );
  const processorRef = useRef<{
    switchTo?: (options: {
      mode: "disabled" | "background-blur" | "virtual-background";
      blurRadius?: number;
      imagePath?: string;
    }) => Promise<void>;
    destroy?: () => void;
  } | null>(null);
  const processorDisabledRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [brushColor, setBrushColor] = useState("#f87171");
  const [brushWidth, setBrushWidth] = useState(3);
  const realtimeFallbackTriggeredRef = useRef(false);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<number | null>(null);

  const drawingEnabledRef = useRef(drawingEnabled);
  const brushColorRef = useRef(brushColor);
  const brushWidthRef = useRef(brushWidth);

  useEffect(() => {
    drawingEnabledRef.current = drawingEnabled;
  }, [drawingEnabled]);
  useEffect(() => {
    brushColorRef.current = brushColor;
  }, [brushColor]);
  useEffect(() => {
    brushWidthRef.current = brushWidth;
  }, [brushWidth]);
  const realtimeAudioTracks = useTracks(
    [{ source: Track.Source.ScreenShareAudio, withPlaceholder: false }],
    { onlySubscribed: true }
  );
  const hasServerTranslatorAudio = useMemo(
    () =>
      realtimeAudioTracks.some(
        (track) =>
          isTrackReference(track) &&
          !track.participant.isLocal &&
          isTranslatorParticipantIdentity(track.participant.identity || "")
      ),
    [realtimeAudioTracks]
  );
  const hasRemotePublishedTranslationAudioTrack = hasServerTranslatorAudio;
  const effectiveGuestTtsEnabled = guestTtsEnabled && (isHost || !hasServerTranslatorAudio);
  const [widgetState, setWidgetState] = useState<{
    showChat: boolean;
    unreadMessages: number;
    showSettings?: boolean;
  }>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const handleWidgetChange = useCallback(
    (nextState: { showChat: boolean; unreadMessages: number; showSettings?: boolean }) => {
      setWidgetState((prev) => {
        if (
          prev.showChat === nextState.showChat &&
          prev.unreadMessages === nextState.unreadMessages &&
          prev.showSettings === nextState.showSettings
        ) {
          return prev;
        }
        return nextState;
      });
    },
    []
  );
  const roomChat = useRoomChat(roomId, widgetState.showChat);
  const roomTimer = useRoomTimer(roomId);
  const isChatSession = sessionMode === "chat";
  const handleRealtimeUnavailable = useCallback(
    (reason: string) => {
      if (realtimeFallbackTriggeredRef.current) return;
      realtimeFallbackTriggeredRef.current = true;
      if (realtimeEnabled) onToggleRealtime();
      if (shareMicToGuests) onToggleShareMicToGuests();
      if (!captionsEnabled) onToggleCaptions();
      if (!ttsEnabled) onToggleTts();
      onTtsError(`Realtime indisponible (${reason}). Traduction vocale activee automatiquement.`);
    },
    [
      captionsEnabled,
      onToggleCaptions,
      onToggleRealtime,
      onToggleShareMicToGuests,
      onToggleTts,
      onTtsError,
      realtimeEnabled,
      shareMicToGuests,
      ttsEnabled,
    ]
  );

  useEffect(() => {
    if (!realtimeEnabled) {
      realtimeFallbackTriggeredRef.current = false;
    }
  }, [realtimeEnabled]);

  useRealtimeTranslation({
    enabled: realtimeEnabled && realtimeAvailable,
    isHost,
    captionTargetName: realtimeCaptionTargetName,
    captionSourceName: sourceLanguageOption.name,
    realtimeVoice,
    localParticipant,
    onError: onRealtimeError,
    onStatus: setRealtimeStatus,
    onUnavailable: handleRealtimeUnavailable,
  });

  useEffect(() => {
    const track = cameraTrack?.track;
    if (
      !track ||
      typeof (track as { setProcessor?: (p?: unknown) => Promise<void> }).setProcessor !== "function"
    ) {
      return;
    }

    if (backgroundEffectsDisabled) {
      processorRef.current?.destroy?.();
      processorRef.current = null;
      processorDisabledRef.current = true;
      if (backgroundMode !== "none") {
        onChangeBackground("none");
      }
      return;
    }

    let cancelled = false;
    const mediaStreamTrack = (
      track as unknown as { mediaStreamTrack?: MediaStreamTrack }
    ).mediaStreamTrack;
    const onCaptureEnded = () => {
      processorDisabledRef.current = true;
      if (processorRef.current?.switchTo) {
        void processorRef.current.switchTo({ mode: "disabled" }).catch(() => {});
      }
      if (backgroundMode !== "none") {
        onChangeBackground("none");
      }
    };
    mediaStreamTrack?.addEventListener("ended", onCaptureEnded);

    const applyProcessor = async () => {
      if (processorDisabledRef.current) return;
      if (backgroundEffectsDisabled) return;

      let processorModule: typeof import("@livekit/track-processors");
      try {
        processorModule = await import("@livekit/track-processors");
      } catch {
        processorDisabledRef.current = true;
        if (backgroundMode !== "none") {
          onChangeBackground("none");
        }
        return;
      }

      const { BackgroundProcessor, supportsBackgroundProcessors } = processorModule;
      if (!supportsBackgroundProcessors()) return;

      if (!processorRef.current) {
        try {
          const processor = BackgroundProcessor({
            mode: "disabled",
            assetPaths: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
            },
          });
          if (cancelled) {
            processor?.destroy?.();
            return;
          }
          processorRef.current = processor as unknown as {
            switchTo?: (options: {
              mode: "disabled" | "background-blur" | "virtual-background";
              blurRadius?: number;
              imagePath?: string;
            }) => Promise<void>;
            destroy?: () => void;
          };
          await (track as unknown as { setProcessor: (p?: unknown) => Promise<void> }).setProcessor(
            processor
          );
        } catch {
          processorDisabledRef.current = true;
          if (backgroundMode !== "none") {
            onChangeBackground("none");
          }
          return;
        }
      }

      const selected = backgroundOptions.find((opt) => opt.id === backgroundMode);
      if (!selected || !processorRef.current?.switchTo) return;

      if (selected.mode === "none") {
        await processorRef.current.switchTo({ mode: "disabled" });
        return;
      }
      if (selected.mode === "blur") {
        const blurRadius = isMobileDevice ? 4 : 10;
        try {
          await processorRef.current.switchTo({ mode: "background-blur", blurRadius });
        } catch {
          processorDisabledRef.current = true;
          onChangeBackground("none");
        }
        return;
      }
      if (selected.mode === "image" && selected.imagePath) {
        try {
          await processorRef.current.switchTo({
            mode: "virtual-background",
            imagePath: selected.imagePath,
          });
        } catch {
          processorDisabledRef.current = true;
          onChangeBackground("none");
        }
      }
    };

    void applyProcessor();

    return () => {
      cancelled = true;
      mediaStreamTrack?.removeEventListener("ended", onCaptureEnded);
    };
  }, [
    backgroundEffectsDisabled,
    backgroundMode,
    backgroundOptions,
    cameraTrack?.track,
    isMobileDevice,
    onChangeBackground,
  ]);

  return (
    <>
        <SettingsDrawer
        roomId={roomId}
        isHost={isHost}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        autoFrame={autoFrame}
        onToggleAutoFrame={onToggleAutoFrame}
        captionsEnabled={captionsEnabled}
        captionsSupported={captionsSupported}
        onToggleCaptions={onToggleCaptions}
        captionTarget={captionTarget}
        onChangeCaptionTarget={onChangeCaptionTarget}
        sourceLanguage={sourceLanguage}
        onChangeSourceLanguage={onChangeSourceLanguage}
        ttsEnabled={ttsEnabled}
        onToggleTts={onToggleTts}
        realtimeEnabled={realtimeEnabled}
        realtimeAvailable={realtimeAvailable}
        realtimeVoice={realtimeVoice}
        onChangeRealtimeVoice={onChangeRealtimeVoice}
        onToggleRealtime={onToggleRealtime}
        realtimeStatus={realtimeStatus}
        realtimeError={realtimeError}
        hostLocalTtsEnabled={hostLocalTtsEnabled}
        onToggleHostLocalTts={onToggleHostLocalTts}
        shareMicToGuests={shareMicToGuests}
        onToggleShareMicToGuests={onToggleShareMicToGuests}
        guestCaptionTarget={guestCaptionTarget}
        guestTtsEnabled={effectiveGuestTtsEnabled}
        guestTtsDisabled={!isHost && hasServerTranslatorAudio}
        onToggleGuestTts={onToggleGuestTts}
        ttsError={ttsError}
        captionSize={captionSize}
        onChangeCaptionSize={onChangeCaptionSize}
        videoFit={videoFit}
        onChangeVideoFit={onChangeVideoFit}
        backgroundMode={backgroundMode}
        onChangeBackground={onChangeBackground}
        backgroundDisabled={backgroundEffectsDisabled}
        customBackgrounds={customBackgrounds}
        onAddCustomBackground={onAddCustomBackground}
        onRemoveCustomBackground={onRemoveCustomBackground}
        aiBackgroundUrl={aiBackgroundUrl}
        onAiImageGenerated={onAiImageGenerated}
        onSaveAiBackground={onSaveAiBackground}
        onAiBackgroundClear={onClearAiBackground}
        aiGallery={aiGallery}
        onAiGallerySelect={onAiGallerySelect}
        onRefreshTranslationEntitlement={onRefreshTranslationEntitlement}
        />
      {useMobileLayout ? (
        <LiveKitConferenceMobile
          roomId={roomId}
          isHost={isHost}
          captionsEnabled={captionsEnabled}
          guestTtsEnabled={effectiveGuestTtsEnabled}
          hasRemotePublishedTranslationAudioTrack={hasRemotePublishedTranslationAudioTrack}
          onToggleGuestTts={onToggleGuestTts}
          shareMicToGuests={shareMicToGuests}
          realtimeEnabled={realtimeEnabled}
          realtimeAvailable={realtimeAvailable}
          realtimeVoice={realtimeVoice}
          captionTarget={captionTarget}
          widgetState={widgetState}
          onWidgetChange={handleWidgetChange}
          roomChat={roomChat}
          timerState={roomTimer.state}
          onOpenSettings={() => setSettingsOpen(true)}
          onLeaveSession={onLeaveSession}
          autoFrame={autoFrame}
          captionSize={captionSize}
          videoFit={videoFit}
          sourceLanguage={sourceLanguage}
          onChangeSourceLanguage={onChangeSourceLanguage}
          respondInTrainingLanguage={respondInTrainingLanguage}
          onChangeRespondInTrainingLanguage={onChangeRespondInTrainingLanguage}
          onChangeCaptionTarget={onChangeCaptionTarget}
          guestCaptionTarget={guestCaptionTarget}
          onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
          guestTtsToken={guestTtsToken}
          translationEnabled={translationEnabled}
          translationLockMessage={translationLockMessage}
          translationRemainingSeconds={translationRemainingSeconds}
          onConsumeTranslationSeconds={onConsumeTranslationSeconds}
          backgroundMode={backgroundMode}
          onChangeBackground={onChangeBackground}
          customBackgrounds={customBackgrounds}
          onAddCustomBackground={onAddCustomBackground}
          onRemoveCustomBackground={onRemoveCustomBackground}
          isSettingsOpen={settingsOpen}
          aiBackgroundUrl={aiBackgroundUrl}
          onAiImageGenerated={onAiImageGenerated}
          onClearAiBackground={onClearAiBackground}
          aiGallery={aiGallery}
          onAiGallerySelect={onAiGallerySelect}
          onSaveAiBackground={onSaveAiBackground}
          aiTrainingAutoStart={aiTrainingAutoStart}
          isChatSession={isChatSession}
        />
      ) : (
        <LiveKitConference
          roomId={roomId}
          widgetState={widgetState}
          onWidgetChange={handleWidgetChange}
          roomChat={roomChat}
          timerState={roomTimer.state}
          onOpenSettings={() => setSettingsOpen(true)}
          onLeaveSession={onLeaveSession}
          autoFrame={autoFrame}
          captionsEnabled={captionsEnabled}
          captionsSupported={captionsSupported}
          captionTarget={captionTarget}
          ttsEnabled={ttsEnabled}
          realtimeEnabled={realtimeEnabled}
          realtimeAvailable={realtimeAvailable}
          realtimeVoice={realtimeVoice}
          onRealtimeError={onRealtimeError}
          hostLocalTtsEnabled={hostLocalTtsEnabled}
          shareMicToGuests={shareMicToGuests}
          guestTtsEnabled={effectiveGuestTtsEnabled}
          hasRemotePublishedTranslationAudioTrack={hasRemotePublishedTranslationAudioTrack}
          onToggleGuestTts={onToggleGuestTts}
          ttsError={ttsError}
          isHost={isHost}
          onDisableCaptions={onDisableCaptions}
          captionSize={captionSize}
          videoFit={videoFit}
          onTtsError={onTtsError}
          sourceLanguageOption={sourceLanguageOption}
          sourceLanguage={sourceLanguage}
          onChangeSourceLanguage={onChangeSourceLanguage}
          respondInTrainingLanguage={respondInTrainingLanguage}
          onChangeRespondInTrainingLanguage={onChangeRespondInTrainingLanguage}
          onChangeCaptionTarget={onChangeCaptionTarget}
          guestCaptionTarget={guestCaptionTarget}
          onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
          guestTtsToken={guestTtsToken}
          translationEnabled={translationEnabled}
          translationLockMessage={translationLockMessage}
          translationRemainingSeconds={translationRemainingSeconds}
          onConsumeTranslationSeconds={onConsumeTranslationSeconds}
          backgroundMode={backgroundMode}
          onChangeBackground={onChangeBackground}
          customBackgrounds={customBackgrounds}
          onAddCustomBackground={onAddCustomBackground}
          onRemoveCustomBackground={onRemoveCustomBackground}
          aiBackgroundUrl={aiBackgroundUrl}
          onAiImageGenerated={onAiImageGenerated}
          onClearAiBackground={onClearAiBackground}
          aiGallery={aiGallery}
          onAiGallerySelect={onAiGallerySelect}
          onSaveAiBackground={onSaveAiBackground}
          isSettingsOpen={settingsOpen}
          aiTrainingAutoStart={aiTrainingAutoStart}
          isChatSession={isChatSession}
        />
      )}
    </>
  );
}

type ChatMessage = {
  id: string;
  text: string;
  originalText?: string;
  translatedText?: string;
  sourceLang?: string;
  targetLang?: string;
  from: string;
  fromName?: string;
  to: "all" | string;
  timestamp: number;
  roomId?: string;
};

type RoomTimerState = {
  durationMs: number;
  remainingMs: number;
  running: boolean;
};

type RoomTimerActions = {
  setDuration: (ms: number) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
};

function useRoomChat(roomId: string, isChatOpen: boolean) {
  const { localParticipant } = useLocalParticipant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastMessage, setToastMessage] = useState("");
  const seenMessageIds = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | null>(null);
  const lastAlertAtRef = useRef(0);
  const { message: incoming, send, isSending } = useDataChannel("bfzoom-chat");

  const localId = localParticipant?.identity || "local";
  const localName = localParticipant?.name || "Moi";

  const showIncomingToast = useCallback((payload: ChatMessage) => {
    const body = (payload.translatedText || payload.text || "").trim();
    if (!body) return;
    const from = (payload.fromName || "Nouveau message").trim();
    const shortBody = body.length > 80 ? `${body.slice(0, 77)}...` : body;
    setToastMessage(`${from}: ${shortBody}`);
    if (typeof window === "undefined") return;
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!incoming?.payload) return;
    const decoder = new TextDecoder();
    try {
      const text = decoder.decode(incoming.payload);
      const payload = JSON.parse(text) as ChatMessage;
      if (payload.roomId && payload.roomId !== roomId) return;
      if (payload.to !== "all") return;
      if (!payload.id || seenMessageIds.current.has(payload.id)) return;
      seenMessageIds.current.add(payload.id);
      if (payload.from === localId) return;
      queueMicrotask(() => {
        setMessages((prev) => [...prev, payload]);
        if (!isChatOpen) {
          setUnreadCount((count) => count + 1);
          showIncomingToast(payload);
          const now = Date.now();
          if (now - lastAlertAtRef.current > 900) {
            lastAlertAtRef.current = now;
            playChatNotificationTone();
          }
          if (
            typeof document !== "undefined" &&
            document.hidden &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            const title = payload.fromName?.trim()
              ? `Message de ${payload.fromName.trim()}`
              : "Nouveau message BFZoom";
            const body = (payload.translatedText || payload.text || "").trim();
            if (body) {
              const safeBody = body.length > 140 ? `${body.slice(0, 137)}...` : body;
              try {
                new Notification(title, { body: safeBody, silent: false });
              } catch {
                // Ignore notification errors (browser policy / permission race).
              }
            }
          }
        }
      });
    } catch (err) {
      console.warn("Chat payload invalide", err);
    }
  }, [incoming, isChatOpen, localId, roomId, showIncomingToast]);

  useEffect(() => {
    if (isChatOpen && unreadCount > 0) {
      queueMicrotask(() => {
        setUnreadCount(0);
      });
    }
    if (isChatOpen && toastMessage) {
      setToastMessage("");
      if (typeof window !== "undefined" && toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    }
  }, [isChatOpen, unreadCount, toastMessage]);

  const sendMessage = async (
    input:
      | string
      | {
          text: string;
          originalText?: string;
          translatedText?: string;
          sourceLang?: string;
          targetLang?: string;
        },
    opts?: { fromName?: string }
  ) => {
    const text = typeof input === "string" ? input.trim() : input.text.trim();
    if (!text) return;
    const payload: ChatMessage & { roomId: string } = {
      id: safeRandomId(),
      text,
      originalText: typeof input === "string" ? undefined : input.originalText,
      translatedText: typeof input === "string" ? undefined : input.translatedText,
      sourceLang: typeof input === "string" ? undefined : input.sourceLang,
      targetLang: typeof input === "string" ? undefined : input.targetLang,
      from: localId,
      fromName: opts?.fromName || localName,
      to: "all",
      timestamp: Date.now(),
      roomId,
    };
    if (payload.id) {
      seenMessageIds.current.add(payload.id);
    }
    setMessages((prev) => [...prev, payload]);
    const encoder = new TextEncoder();
    await send(encoder.encode(JSON.stringify(payload)), {
      reliable: true,
      topic: "bfzoom-chat",
    });
  };

  return {
    messages,
    unreadCount,
    toastMessage,
    setUnreadCount,
    sendMessage,
    isSending,
  };
}

function useRoomTimer(roomId: string) {
  const { message: incoming, send } = useDataChannel("bfzoom-timer");
  const [state, setState] = useState<RoomTimerState>({
    durationMs: 0,
    remainingMs: 0,
    running: false,
  });
  const startMetaRef = useRef<{ startedAt: number; baseRemaining: number } | null>(null);

  useEffect(() => {
    if (!incoming?.payload) return;
    const decoder = new TextDecoder();
    try {
      const text = decoder.decode(incoming.payload);
      const payload = JSON.parse(text) as {
        roomId?: string;
        type: "set" | "start" | "pause" | "reset";
        durationMs?: number;
        remainingMs?: number;
        startedAt?: number;
      };
      if (payload.roomId && payload.roomId !== roomId) return;
      if (payload.type === "set") {
        const nextDuration = Math.max(0, payload.durationMs ?? 0);
        queueMicrotask(() => {
          setState({ durationMs: nextDuration, remainingMs: nextDuration, running: false });
        });
        startMetaRef.current = null;
      }
      if (payload.type === "start") {
        const remaining = Math.max(0, payload.remainingMs ?? state.remainingMs);
        const startedAt = payload.startedAt ?? Date.now();
        startMetaRef.current = { startedAt, baseRemaining: remaining };
        queueMicrotask(() => {
          setState((prev) => ({ ...prev, remainingMs: remaining, running: true }));
        });
      }
      if (payload.type === "pause") {
        const remaining = Math.max(0, payload.remainingMs ?? state.remainingMs);
        startMetaRef.current = null;
        queueMicrotask(() => {
          setState((prev) => ({ ...prev, remainingMs: remaining, running: false }));
        });
      }
      if (payload.type === "reset") {
        startMetaRef.current = null;
        queueMicrotask(() => {
          setState((prev) => ({
            ...prev,
            remainingMs: prev.durationMs,
            running: false,
          }));
        });
      }
    } catch (err) {
      console.warn("Timer payload invalide", err);
    }
  }, [incoming, roomId, state.remainingMs]);

  useEffect(() => {
    if (!state.running || !startMetaRef.current) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const { startedAt, baseRemaining } = startMetaRef.current!;
      const elapsed = now - startedAt;
      const nextRemaining = Math.max(0, baseRemaining - elapsed);
      queueMicrotask(() => {
        setState((prev) => ({ ...prev, remainingMs: nextRemaining }));
      });
      if (nextRemaining === 0) {
        startMetaRef.current = null;
        queueMicrotask(() => {
          setState((prev) => ({ ...prev, running: false }));
        });
      }
    }, 250);
    return () => clearInterval(interval);
  }, [state.running]);

  const broadcast = async (payload: Record<string, unknown>) => {
    const encoder = new TextEncoder();
    await send(encoder.encode(JSON.stringify({ roomId, ...payload })), {
      reliable: true,
      topic: "bfzoom-timer",
    });
  };

  const actions: RoomTimerActions = {
    setDuration: (ms) => {
      const nextDuration = Math.max(0, ms);
      setState({ durationMs: nextDuration, remainingMs: nextDuration, running: false });
      startMetaRef.current = null;
      void broadcast({ type: "set", durationMs: nextDuration });
    },
    start: () => {
      const remaining = state.remainingMs || state.durationMs;
      const startedAt = Date.now();
      startMetaRef.current = { startedAt, baseRemaining: remaining };
      setState((prev) => ({ ...prev, remainingMs: remaining, running: true }));
      void broadcast({ type: "start", remainingMs: remaining, startedAt });
    },
    pause: () => {
      const remaining = state.remainingMs;
      startMetaRef.current = null;
      setState((prev) => ({ ...prev, remainingMs: remaining, running: false }));
      void broadcast({ type: "pause", remainingMs: remaining });
    },
    reset: () => {
      startMetaRef.current = null;
      setState((prev) => ({
        ...prev,
        remainingMs: prev.durationMs,
        running: false,
      }));
      void broadcast({ type: "reset" });
    },
  };

  return { state, actions };
}


function LiveKitConference({
  roomId,
  widgetState,
  onWidgetChange,
  roomChat,
  timerState,
  onOpenSettings,
  onLeaveSession,
  autoFrame,
  captionsEnabled,
  captionsSupported,
  captionTarget,
  ttsEnabled,
  realtimeEnabled,
  realtimeAvailable,
  realtimeVoice,
  onRealtimeError,
  hostLocalTtsEnabled,
  shareMicToGuests,
  guestTtsEnabled,
  hasRemotePublishedTranslationAudioTrack,
  onToggleGuestTts,
  ttsError,
  isHost,
  onDisableCaptions,
  captionSize,
  videoFit,
  onTtsError,
  sourceLanguageOption,
  sourceLanguage,
  onChangeSourceLanguage,
  respondInTrainingLanguage,
  onChangeRespondInTrainingLanguage,
  onChangeCaptionTarget,
  guestCaptionTarget,
  onChangeGuestCaptionTarget,
  guestTtsToken,
  translationEnabled,
  translationLockMessage,
  translationRemainingSeconds,
  onConsumeTranslationSeconds,
  backgroundMode,
  onChangeBackground,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiGallery,
  onAiGallerySelect,
  aiBackgroundUrl,
  onAiImageGenerated,
  onClearAiBackground,
  onSaveAiBackground,
  isSettingsOpen,
  aiTrainingAutoStart = false,
  isChatSession = false,
}: {
  roomId: string;
  widgetState: { showChat: boolean; unreadMessages: number; showSettings?: boolean };
  onWidgetChange: (state: { showChat: boolean; unreadMessages: number; showSettings?: boolean }) => void;
  roomChat: ReturnType<typeof useRoomChat>;
  timerState: RoomTimerState;
  onOpenSettings: () => void;
  onLeaveSession: () => void;
  autoFrame: boolean;
  captionsEnabled: boolean;
  captionsSupported: boolean;
  captionTarget: CaptionTarget;
  ttsEnabled: boolean;
  realtimeEnabled: boolean;
  realtimeAvailable: boolean;
  realtimeVoice: string;
  onRealtimeError: (message: string) => void;
  hostLocalTtsEnabled: boolean;
  shareMicToGuests: boolean;
  guestTtsEnabled: boolean;
  hasRemotePublishedTranslationAudioTrack: boolean;
  onToggleGuestTts: () => void;
  ttsError: string;
  isHost: boolean;
  onDisableCaptions: () => void;
  captionSize: "sm" | "md" | "lg";
  videoFit: "cover" | "contain";
  onTtsError: (message: string) => void;
  sourceLanguageOption: SourceLanguageOption;
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  respondInTrainingLanguage: boolean;
  onChangeRespondInTrainingLanguage: (next: boolean) => void;
  onChangeCaptionTarget: (target: CaptionTarget) => void;
  guestCaptionTarget: CaptionTarget;
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  guestTtsToken: string;
  translationEnabled: boolean;
  translationLockMessage: string;
  translationRemainingSeconds?: number | null;
  onConsumeTranslationSeconds: (
    seconds: number,
    origin: "local" | "remote"
  ) => Promise<boolean>;
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onClearAiBackground: () => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  isSettingsOpen: boolean;
  aiTrainingAutoStart?: boolean;
  isChatSession?: boolean;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const layoutContext = useCreateLayoutContext();
  const [isMobile, setIsMobile] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState<InviteCopyFeedback | null>(null);
  const [shareInviteId, setShareInviteId] = useState("");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const [actionControlsState, setActionControlsState] = useState({
    visible: false,
    lastAction: "",
  });
  const isIPhone = useMemo(() => {
    return isApplePhonePlatform();
  }, []);
  const backgroundEffectsDisabled = useMemo(() => {
    return isBackgroundEffectsBlockedOnBrowser();
  }, []);
  const { send: sendAction } = useDataChannel("bfzoom-actions");
  const sendActionItem = useCallback(
    async (type: string) => {
      if (!sendAction) return;
      const text = actionControlsState.lastAction;
      if (!text) return;
      const payload = {
        id: safeRandomId(),
        type,
        text,
        roomId,
        timestamp: Date.now(),
      };
      const encoder = new TextEncoder();
      await sendAction(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic: "bfzoom-actions",
      });
      setActionControlsState((state) => ({ ...state, visible: false }));
    },
    [actionControlsState.lastAction, roomId, sendAction]
  );
  useEffect(() => {
    if (aiTrainingAutoStart) return;
    if (!isHost || !roomId || typeof window === "undefined") return;
    const key = `bfzoom:invite-opened:${roomId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setInviteOpen(true);
  }, [aiTrainingAutoStart, isHost, roomId]);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [isTogglingCamera, setIsTogglingCamera] = useState(false);
  const remoteParticipants = useRemoteParticipants();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    lastMicrophoneError,
    lastCameraError,
  } = useLocalParticipant();

  useEffect(() => {
    if (!isHost || shareMicToGuests) return;
    if (!localParticipant) return;
    void localParticipant.setMicrophoneEnabled(false);
  }, [isHost, localParticipant, shareMicToGuests]);
  const room = useRoomContext();
  useHostRoomHeartbeat({
    room,
    roomId,
    isHost,
    sessionMode: isChatSession ? "chat" : "conference",
  });
  const roomIsRecovering =
    room.state === ConnectionState.Reconnecting ||
    room.state === ConnectionState.SignalReconnecting;
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false);
  const activateRoomAudio = useCallback(async () => {
    try {
      await room.startAudio();
      setAudioUnlockRequired(!room.canPlaybackAudio);
    } catch {
      setAudioUnlockRequired(true);
    }
  }, [room]);
  useEffect(() => {
    // Try once on mount; if browser blocks autoplay, fallback UX stays available.
    void activateRoomAudio();
  }, [activateRoomAudio]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncAudioStatus = () => {
      setAudioUnlockRequired(!room.canPlaybackAudio);
    };
    syncAudioStatus();
    const onVisibilityChange = () => syncAudioStatus();
    const onPageShow = () => syncAudioStatus();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [room]);

  useEffect(() => {
    if (!audioUnlockRequired || typeof window === "undefined") return;
    const onFirstInteraction = () => {
      void activateRoomAudio();
    };
    window.addEventListener("pointerdown", onFirstInteraction, { passive: true });
    window.addEventListener("touchstart", onFirstInteraction, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("touchstart", onFirstInteraction);
    };
  }, [activateRoomAudio, audioUnlockRequired]);

  const handleLeaveRoom = useCallback(() => {
    onLeaveSession();
    void room.disconnect();
  }, [onLeaveSession, room]);
  const [endingRoomForAll, setEndingRoomForAll] = useState(false);
  const [endRoomError, setEndRoomError] = useState("");
  const handleEndRoomForAll = useCallback(async () => {
    if (!isHost || endingRoomForAll) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Terminer la reunion pour tous les participants ? Cette action est immediate."
      );
      if (!confirmed) return;
    }
    setEndRoomError("");
    setEndingRoomForAll(true);
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch("/api/livekit/room/end", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ room: roomId }),
      });
      if (!response.ok) {
        const message = await readApiErrorMessage(response);
        throw new Error(message);
      }
      handleLeaveRoom();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Impossible de terminer la reunion.";
      setEndRoomError(toFriendlyAiError(message));
    } finally {
      setEndingRoomForAll(false);
    }
  }, [endingRoomForAll, handleLeaveRoom, isHost, roomId]);
  const lastCameraRefreshRef = useRef(0);
  const initialPageShowRef = useRef(true);
  const lastAutoPinnedParticipantRef = useRef<string | null>(null);
  const manualPinRef = useRef(false);
  const lastAutoSpeakerRef = useRef<string | null>(null);
  const lastAutoSpeakerSwitchRef = useRef(0);
  const [mediaError, setMediaError] = useState<string>("");
  const [sourceText, setSourceText] = useState("");
  const [sourceFromLocal, setSourceFromLocal] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [captionPhoneticText, setCaptionPhoneticText] = useState("");
  const [captionPhoneticTarget, setCaptionPhoneticTarget] = useState<CaptionTarget>(
    DEFAULT_CAPTION_TARGET
  );
  const [captionError, setCaptionError] = useState("");
  const [pushToTalkActive, setPushToTalkActive] = useState(false);
  const [pushToTalkBusy, setPushToTalkBusy] = useState(false);
  const [pushToTalkInterruptHint, setPushToTalkInterruptHint] = useState("");
  const [pushToTalkDraft, setPushToTalkDraft] = useState<PushToTalkDraft | null>(null);
  const [pushToTalkDraftText, setPushToTalkDraftText] = useState("");
  const [pushToTalkDraftEditing, setPushToTalkDraftEditing] = useState(false);
  const [pushToTalkDraftReview, setPushToTalkDraftReview] = useState<PushToTalkDraftReview | null>(
    null
  );
  const [pushToTalkDraftReviewBusy, setPushToTalkDraftReviewBusy] = useState(false);
  const [pushToTalkGestureHint, setPushToTalkGestureHint] = useState("");
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToTalkInterruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToTalkDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPartnerOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { message: captionIncoming, send: sendCaption } = useDataChannel("bfzoom-captions");
  const { message: translationAccessIncoming, send: sendTranslationAccess } =
    useDataChannel(TRANSLATION_ACCESS_TOPIC);
  const { message: talkieLockIncoming, send: sendTalkieLock } =
    useDataChannel(TALKIE_LOCK_TOPIC);
  const [talkieLockHolderIdentity, setTalkieLockHolderIdentity] = useState("");
  const [talkieLockHolderName, setTalkieLockHolderName] = useState("");
  const talkieLockHolderRef = useRef("");
  const talkieLockExpiresAtRef = useRef(0);
  const talkieLockTimestampRef = useRef(0);
  const talkieLockExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCaptionSentAtRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const ttsTrackRef = useRef<LocalAudioTrack | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsContextRef = useRef<AudioContext | null>(null);
  const ttsDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const { speakCaption: speakGuestCaption, stopCaptionPlayback: stopGuestCaptionPlayback } =
    useGuestCaptionPlayer(realtimeVoice, setCaptionError, guestTtsToken);
  const pushToTalkRecorderRef = useRef<MediaRecorder | null>(null);
  const pushToTalkStreamRef = useRef<MediaStream | null>(null);
  const pushToTalkWarmStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToTalkWarmupDoneRef = useRef(false);
  const pushToTalkWarmupInFlightRef = useRef<Promise<void> | null>(null);
  const pushToTalkChunksRef = useRef<BlobPart[]>([]);
  const pushToTalkMimeTypeRef = useRef("audio/webm");
  const pushToTalkPressedRef = useRef(false);
  const pushToTalkStartedAtRef = useRef<number | null>(null);
  const pushToTalkSessionRef = useRef(0);
  const pushToTalkPointerIdRef = useRef<number | null>(null);
  const pushToTalkPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pushToTalkCancelArmedRef = useRef(false);
  const pushToTalkDraftIdRef = useRef(0);
  const pushToTalkDraftReviewRequestRef = useRef(0);
  const pushToTalkDraftReviewAbortRef = useRef<AbortController | null>(null);
  const pushToTalkDraftReviewCacheRef = useRef<Map<string, PushToTalkDraftReview>>(new Map());
  const activeTranslationRequestRef = useRef(0);
  const activeTranslationAbortRef = useRef<AbortController | null>(null);
  const activeAiPartnerRequestRef = useRef(0);
  const activeAiPartnerAbortRef = useRef<AbortController | null>(null);
  const consumedIncomingCaptionIdsRef = useRef<Set<string>>(new Set());
  const guestTranslationCacheRef = useRef<Map<string, string>>(new Map());
  const guestTranslationInFlightRef = useRef<Map<string, Promise<string>>>(new Map());
  const phoneticCacheRef = useRef<Map<string, string>>(new Map());
  const phoneticRequestRef = useRef(0);
  const guestCaptionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === guestCaptionTarget)?.name || "English",
    [guestCaptionTarget]
  );
  const sourceLanguageName = sourceLanguageOption.name;
  const sourceLanguageLocale = sourceLanguageOption.recognitionLocale;
  const [exercisePhoneticEnabled] = useState(true);
  const localReceptionTarget = guestCaptionTarget;
  const localReceptionTargetName = guestCaptionTargetName;
  const captionDisplayTarget = captionPhoneticTarget || localReceptionTarget;
  const captionDisplayTargetName = useMemo(
    () =>
      CAPTION_TARGETS_CONFIG.find((item) => item.code === captionDisplayTarget)?.name ||
      resolveLanguageNameFromCode(captionDisplayTarget) ||
      localReceptionTargetName,
    [captionDisplayTarget, localReceptionTargetName]
  );
  const captionTargetLabel = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionDisplayTarget)?.label || "EN",
    [captionDisplayTarget]
  );
  const localReceptionHint = guestTtsEnabled
    ? "Communication: choisis la langue dans laquelle tu recois texte + voix sur ton appareil."
    : "Personnel: langue que tu recois (texte + voix) sur ton appareil.";
  const translationController = isHost || isChatSession;
  const [roomTranslationEnabled, setRoomTranslationEnabled] = useState(
    translationController ? translationEnabled : false
  );
  const [roomTranslationReason, setRoomTranslationReason] = useState(
    translationController
      ? translationLockMessage || TRANSLATION_UNLOCK_HINT
      : TRANSLATION_WAIT_HOST_HINT
  );
  const [roomTranslationRemainingSeconds, setRoomTranslationRemainingSeconds] = useState<
    number | null
  >(
    translationController && typeof translationRemainingSeconds === "number"
      ? Math.max(0, Math.floor(translationRemainingSeconds))
      : null
  );
  useEffect(() => {
    if (!translationController) return;
    setRoomTranslationEnabled(translationEnabled);
    setRoomTranslationReason(translationLockMessage || TRANSLATION_UNLOCK_HINT);
    setRoomTranslationRemainingSeconds(
      typeof translationRemainingSeconds === "number" &&
        Number.isFinite(translationRemainingSeconds)
        ? Math.max(0, Math.floor(translationRemainingSeconds))
        : null
    );
  }, [translationController, translationEnabled, translationLockMessage, translationRemainingSeconds]);
  const effectiveTranslationEnabled = translationController
    ? translationEnabled
    : roomTranslationEnabled;
  const effectiveTranslationLockMessage = effectiveTranslationEnabled
    ? ""
    : translationController
    ? translationLockMessage || TRANSLATION_UNLOCK_HINT
    : roomTranslationReason || TRANSLATION_WAIT_HOST_HINT;
  const effectiveTranslationRemainingSeconds = translationController
    ? typeof translationRemainingSeconds === "number" &&
      Number.isFinite(translationRemainingSeconds)
      ? Math.max(0, Math.floor(translationRemainingSeconds))
      : null
    : roomTranslationRemainingSeconds;
  const translationRemainingLabel = formatTranslationRemaining(
    effectiveTranslationRemainingSeconds
  );
  const translationControlsDisabled = !effectiveTranslationEnabled;
  const translationUnavailableMessage =
    effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT;
  const resolveGuestTranslationForTarget = useCallback(
    async (
      translationInput: string,
      translationFromCode: string | undefined,
      translationFromName: string,
      targetCode: CaptionTargetCode,
      targetName: string,
      signal?: AbortSignal
    ) => {
      const normalizedInput = translationInput.trim();
      if (!normalizedInput) return "";
      if (normalizeCaptionTargetCode(translationFromCode) === targetCode) {
        return normalizedInput;
      }
      const translationCacheKey = buildTranslationCacheKey(
        normalizedInput,
        translationFromCode || "",
        targetCode
      );
      const cachedTranslation = guestTranslationCacheRef.current.get(translationCacheKey);
      if (cachedTranslation) return cachedTranslation;

      let inFlightTranslation = guestTranslationInFlightRef.current.get(translationCacheKey);
      if (!inFlightTranslation) {
        inFlightTranslation = translateWithOpenAi(
          normalizedInput,
          translationFromName,
          targetName,
          {
            fromCode: translationFromCode,
            toCode: targetCode,
            guestToken: guestTtsToken,
            signal,
            intent: "translation",
          }
        ).then((result) => result.trim());
        guestTranslationInFlightRef.current.set(translationCacheKey, inFlightTranslation);
      }

      try {
        const translated = await inFlightTranslation;
        if (translated) {
          upsertLruValue(
            guestTranslationCacheRef.current,
            translationCacheKey,
            translated,
            GUEST_TRANSLATION_CACHE_LIMIT
          );
        }
        return translated;
      } finally {
        const currentInFlight = guestTranslationInFlightRef.current.get(translationCacheKey);
        if (currentInFlight === inFlightTranslation) {
          guestTranslationInFlightRef.current.delete(translationCacheKey);
        }
      }
    },
    [guestTtsToken]
  );
  const aiPartnerAvailable =
    AI_PARTNER_TRAINING_ENABLED && isHost && (aiTrainingAutoStart || remoteParticipants.length === 0);
  const [aiPartnerEnabled, setAiPartnerEnabled] = useState(false);
  const [aiPartnerBusy, setAiPartnerBusy] = useState(false);
  const [aiPartnerLastReply, setAiPartnerLastReply] = useState("");
  const [aiPartnerLastTranslatedReply, setAiPartnerLastTranslatedReply] = useState("");
  const [aiPartnerFeedbackSource, setAiPartnerFeedbackSource] = useState("");
  const [aiPartnerFeedbackTranslated, setAiPartnerFeedbackTranslated] = useState("");
  const [aiPartnerFeedbackFrench, setAiPartnerFeedbackFrench] = useState("");
  const [aiPartnerFeedbackFrenchBusy, setAiPartnerFeedbackFrenchBusy] = useState(false);
  const [aiPartnerFeedbackView, setAiPartnerFeedbackView] =
    useState<AiPartnerFeedbackView>("target");
  const [aiPartnerOverlayText, setAiPartnerOverlayText] = useState("");
  const [aiPartnerView, setAiPartnerView] = useState<"translation" | "source">("translation");
  const [aiPartnerScenario, setAiPartnerScenario] = useState<AiPartnerScenario>("auto");
  const [aiPartnerTone, setAiPartnerTone] = useState<AiPartnerTone>("friendly");
  const [aiPartnerAvatarTheme, setAiPartnerAvatarTheme] =
    useState<AiPartnerAvatarTheme>("neutral");
  const [aiPartnerCoachPhoneticText, setAiPartnerCoachPhoneticText] = useState("");
  const [aiPartnerCoachPhoneticBusy, setAiPartnerCoachPhoneticBusy] = useState(false);
  const aiPartnerBusyRef = useRef(false);
  const aiPartnerCameraWasAutoDisabledRef = useRef(false);
  const aiPartnerConversationRef = useRef<AiPartnerConversationMessage[]>([]);
  const aiPracticeLanguageConfigRef = useRef({
    sourceLanguage,
    trainingTarget: localReceptionTarget,
    respondInTrainingLanguage,
  });
  const aiPartnerCoachPhoneticCacheRef = useRef<Map<string, string>>(new Map());
  const aiPartnerCoachPhoneticRequestRef = useRef(0);
  const aiPartnerActive = aiPartnerAvailable && aiPartnerEnabled;
  const pushToTalkDraftReviewMode: PushToTalkDraftReviewMode = aiTrainingAutoStart
    ? "coach"
    : "translation";
  const shouldUsePushToTalkDraftReview = aiTrainingAutoStart
    ? aiPartnerActive
    : captionsEnabled && !isChatSession;
  const activeSpeechLanguageCode =
    respondInTrainingLanguage && aiPartnerActive ? localReceptionTarget : sourceLanguage;
  const activeSpeechLanguageName =
    respondInTrainingLanguage && aiPartnerActive
      ? resolveLanguageNameFromCode(localReceptionTarget) || localReceptionTargetName
      : sourceLanguageName;
  const activeSpeechLanguageLocale =
    respondInTrainingLanguage && aiPartnerActive
      ? resolveSpeechLocaleFromLanguage(localReceptionTarget) || sourceLanguageLocale
      : sourceLanguageLocale;
  const aiPartnerOverlayVisible = aiPartnerActive && Boolean(aiPartnerOverlayText);
  const aiPartnerCanToggleView =
    aiPartnerLastTranslatedReply.trim().length > 0 &&
    aiPartnerLastReply.trim().length > 0 &&
    aiPartnerLastTranslatedReply.trim() !== aiPartnerLastReply.trim();
  const aiPartnerDisplayText = aiPartnerOverlayVisible
    ? aiPartnerOverlayText
    : aiPartnerBusy
    ? "En train de repondre..."
    : aiPartnerView === "source"
    ? aiPartnerLastReply ||
      aiPartnerLastTranslatedReply ||
      "Connecte. Maintiens « Maintenir pour parler » pour echanger."
    : aiPartnerLastTranslatedReply ||
      aiPartnerLastReply ||
      "Connecte. Maintiens « Maintenir pour parler » pour echanger.";
  const aiPartnerFeedbackHasTargetVariant =
    aiPartnerFeedbackTranslated.trim().length > 0 &&
    aiPartnerFeedbackTranslated.trim() !== aiPartnerFeedbackSource.trim();
  const aiPartnerFeedbackHasSource = aiPartnerFeedbackSource.trim().length > 0;
  const aiPartnerFeedbackDisplay =
    aiPartnerFeedbackView === "source"
      ? aiPartnerFeedbackSource || aiPartnerFeedbackTranslated
      : aiPartnerFeedbackView === "fr"
      ? aiPartnerFeedbackFrench ||
        (aiPartnerFeedbackFrenchBusy
          ? "Traduction francaise en cours..."
          : aiPartnerFeedbackTranslated || aiPartnerFeedbackSource)
      : aiPartnerFeedbackTranslated || aiPartnerFeedbackSource;
  const aiPartnerDisplayUsesTranslation = aiPartnerOverlayVisible || aiPartnerView !== "source";
  const aiPartnerCoachActionText = aiPartnerDisplayText.trim();
  const aiPartnerCoachActionLanguageCode = aiPartnerDisplayUsesTranslation
    ? localReceptionTarget
    : activeSpeechLanguageCode;
  const aiPartnerCoachActionLanguageName = aiPartnerDisplayUsesTranslation
    ? localReceptionTargetName
    : activeSpeechLanguageName;
  const aiPartnerCoachPlaybackTarget = useMemo<CaptionTarget | undefined>(() => {
    return CAPTION_TARGETS_CONFIG.some(
      (target) => target.code === aiPartnerCoachActionLanguageCode
    )
      ? (aiPartnerCoachActionLanguageCode as CaptionTarget)
      : undefined;
  }, [aiPartnerCoachActionLanguageCode]);
  const showCaptionStack =
    !aiPartnerActive && (Boolean(sourceText) || Boolean(captionText)) && !aiPartnerOverlayVisible;
  const lockControlsToggleInAiMode = aiPartnerActive && !isMobile && !isIPhone;
  useEffect(() => {
    if (!lockControlsToggleInAiMode) return;
    setControlsHidden(false);
  }, [lockControlsToggleInAiMode]);
  useEffect(() => {
    aiPartnerBusyRef.current = aiPartnerBusy;
  }, [aiPartnerBusy]);
  useEffect(() => {
    if (aiPartnerAvailable) return;
    setAiPartnerEnabled(false);
    setAiPartnerBusy(false);
    aiPartnerConversationRef.current = [];
    setAiPartnerLastReply("");
    setAiPartnerLastTranslatedReply("");
    setAiPartnerFeedbackSource("");
    setAiPartnerFeedbackTranslated("");
    setAiPartnerFeedbackFrench("");
    setAiPartnerFeedbackFrenchBusy(false);
    setAiPartnerFeedbackView("target");
    setAiPartnerOverlayText("");
    setAiPartnerView("translation");
    setAiPartnerCoachPhoneticText("");
    setAiPartnerCoachPhoneticBusy(false);
    if (aiPartnerOverlayTimerRef.current) {
      clearTimeout(aiPartnerOverlayTimerRef.current);
      aiPartnerOverlayTimerRef.current = null;
    }
  }, [aiPartnerAvailable, localReceptionTarget]);
  useEffect(() => {
    if (!aiTrainingAutoStart || isChatSession) return;
    if (!aiPartnerAvailable) return;
    setAiPartnerEnabled(true);
  }, [aiPartnerAvailable, aiTrainingAutoStart, isChatSession]);
  useEffect(() => {
    setAiPartnerCoachPhoneticText("");
  }, [aiPartnerCoachActionText, aiPartnerCoachActionLanguageCode, aiPartnerView]);
  useEffect(() => {
    if (!localParticipant) return;
    let cancelled = false;
    const syncCameraForAiPartner = async () => {
      if (roomIsRecovering) return;
      if (aiPartnerActive) {
        if (!isCameraEnabled) return;
        try {
          await localParticipant.setCameraEnabled(false);
          aiPartnerCameraWasAutoDisabledRef.current = true;
        } catch (err) {
          if (cancelled) return;
          setMediaError(
            err instanceof Error
              ? err.message
              : "Impossible de couper la camera en mode Partenaire IA."
          );
        }
        return;
      }
      if (!aiPartnerCameraWasAutoDisabledRef.current) return;
      if (isCameraEnabled) {
        aiPartnerCameraWasAutoDisabledRef.current = false;
        return;
      }
      try {
        await localParticipant.setCameraEnabled(true);
        aiPartnerCameraWasAutoDisabledRef.current = false;
      } catch (err) {
        if (cancelled) return;
        setMediaError(
          err instanceof Error
            ? err.message
            : "Impossible de reactiver la camera apres le mode Partenaire IA."
        );
      }
    };
    void syncCameraForAiPartner();
    return () => {
      cancelled = true;
    };
  }, [aiPartnerActive, isCameraEnabled, localParticipant, roomIsRecovering]);
  const broadcastRoomTranslationAccess = useCallback(async () => {
    if (!isHost || !sendTranslationAccess) return;
    const payload: TranslationAccessPayload = {
      roomId,
      enabled: translationEnabled,
      reason: translationLockMessage || TRANSLATION_UNLOCK_HINT,
      remainingSeconds:
        typeof translationRemainingSeconds === "number" &&
        Number.isFinite(translationRemainingSeconds)
          ? Math.max(0, Math.floor(translationRemainingSeconds))
          : undefined,
      from: localParticipant?.identity || "host",
      updatedAt: Date.now(),
    };
    const encoder = new TextEncoder();
    try {
      await sendTranslationAccess(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic: TRANSLATION_ACCESS_TOPIC,
      });
    } catch {
      // Keep local host state even if data-channel sync fails.
    }
  }, [
    isHost,
    localParticipant?.identity,
    roomId,
    sendTranslationAccess,
    translationEnabled,
    translationLockMessage,
    translationRemainingSeconds,
  ]);
  useEffect(() => {
    if (!isHost) return;
    void broadcastRoomTranslationAccess();
  }, [broadcastRoomTranslationAccess, isHost, remoteParticipants.length]);
  useEffect(() => {
    if (!isHost || !sendTranslationAccess) return;
    const syncTimer = setInterval(() => {
      void broadcastRoomTranslationAccess();
    }, 1500);
    return () => clearInterval(syncTimer);
  }, [broadcastRoomTranslationAccess, isHost, sendTranslationAccess]);
  useEffect(() => {
    if (isHost) return;
    if (!translationAccessIncoming?.payload) return;
    const decoder = new TextDecoder();
    try {
      const raw = decoder.decode(translationAccessIncoming.payload);
      const payload = JSON.parse(raw) as TranslationAccessPayload;
      if (payload.roomId && payload.roomId !== roomId) return;
      setRoomTranslationEnabled(Boolean(payload.enabled));
      const normalizedReason = String(payload.reason || "").trim();
      setRoomTranslationReason(normalizedReason || TRANSLATION_UNLOCK_HINT);
      if (
        typeof payload.remainingSeconds === "number" &&
        Number.isFinite(payload.remainingSeconds)
      ) {
        setRoomTranslationRemainingSeconds(
          Math.max(0, Math.floor(payload.remainingSeconds))
        );
      } else {
        setRoomTranslationRemainingSeconds(null);
      }
    } catch {
      // Ignore malformed payload.
    }
  }, [isHost, roomId, translationAccessIncoming]);
  const clearTalkieLock = useCallback(() => {
    talkieLockHolderRef.current = "";
    talkieLockExpiresAtRef.current = 0;
    setTalkieLockHolderIdentity("");
    setTalkieLockHolderName("");
    if (talkieLockExpiryTimerRef.current) {
      clearTimeout(talkieLockExpiryTimerRef.current);
      talkieLockExpiryTimerRef.current = null;
    }
  }, []);
  const armTalkieLockExpiry = useCallback(
    (expiresAt: number) => {
      if (talkieLockExpiryTimerRef.current) {
        clearTimeout(talkieLockExpiryTimerRef.current);
        talkieLockExpiryTimerRef.current = null;
      }
      const delay = Math.max(0, expiresAt - Date.now());
      talkieLockExpiryTimerRef.current = setTimeout(() => {
        if (talkieLockExpiresAtRef.current > Date.now()) return;
        clearTalkieLock();
      }, delay + 40);
    },
    [clearTalkieLock]
  );
  const applyTalkieLockPayload = useCallback(
    (payload: TalkieLockPayload) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      const nextTimestamp =
        typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
      if (nextTimestamp < talkieLockTimestampRef.current) return;
      talkieLockTimestampRef.current = nextTimestamp;

      const holder = String(payload.holder || "").trim();
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
      setTalkieLockHolderName(String(payload.holderName || "").trim());
      armTalkieLockExpiry(expiresAt);
    },
    [armTalkieLockExpiry, clearTalkieLock, roomId]
  );
  const publishTalkieLock = useCallback(
    async (action: "claim" | "release" | "heartbeat") => {
      if (!localParticipant) return;
      const expiresAt =
        action === "release" ? Date.now() : Date.now() + TALKIE_LOCK_TIMEOUT_MS;
      const payload: TalkieLockPayload = {
        roomId,
        holder: localParticipant.identity,
        holderName: localParticipant.name || localParticipant.identity || "BFZoom",
        action,
        expiresAt,
        timestamp: Date.now(),
      };
      applyTalkieLockPayload(payload);
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      try {
        if (sendTalkieLock) {
          await sendTalkieLock(encoded, {
            reliable: true,
            topic: TALKIE_LOCK_TOPIC,
          });
        } else {
          await localParticipant.publishData(encoded, {
            reliable: true,
            topic: TALKIE_LOCK_TOPIC,
          });
        }
      } catch {
        // Keep local receiver-side suppression even if the data channel is flaky.
      }
    },
    [applyTalkieLockPayload, localParticipant, roomId, sendTalkieLock]
  );
  useEffect(() => {
    if (!talkieLockIncoming?.payload) return;
    const decoder = new TextDecoder();
    try {
      const raw = decoder.decode(talkieLockIncoming.payload);
      const payload = JSON.parse(raw) as TalkieLockPayload;
      applyTalkieLockPayload(payload);
    } catch {
      // Ignore malformed talkie lock payloads.
    }
  }, [applyTalkieLockPayload, talkieLockIncoming]);
  useEffect(() => {
    if (!pushToTalkActive && !pushToTalkBusy) return;
    const heartbeatId = setInterval(() => {
      void publishTalkieLock("heartbeat");
    }, TALKIE_LOCK_HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeatId);
    };
  }, [publishTalkieLock, pushToTalkActive, pushToTalkBusy]);
  useEffect(() => {
    if (!room) return;
    const applyTalkieRemoteAudioSuppression = () => {
      room.remoteParticipants.forEach((participant) => {
        const shouldSuppress =
          Boolean(talkieLockHolderIdentity) &&
          participant.identity === talkieLockHolderIdentity;
        participant.setVolume(
          shouldSuppress ? TALKIE_REMOTE_AUDIO_MUTED_VOLUME : TALKIE_REMOTE_AUDIO_VOLUME_NORMAL,
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
        participant.setVolume(TALKIE_REMOTE_AUDIO_VOLUME_NORMAL, Track.Source.Microphone);
      });
    };
  }, [room, talkieLockHolderIdentity]);
  useEffect(() => {
    return () => {
      void publishTalkieLock("release");
    };
  }, [publishTalkieLock]);
  const isTalkieLockedByOther = useMemo(() => {
    if (!talkieLockHolderIdentity) return false;
    return talkieLockHolderIdentity !== (localParticipant?.identity || "");
  }, [localParticipant?.identity, talkieLockHolderIdentity]);
  const talkieLockedMessage = isTalkieLockedByOther
    ? ui.talkieBusyBy(talkieLockHolderName || talkieLockHolderIdentity)
    : "";
  const handleLocalReceptionTargetChange = useCallback(
    (target: CaptionTarget) => {
      onChangeGuestCaptionTarget(target);
      if (isHost) onChangeCaptionTarget(target);
    },
    [isHost, onChangeCaptionTarget, onChangeGuestCaptionTarget]
  );
  const speechRecognitionSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const maybeWindow = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    return Boolean(maybeWindow.SpeechRecognition || maybeWindow.webkitSpeechRecognition);
  }, []);
  const preferRecorderPushToTalk = useMemo(() => {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isMacDesktop = /Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
    return (
      isMacDesktop &&
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);
  const pushToTalkSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    if (speechRecognitionSupported) return true;
    return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  }, [speechRecognitionSupported]);
  const schedulePushToTalkWarmStreamRelease = useCallback(() => {
    if (pushToTalkWarmStreamTimerRef.current) {
      clearTimeout(pushToTalkWarmStreamTimerRef.current);
    }
    pushToTalkWarmStreamTimerRef.current = setTimeout(() => {
      const recorder = pushToTalkRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        schedulePushToTalkWarmStreamRelease();
        return;
      }
      pushToTalkWarmStreamTimerRef.current = null;
      const stream = pushToTalkStreamRef.current;
      pushToTalkStreamRef.current = null;
      if (!stream) return;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }, 12000);
  }, []);
  const warmupPushToTalkMicrophone = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    const existingStream = pushToTalkStreamRef.current;
    if (existingStream && existingStream.active) {
      pushToTalkWarmupDoneRef.current = true;
      schedulePushToTalkWarmStreamRelease();
      return;
    }
    if (pushToTalkWarmupInFlightRef.current) {
      await pushToTalkWarmupInFlightRef.current;
      return;
    }
    const warmupTask = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        pushToTalkStreamRef.current = stream;
        pushToTalkWarmupDoneRef.current = true;
        schedulePushToTalkWarmStreamRelease();
      } catch {
        // Keep normal first push-to-talk behavior if warmup fails.
      } finally {
        pushToTalkWarmupInFlightRef.current = null;
      }
    })();
    pushToTalkWarmupInFlightRef.current = warmupTask;
    await warmupTask;
  }, [schedulePushToTalkWarmStreamRelease]);
  useEffect(() => {
    if (!pushToTalkSupported) return;
    if (!(isMobile || isIPhone)) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    const prime = () => {
      if (cancelled) return;
      void activateRoomAudio();
      if (!pushToTalkWarmupDoneRef.current) {
        void warmupPushToTalkMicrophone();
      }
    };
    const delayedPrime = window.setTimeout(prime, 200);
    const onFirstInteraction = () => {
      prime();
    };
    window.addEventListener("pointerdown", onFirstInteraction, { passive: true, once: true });
    window.addEventListener("touchstart", onFirstInteraction, { passive: true, once: true });
    return () => {
      cancelled = true;
      window.clearTimeout(delayedPrime);
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("touchstart", onFirstInteraction);
    };
  }, [activateRoomAudio, isIPhone, isMobile, pushToTalkSupported, warmupPushToTalkMicrophone]);
  const scheduleCaptionClear = useCallback(() => {
    if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
    if (aiPartnerActive) {
      return;
    }
    captionTimerRef.current = setTimeout(() => {
      setCaptionText("");
      setCaptionPhoneticText("");
      setSourceText("");
    }, 15000);
  }, [aiPartnerActive]);

  useEffect(() => {
    const trimmedCaption = captionText.trim();
    if (!trimmedCaption || !exercisePhoneticEnabled || !guestTtsEnabled || !captionsEnabled) {
      setCaptionPhoneticText("");
      return;
    }
    const targetCode = captionPhoneticTarget || localReceptionTarget;
    const cacheKey = `${targetCode}:${trimmedCaption}`;
    const cached = phoneticCacheRef.current.get(cacheKey);
    if (typeof cached === "string") {
      setCaptionPhoneticText(cached);
      return;
    }
    let cancelled = false;
    const requestId = ++phoneticRequestRef.current;
    const targetName =
      CAPTION_TARGETS_CONFIG.find((item) => item.code === targetCode)?.name ||
      resolveLanguageNameFromCode(targetCode) ||
      "Target";
    void (async () => {
      try {
        const phonetic = await phoneticWithOpenAi(trimmedCaption, targetName, {
          targetCode,
          guestToken: guestTtsToken,
        });
        if (cancelled || requestId !== phoneticRequestRef.current) return;
        const cleaned = phonetic.trim();
        const sourceNormalized = trimmedCaption.replace(/\s+/g, " ").trim().toLowerCase();
        const phoneticNormalized = cleaned.replace(/\s+/g, " ").trim().toLowerCase();
        const finalPhonetic =
          cleaned && phoneticNormalized !== sourceNormalized ? cleaned : "";
        phoneticCacheRef.current.set(cacheKey, finalPhonetic);
        setCaptionPhoneticText(finalPhonetic);
      } catch {
        if (cancelled || requestId !== phoneticRequestRef.current) return;
        setCaptionPhoneticText("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    captionPhoneticTarget,
    captionText,
    captionsEnabled,
    exercisePhoneticEnabled,
    guestTtsEnabled,
    guestTtsToken,
    localReceptionTarget,
  ]);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  const [iphoneFocus, setIphoneFocus] = useState<TrackReferenceOrPlaceholder | null>(null);
  const iphoneCameraTracks = tracks.filter(
    (track) => track.source === Track.Source.Camera || track.publication?.source === Track.Source.Camera
  );

  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);

  useEffect(() => {
    if (!room) return;
    const update = () => {
      const pub = localParticipant?.getTrackPublication(Track.Source.ScreenShare);
      setIsScreenSharing(Boolean(pub?.track));
    };
    update();
    room.on(RoomEvent.LocalTrackPublished, update);
    room.on(RoomEvent.LocalTrackUnpublished, update);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, update);
      room.off(RoomEvent.LocalTrackUnpublished, update);
    };
  }, [localParticipant, room]);

  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !isEqualTrackRef(track, focusTrack));
  const [galleryVisible, setGalleryVisible] = useState(true);
  useEffect(() => {
    if (screenShareTracks.length > 0) {
      setGalleryVisible(false);
      return;
    }
    setGalleryVisible(true);
  }, [screenShareTracks.length]);
  const focusLayoutClass = screenShareTracks.length > 0 ? "screen-share-active" : undefined;

  const lastAutoFocusedScreenShareTrack = useRef<TrackReferenceOrPlaceholder | null>(null);
  const handleToggleScreenShare = useCallback(async () => {
    if (!localParticipant) return;
    if (isIPhone) {
      setScreenShareError("Partage d'écran indisponible sur iPhone.");
      return;
    }
    try {
      setScreenShareError("");
      await localParticipant.setScreenShareEnabled(!isScreenSharing);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de partager l'écran.";
      setScreenShareError(message);
    }
  }, [isIPhone, isScreenSharing, localParticipant]);

  const widgetDispatchRef = useRef<typeof layoutContext.widget.dispatch | null>(
    layoutContext.widget.dispatch ?? null
  );

  useEffect(() => {
    widgetDispatchRef.current = layoutContext.widget.dispatch ?? null;
  }, [layoutContext.widget]);

  useEffect(() => {
    widgetDispatchRef.current?.({ msg: "unread_msg", count: roomChat.unreadCount });
  }, [roomChat.unreadCount]);

  const getRecorderMimeType = useCallback(() => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }, []);

  const releasePushToTalkStream = useCallback(() => {
    if (pushToTalkWarmStreamTimerRef.current) {
      clearTimeout(pushToTalkWarmStreamTimerRef.current);
      pushToTalkWarmStreamTimerRef.current = null;
    }
    const stream = pushToTalkStreamRef.current;
    pushToTalkStreamRef.current = null;
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });
  }, []);

  const transcribePushToTalkBlob = useCallback(async (blob: Blob, mimeType: string) => {
    const fileExt = mimeType.includes("mp4") ? "m4a" : mimeType.includes("mpeg") ? "mp3" : "webm";
    const formData = new FormData();
    formData.append("file", blob, `push-to-talk.${fileExt}`);
    formData.append("roomId", roomId);
    formData.append("language", activeSpeechLanguageCode);
    const authHeader = await getAuthHeader({ forceRefresh: true });
    const headers: Record<string, string> = { ...authHeader };
    const guestToken = guestTtsToken.trim();
    if (!authHeader.Authorization && guestToken) {
      headers["x-bfzoom-guest-tts-token"] = guestToken;
    }
    const transcriptResponse = await fetch("/api/transcribe", {
      method: "POST",
      headers,
      body: formData,
    });
    const transcriptPayload = await transcriptResponse.json().catch(() => ({}));
    if (!transcriptResponse.ok) {
      throw new Error(
        (transcriptPayload as { error?: string })?.error || "Transcription impossible."
      );
    }
    return String((transcriptPayload as { text?: string })?.text || "").trim();
  }, [activeSpeechLanguageCode, guestTtsToken, roomId]);

  const stopTts = useCallback(async () => {
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    onTtsError("");
    const publishedTtsTrack = ttsTrackRef.current;
    if (publishedTtsTrack && localParticipant) {
      const hasPublication = localParticipant
        .getTrackPublications()
        .some((pub) => pub.track === publishedTtsTrack);
      if (hasPublication) {
        try {
          await localParticipant.unpublishTrack(publishedTtsTrack);
        } catch {}
      }
      publishedTtsTrack.stop();
      if (ttsTrackRef.current === publishedTtsTrack) {
        ttsTrackRef.current = null;
      }
    }
    if (ttsDestinationRef.current) {
      ttsDestinationRef.current.disconnect();
      ttsDestinationRef.current = null;
    }
    if (ttsContextRef.current) {
      try {
        await ttsContextRef.current.close();
      } catch {}
      ttsContextRef.current = null;
    }
  }, [localParticipant, onTtsError]);

  useEffect(() => {
    if (!realtimeEnabled) return;
    void stopTts();
  }, [realtimeEnabled, stopTts]);

  const ensureTtsTrack = useCallback(async () => {
    const context = ttsContextRef.current ?? new AudioContext();
    ttsContextRef.current = context;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {}
    }
    ttsDestinationRef.current =
      ttsDestinationRef.current ?? context.createMediaStreamDestination();
    return true;
  }, []);

  const playNextTts = useCallback(async () => {
    if (ttsPlayingRef.current) return;
    const nextText = ttsQueueRef.current.shift();
    if (!nextText) return;
    if (!ttsEnabled) return;
    if (hostLocalTtsEnabled) {
      void speakGuestCaption(nextText, localReceptionTarget);
    }
    ttsPlayingRef.current = true;
    const ready = await ensureTtsTrack();
    if (!ready) {
      ttsPlayingRef.current = false;
      return;
    }
    const context = ttsContextRef.current;
    const destination = ttsDestinationRef.current;
    if (!context || !destination) {
      ttsPlayingRef.current = false;
      return;
    }
    try {
      if (context.state === "suspended") {
        try {
          await context.resume();
        } catch {}
      }
      const authHeader = await getAuthHeader();
      const guestToken = guestTtsToken.trim();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authHeader,
      };
      if (guestToken) {
        headers["x-bfzoom-guest-tts-token"] = guestToken;
      }
      const res = await fetch("/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: nextText, voice: realtimeVoice, roomId, format: "mp3" }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data?.error || "Erreur TTS");
      }
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(destination);
      // In exercise mode (or when host is alone), monitor translated voice locally.
      if (!hostLocalTtsEnabled && (guestTtsEnabled || remoteParticipants.length === 0)) {
        source.connect(context.destination);
      }
      source.onended = () => {
        ttsPlayingRef.current = false;
        void playNextTts();
      };
      source.start(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur synthese vocale.";
      onTtsError(`Synthese vocale: ${message}`);
      ttsPlayingRef.current = false;
      void playNextTts();
    }
  }, [
    ensureTtsTrack,
    hostLocalTtsEnabled,
    localReceptionTarget,
    onTtsError,
    realtimeVoice,
    roomId,
    guestTtsEnabled,
    guestTtsToken,
    remoteParticipants.length,
    speakGuestCaption,
    ttsEnabled,
  ]);

  const enqueueTts = useCallback(
    (text: string) => {
      if (!ttsEnabled || !text.trim()) return;
      ttsQueueRef.current.push(text.trim());
      void playNextTts();
    },
    [ttsEnabled, playNextTts]
  );

  useEffect(() => {
    if (!ttsEnabled || !captionsEnabled) {
      void stopTts();
    }
  }, [ttsEnabled, captionsEnabled, stopTts]);

  useEffect(() => {
    if (!ttsEnabled) return;
    void ensureTtsTrack();
  }, [ttsEnabled, ensureTtsTrack]);

  useEffect(() => {
    const nextError =
      lastMicrophoneError?.message || lastCameraError?.message || "";
    setMediaError(nextError);
  }, [lastCameraError?.message, lastMicrophoneError?.message]);

  useEffect(() => {
    if (!captionIncoming?.payload) return;
    let cancelled = false;
    const decoder = new TextDecoder();
    const processPayload = async () => {
      try {
        const text = decoder.decode(captionIncoming.payload);
        const payload = JSON.parse(text) as CaptionPayload;
        if (!payload.text) return;
        if (payload.roomId && payload.roomId !== roomId) return;
        if (payload.from && payload.from === localParticipant?.identity) return;
        if (isHost && payload.from === "host") return;
        const payloadId =
          typeof payload.id === "string" ? payload.id.trim() : "";
        if (isHost && payload.from && payload.from !== localParticipant?.identity) {
          const alreadyConsumed =
            payloadId && consumedIncomingCaptionIdsRef.current.has(payloadId);
          if (!alreadyConsumed) {
            if (payloadId) {
              consumedIncomingCaptionIdsRef.current.add(payloadId);
              if (consumedIncomingCaptionIdsRef.current.size > 300) {
                const first = consumedIncomingCaptionIdsRef.current.values().next().value;
                if (first) consumedIncomingCaptionIdsRef.current.delete(first);
              }
            }
            const remoteSeconds =
              typeof payload.durationSeconds === "number" &&
              Number.isFinite(payload.durationSeconds)
                ? Math.max(1, Math.min(300, Math.floor(payload.durationSeconds)))
                : 1;
            const consumed = await onConsumeTranslationSeconds(
              remoteSeconds,
              "remote"
            );
            if (!consumed) {
              setCaptionError(translationUnavailableMessage);
              return;
            }
          }
        }
        const incomingSourceText = (payload.sourceText || payload.text || "").trim();
        setSourceText(incomingSourceText);
        setSourceFromLocal(false);
        const effectivePayloadTarget: CaptionTargetCode | undefined =
          payload.target ?? (normalizeCaptionTargetCode(payload.targetLang) ?? undefined);
        let localText = payload.text;
        let localTarget = normalizeCaptionTargetCode(effectivePayloadTarget);
        let fallbackMessage = "";
        if (
          localReceptionTarget &&
          localReceptionTargetName &&
          (payload.sourceText || payload.text) &&
          effectivePayloadTarget !== localReceptionTarget
        ) {
          const sourceText = (payload.sourceText || "").trim();
          const translationInput = (sourceText || payload.text || "").trim();
          const translationFromCode =
            sourceText.length > 0 ? payload.sourceLang : effectivePayloadTarget || payload.sourceLang;
          const translationFromName =
            sourceText.length > 0
              ? payload.sourceLangName || resolveLanguageNameFromCode(payload.sourceLang) || "Source"
              : resolveLanguageNameFromCode(effectivePayloadTarget) ||
                payload.sourceLangName ||
                resolveLanguageNameFromCode(payload.sourceLang) ||
                "Source";
          if (translationInput) {
            try {
              const guestTranslation = await resolveGuestTranslationForTarget(
                translationInput,
                translationFromCode,
                translationFromName,
                localReceptionTarget,
                localReceptionTargetName
              );
              if (guestTranslation.trim()) {
                localText = guestTranslation.trim();
                localTarget = localReceptionTarget;
              } else {
                fallbackMessage = buildCaptionFallbackMessage(
                  localReceptionTargetName,
                  localTarget ?? effectivePayloadTarget
                );
              }
            } catch (err) {
              console.warn("Guest translation failed", err);
              fallbackMessage = buildCaptionFallbackMessage(
                localReceptionTargetName,
                localTarget ?? effectivePayloadTarget
              );
            }
          }
        }
        const resolvedCaptionTarget = resolveCaptionDisplayTarget(
          localTarget ?? effectivePayloadTarget,
          localReceptionTarget
        );
        const captionMatchesReception =
          !localReceptionTarget || resolvedCaptionTarget === localReceptionTarget;
        const captionErrorMessage = captionMatchesReception
          ? ""
          : fallbackMessage ||
            buildCaptionFallbackMessage(localReceptionTargetName, resolvedCaptionTarget);
        if (cancelled) return;
        setCaptionText(localText);
        setCaptionPhoneticTarget(resolvedCaptionTarget);
        setCaptionError(captionErrorMessage);
        scheduleCaptionClear();
        const remotePublishedAudioHandlesPlayback = Boolean(
          payload.audioTrackPublished &&
            hasRemotePublishedTranslationAudioTrack &&
            captionMatchesReception
        );
        if (guestTtsEnabled && !remotePublishedAudioHandlesPlayback && captionMatchesReception) {
          void speakGuestCaption(localText ?? payload.text, resolvedCaptionTarget);
        }
      } catch (err) {
        console.warn("Caption payload invalide", err);
      }
    };
    void processPayload();
    return () => {
      cancelled = true;
    };
  }, [
    captionIncoming,
    guestTtsToken,
    guestTtsEnabled,
    hasRemotePublishedTranslationAudioTrack,
    isHost,
    localParticipant?.identity,
    localReceptionTarget,
    localReceptionTargetName,
    onConsumeTranslationSeconds,
    resolveGuestTranslationForTarget,
    roomId,
    scheduleCaptionClear,
    speakGuestCaption,
    translationUnavailableMessage,
  ]);
  useEffect(() => {
    return () => {
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      if (pushToTalkInterruptTimerRef.current) {
        clearTimeout(pushToTalkInterruptTimerRef.current);
        pushToTalkInterruptTimerRef.current = null;
      }
      if (pushToTalkDraftTimerRef.current) {
        clearTimeout(pushToTalkDraftTimerRef.current);
        pushToTalkDraftTimerRef.current = null;
      }
      if (aiPartnerOverlayTimerRef.current) clearTimeout(aiPartnerOverlayTimerRef.current);
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      recognitionRef.current = null;
      const recorder = pushToTalkRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
      pushToTalkRecorderRef.current = null;
      pushToTalkChunksRef.current = [];
      releasePushToTalkStream();
      activeTranslationAbortRef.current?.abort();
      activeTranslationAbortRef.current = null;
      activeAiPartnerAbortRef.current?.abort();
      activeAiPartnerAbortRef.current = null;
      pushToTalkDraftReviewRequestRef.current += 1;
      pushToTalkDraftReviewAbortRef.current?.abort();
      pushToTalkDraftReviewAbortRef.current = null;
      stopGuestCaptionPlayback();
    };
  }, [releasePushToTalkStream, stopGuestCaptionPlayback]);

  const stopPushToTalkRecognition = useCallback(() => {
    pushToTalkPressedRef.current = false;
    pushToTalkPointerIdRef.current = null;
    pushToTalkPointerStartRef.current = null;
    pushToTalkCancelArmedRef.current = false;
    setPushToTalkGestureHint("");
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
      recognitionRef.current = null;
    }
    const recorder = pushToTalkRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
    setPushToTalkActive(false);
  }, []);
  const showPushToTalkInterruptHint = useCallback(() => {
    setPushToTalkInterruptHint("Interrompu: nouvelle capture en cours.");
    if (pushToTalkInterruptTimerRef.current) {
      clearTimeout(pushToTalkInterruptTimerRef.current);
    }
    pushToTalkInterruptTimerRef.current = setTimeout(() => {
      setPushToTalkInterruptHint("");
      pushToTalkInterruptTimerRef.current = null;
    }, 1800);
  }, []);
  const resetPushToTalkDraftReview = useCallback(() => {
    pushToTalkDraftReviewRequestRef.current += 1;
    pushToTalkDraftReviewAbortRef.current?.abort();
    pushToTalkDraftReviewAbortRef.current = null;
    setPushToTalkDraftReview(null);
    setPushToTalkDraftReviewBusy(false);
  }, []);
  const interruptCurrentTurn = useCallback(() => {
    pushToTalkSessionRef.current += 1;
    pushToTalkDraftIdRef.current += 1;
    if (pushToTalkDraftTimerRef.current) {
      clearTimeout(pushToTalkDraftTimerRef.current);
      pushToTalkDraftTimerRef.current = null;
    }
    activeTranslationRequestRef.current += 1;
    activeTranslationAbortRef.current?.abort();
    activeTranslationAbortRef.current = null;
    activeAiPartnerRequestRef.current += 1;
    activeAiPartnerAbortRef.current?.abort();
    activeAiPartnerAbortRef.current = null;
    aiPartnerBusyRef.current = false;
    setPushToTalkBusy(false);
    setPushToTalkDraft(null);
    setPushToTalkDraftText("");
    setPushToTalkDraftEditing(false);
    resetPushToTalkDraftReview();
    setAiPartnerBusy(false);
    setAiPartnerOverlayText("");
    stopPushToTalkRecognition();
    void publishTalkieLock("release");
    void stopTts();
    stopGuestCaptionPlayback();
  }, [
    publishTalkieLock,
    resetPushToTalkDraftReview,
    stopPushToTalkRecognition,
    stopGuestCaptionPlayback,
    stopTts,
  ]);
  const resetAiPartnerConversationState = useCallback(() => {
    interruptCurrentTurn();
    aiPartnerConversationRef.current = [];
    if (captionTimerRef.current) {
      clearTimeout(captionTimerRef.current);
      captionTimerRef.current = null;
    }
    if (aiPartnerOverlayTimerRef.current) {
      clearTimeout(aiPartnerOverlayTimerRef.current);
      aiPartnerOverlayTimerRef.current = null;
    }
    setCaptionError("");
    setSourceText("");
    setCaptionText("");
    setCaptionPhoneticText("");
    setAiPartnerBusy(false);
    setAiPartnerLastReply("");
    setAiPartnerLastTranslatedReply("");
    setAiPartnerFeedbackSource("");
    setAiPartnerFeedbackTranslated("");
    setAiPartnerFeedbackFrench("");
    setAiPartnerFeedbackFrenchBusy(false);
    setAiPartnerFeedbackView("target");
    setAiPartnerOverlayText("");
    setAiPartnerView("translation");
    setAiPartnerCoachPhoneticText("");
    setAiPartnerCoachPhoneticBusy(false);
  }, [interruptCurrentTurn]);
  useEffect(() => {
    const nextConfig = {
      sourceLanguage,
      trainingTarget: localReceptionTarget,
      respondInTrainingLanguage,
    };
    const previousConfig = aiPracticeLanguageConfigRef.current;
    aiPracticeLanguageConfigRef.current = nextConfig;
    if (!aiTrainingAutoStart || isChatSession) return;
    const changed =
      previousConfig.sourceLanguage !== nextConfig.sourceLanguage ||
      previousConfig.trainingTarget !== nextConfig.trainingTarget ||
      previousConfig.respondInTrainingLanguage !== nextConfig.respondInTrainingLanguage;
    if (!changed) return;
    resetAiPartnerConversationState();
  }, [
    aiTrainingAutoStart,
    isChatSession,
    localReceptionTarget,
    resetAiPartnerConversationState,
    respondInTrainingLanguage,
    sourceLanguage,
  ]);
  const requestAiPartnerReply = useCallback(
    async (userInput: string) => {
      if (!aiPartnerActive || aiPartnerBusyRef.current) return;
      const prompt = userInput.trim();
      if (!prompt) return;
      const requestId = ++activeAiPartnerRequestRef.current;
      activeAiPartnerAbortRef.current?.abort();
      const requestController = new AbortController();
      activeAiPartnerAbortRef.current = requestController;

      aiPartnerBusyRef.current = true;
      setAiPartnerBusy(true);
      setAiPartnerFeedbackView("target");
      setAiPartnerFeedbackFrench("");
      setAiPartnerFeedbackFrenchBusy(false);
      setAiPartnerFeedbackSource("");
      setAiPartnerFeedbackTranslated("");
      try {
        const authHeader = await getAuthHeader({ forceRefresh: true });
        if (!authHeader.Authorization) {
          setCaptionError("Partenaire IA: connecte-toi pour activer l'entrainement.");
          return;
        }

        const response = await fetch("/api/openai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            intent: "coach_ai",
            coachMode: "partner",
            coachScenario: aiPartnerScenario,
            coachTone: aiPartnerTone,
            coachLanguage: activeSpeechLanguageName,
            roomId,
            timeoutMs: 18_000,
            maxTokens: 300,
            temperature: 0.4,
            messages: [
              {
                role: "system",
                content: buildAiPartnerSystemPrompt(
                  activeSpeechLanguageName,
                  aiPartnerScenario,
                  aiPartnerTone
                ),
              },
              ...aiPartnerConversationRef.current,
              { role: "user", content: prompt },
            ],
          }),
          signal: requestController.signal,
        });
        if (!response.ok) {
          const reason = await readApiErrorMessage(response);
          throw new Error(reason);
        }
        if (requestId !== activeAiPartnerRequestRef.current) return;

        const payload = (await response.json().catch(() => ({}))) as {
          choices?: { message?: { content?: string } }[];
        };
        const rawReply = String(payload?.choices?.[0]?.message?.content || "").trim();
        if (!rawReply) return;
        const parsedCoachPayload = parseAiPartnerCoachPayload(rawReply);
        const aiReplySource = parsedCoachPayload.reply.replace(/\s+/g, " ").trim();
        if (!aiReplySource) return;
        if (requestId !== activeAiPartnerRequestRef.current) return;
        const nextConversation: AiPartnerConversationMessage[] = [
          ...aiPartnerConversationRef.current,
          { role: "user", content: prompt },
          { role: "assistant", content: aiReplySource },
        ];
        aiPartnerConversationRef.current = nextConversation.slice(-AI_PARTNER_HISTORY_LIMIT);
        setAiPartnerLastReply(aiReplySource);
        let feedbackSource = parsedCoachPayload.feedback.trim();
        const previousFeedbackSnapshot = aiPartnerFeedbackSource.trim();
        if (
          !feedbackSource ||
          (previousFeedbackSnapshot.length > 0 && feedbackSource === previousFeedbackSnapshot)
        ) {
          try {
            const recoveryResponse = await fetch("/api/openai", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify({
                intent: "coach_ai",
                coachMode: "partner_feedback",
                coachLanguage: activeSpeechLanguageName,
                roomId,
                timeoutMs: 12_000,
                maxTokens: 220,
                temperature: 0.2,
                messages: [
                  {
                    role: "system",
                    content: buildAiPartnerFeedbackRecoveryPrompt(activeSpeechLanguageName),
                  },
                  {
                    role: "user",
                    content: [
                      `Learner sentence: ${prompt}`,
                      `Coach reply: ${aiReplySource}`,
                      `Previous feedback: ${
                        previousFeedbackSnapshot || "(none)"
                      }`,
                    ].join("\n"),
                  },
                ],
              }),
              signal: requestController.signal,
            });
            if (recoveryResponse.ok) {
              const recoveryPayload = (await recoveryResponse.json().catch(() => ({}))) as {
                choices?: { message?: { content?: string } }[];
              };
              const recoveryRaw = String(
                recoveryPayload?.choices?.[0]?.message?.content || ""
              ).trim();
              if (recoveryRaw) {
                const recovered = parseAiPartnerCoachPayload(recoveryRaw).feedback.trim();
                if (recovered) {
                  feedbackSource = recovered;
                }
              }
            }
          } catch {
            // Keep previous parsed feedback (possibly empty) if recovery fails.
          }
        }
        if (requestId !== activeAiPartnerRequestRef.current) return;

        let aiReplyForUser = aiReplySource;
        let feedbackForUser = feedbackSource;
        if (activeSpeechLanguageCode !== localReceptionTarget) {
          try {
            const translated = await translateWithOpenAi(
              aiReplySource,
              activeSpeechLanguageName,
              localReceptionTargetName,
              {
                fromCode: activeSpeechLanguageCode,
                toCode: localReceptionTarget,
                guestToken: guestTtsToken,
                intent: "translation",
                signal: requestController.signal,
              }
            );
            if (translated.trim()) {
              aiReplyForUser = translated.trim();
            }
          } catch {
            // Keep source reply if translation fallback fails.
          }
          if (feedbackSource) {
            try {
              const translatedFeedback = await translateWithOpenAi(
                feedbackSource,
                activeSpeechLanguageName,
                localReceptionTargetName,
                {
                  fromCode: activeSpeechLanguageCode,
                  toCode: localReceptionTarget,
                  guestToken: guestTtsToken,
                  intent: "translation",
                  signal: requestController.signal,
                }
              );
              if (translatedFeedback.trim()) {
                feedbackForUser = translatedFeedback.trim();
              }
            } catch {
              // Keep source coaching help if translation fallback fails.
            }
          }
        }
        if (requestId !== activeAiPartnerRequestRef.current) return;

        setAiPartnerFeedbackSource(feedbackSource);
        setAiPartnerFeedbackTranslated(feedbackForUser);
        setAiPartnerFeedbackFrench("");
        setAiPartnerFeedbackFrenchBusy(false);
        setAiPartnerFeedbackView("target");
        setAiPartnerLastTranslatedReply(aiReplyForUser);
        setAiPartnerView("translation");
        setAiPartnerOverlayText(aiReplyForUser);
        if (aiPartnerOverlayTimerRef.current) clearTimeout(aiPartnerOverlayTimerRef.current);
        aiPartnerOverlayTimerRef.current = setTimeout(() => {
          setAiPartnerOverlayText("");
        }, 15000);
        if (guestTtsEnabled) {
          void speakGuestCaption(aiReplyForUser, localReceptionTarget);
        }
        void roomChat.sendMessage(aiReplyForUser, { fromName: AI_PARTNER_NAME });
      } catch (err) {
        if (
          requestController.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : "Reponse IA indisponible.";
        setCaptionError(`Partenaire IA: ${toFriendlyAiError(message)}`);
      } finally {
        if (activeAiPartnerAbortRef.current === requestController) {
          activeAiPartnerAbortRef.current = null;
        }
        if (requestId === activeAiPartnerRequestRef.current) {
          aiPartnerBusyRef.current = false;
          setAiPartnerBusy(false);
        }
      }
    },
    [
      activeAiPartnerAbortRef,
      activeAiPartnerRequestRef,
      aiPartnerActive,
      aiPartnerConversationRef,
      aiPartnerFeedbackSource,
      guestTtsEnabled,
      guestTtsToken,
      aiPartnerScenario,
      aiPartnerTone,
      activeSpeechLanguageCode,
      activeSpeechLanguageName,
      localReceptionTarget,
      localReceptionTargetName,
      roomChat,
      roomId,
      speakGuestCaption,
    ]
  );
  const replayAiPartnerCoach = useCallback((textOverride?: string, targetOverride?: CaptionTarget) => {
    const text = (textOverride ?? aiPartnerCoachActionText).trim();
    if (!text) return;
    void speakGuestCaption(text, targetOverride || aiPartnerCoachPlaybackTarget);
  }, [aiPartnerCoachActionText, aiPartnerCoachPlaybackTarget, speakGuestCaption]);
  const replayAiPartnerUserTranslation = useCallback((overrideText?: string, overrideTarget?: CaptionTarget) => {
    const text = (overrideText ?? captionText).trim();
    if (!text) return;
    void speakGuestCaption(text, overrideTarget || localReceptionTarget);
  }, [captionText, localReceptionTarget, speakGuestCaption]);
  const ensureAiPartnerFeedbackFrench = useCallback(async () => {
    const feedbackTarget = aiPartnerFeedbackTranslated.trim();
    const feedbackSource = aiPartnerFeedbackSource.trim();
    const baseText = (feedbackTarget || feedbackSource).trim();
    if (!baseText) return;
    setAiPartnerFeedbackView("fr");
    if (aiPartnerFeedbackFrench.trim()) return;
    if (aiPartnerFeedbackFrenchBusy) return;

    const fromCode = feedbackTarget ? localReceptionTarget : activeSpeechLanguageCode;
    const fromName = feedbackTarget ? localReceptionTargetName : activeSpeechLanguageName;
    if (fromCode === "fr") {
      setAiPartnerFeedbackFrench(baseText);
      return;
    }

    setAiPartnerFeedbackFrenchBusy(true);
    try {
      const translated = await translateWithOpenAi(baseText, fromName, "Francais", {
        fromCode,
        toCode: "fr",
        guestToken: guestTtsToken,
        intent: "translation",
      });
      const resolved = translated.trim() || baseText;
      setAiPartnerFeedbackFrench(resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Traduction francaise indisponible.";
      setCaptionError(`Aide Coach IA: ${toFriendlyAiError(message)}`);
      setAiPartnerFeedbackFrench(baseText);
    } finally {
      setAiPartnerFeedbackFrenchBusy(false);
    }
  }, [
    aiPartnerFeedbackFrench,
    aiPartnerFeedbackFrenchBusy,
    aiPartnerFeedbackSource,
    aiPartnerFeedbackTranslated,
    guestTtsToken,
    activeSpeechLanguageCode,
    activeSpeechLanguageName,
    localReceptionTarget,
    localReceptionTargetName,
  ]);
  const requestAiPartnerCoachPhonetic = useCallback(async () => {
    const text = aiPartnerCoachActionText.trim();
    if (!text) return;
    const targetCode = aiPartnerCoachActionLanguageCode;
    const cacheKey = `${targetCode}:${text}`;
    const cached = aiPartnerCoachPhoneticCacheRef.current.get(cacheKey);
    if (typeof cached === "string") {
      setAiPartnerCoachPhoneticText(cached);
      return;
    }
    setAiPartnerCoachPhoneticBusy(true);
    const requestId = ++aiPartnerCoachPhoneticRequestRef.current;
    try {
      const phonetic = await phoneticWithOpenAi(text, aiPartnerCoachActionLanguageName, {
        targetCode,
        guestToken: guestTtsToken,
      });
      if (requestId !== aiPartnerCoachPhoneticRequestRef.current) return;
      const cleaned = phonetic.trim();
      const sourceNormalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      const phoneticNormalized = cleaned.replace(/\s+/g, " ").trim().toLowerCase();
      const finalPhonetic =
        cleaned && phoneticNormalized !== sourceNormalized ? cleaned : "";
      aiPartnerCoachPhoneticCacheRef.current.set(cacheKey, finalPhonetic);
      setAiPartnerCoachPhoneticText(finalPhonetic);
    } catch (err) {
      if (requestId !== aiPartnerCoachPhoneticRequestRef.current) return;
      const message = err instanceof Error ? err.message : "Phonetique indisponible.";
      setCaptionError(`Phonetique: ${toFriendlyAiError(message)}`);
      setAiPartnerCoachPhoneticText("");
    } finally {
      if (requestId === aiPartnerCoachPhoneticRequestRef.current) {
        setAiPartnerCoachPhoneticBusy(false);
      }
    }
  }, [
    aiPartnerCoachActionLanguageCode,
    aiPartnerCoachActionLanguageName,
    aiPartnerCoachActionText,
    guestTtsToken,
  ]);
  useEffect(() => {
    if (!aiPartnerActive) return;
    if (!aiPartnerCoachActionText.trim()) return;
    void requestAiPartnerCoachPhonetic();
  }, [
    aiPartnerActive,
    aiPartnerCoachActionText,
    aiPartnerCoachActionLanguageCode,
    aiPartnerView,
    requestAiPartnerCoachPhonetic,
  ]);
  const translateAndBroadcast = useCallback(
    async (
      input: string,
      durationSeconds = 1,
      deliveryGate?: Promise<boolean>
    ) => {
      if (!effectiveTranslationEnabled) {
        setCaptionError(translationUnavailableMessage);
        return;
      }
      const trimmed = input.trim();
      if (!trimmed) return;
      const outgoingTarget = localReceptionTarget;
      const outgoingTargetName = localReceptionTargetName;
      const now = Date.now();
      const throttleMs = getCaptionThrottleMs(trimmed);
      if (now - lastCaptionSentAtRef.current < throttleMs) return;
      lastCaptionSentAtRef.current = now;
      const requestId = ++activeTranslationRequestRef.current;
      activeTranslationAbortRef.current?.abort();
      const requestController = new AbortController();
      activeTranslationAbortRef.current = requestController;
      setPushToTalkBusy(true);
      setCaptionError("");
      setSourceText(trimmed);
      setSourceFromLocal(true);
      try {
        if (aiTrainingAutoStart) {
          const deliveryAllowed = await (deliveryGate ?? Promise.resolve(true)).catch(
            () => false
          );
          if (requestId !== activeTranslationRequestRef.current) return;
          if (!deliveryAllowed) {
            setCaptionError(translationUnavailableMessage);
            return;
          }
        }
        const sameLanguage = activeSpeechLanguageCode === outgoingTarget;
        let finalText = trimmed;
        let translationWarning = "";
        if (!sameLanguage) {
          try {
            const translated = await resolveGuestTranslationForTarget(
              trimmed,
              activeSpeechLanguageCode,
              activeSpeechLanguageName,
              outgoingTarget,
              outgoingTargetName,
              requestController.signal
            );
            if (requestId !== activeTranslationRequestRef.current) return;
            if (translated.trim()) {
              finalText = translated.trim();
            }
          } catch (err) {
            if (
              requestController.signal.aborted ||
              (err instanceof Error && err.name === "AbortError")
            ) {
              throw err;
            }
            const message = err instanceof Error ? err.message : "Erreur de traduction.";
            translationWarning = toFriendlyAiError(message);
          }
        }

        if (!finalText) {
          return;
        }
        if (requestId !== activeTranslationRequestRef.current) return;
        if (!aiTrainingAutoStart) {
          const deliveryAllowed = await (deliveryGate ?? Promise.resolve(true)).catch(
            () => false
          );
          if (requestId !== activeTranslationRequestRef.current) return;
          if (!deliveryAllowed) {
            setCaptionError(translationUnavailableMessage);
            return;
          }
        }

        setCaptionText(finalText);
        setCaptionPhoneticTarget(outgoingTarget);
        scheduleCaptionClear();
        enqueueTts(finalText);
        if (guestTtsEnabled) {
          if (!ttsEnabled) {
            void speakGuestCaption(finalText, outgoingTarget);
          }
        }

        const payload: CaptionPayload = {
          id: safeRandomId(),
          text: finalText,
          target: outgoingTarget,
          audioTrackPublished: false,
          sourceText: trimmed,
          sourceLang: activeSpeechLanguageCode,
          sourceLangName: activeSpeechLanguageName,
          durationSeconds: Math.max(1, Math.floor(durationSeconds || 1)),
          from: localParticipant?.identity || "host",
          timestamp: Date.now(),
          roomId,
        };
        try {
          const encoder = new TextEncoder();
          await sendCaption(encoder.encode(JSON.stringify(payload)), {
            reliable: true,
            topic: "bfzoom-captions",
          });
          if (requestId !== activeTranslationRequestRef.current) return;
        } catch (err) {
          if (
            requestController.signal.aborted ||
            (err instanceof Error && err.name === "AbortError")
          ) {
            return;
          }
          const message = err instanceof Error ? err.message : "Diffusion impossible.";
          setCaptionError(`Sous-titres locaux uniquement: ${toFriendlyAiError(message)}`);
          return;
        }

        if (sameLanguage) {
          setCaptionError("Info: langue source et reception identiques, texte conserve.");
        } else if (translationWarning) {
          setCaptionError(
            `Traduction indisponible temporairement: affichage source conserve (${translationWarning})`
          );
        }
        if (aiPartnerActive) {
          void requestAiPartnerReply(trimmed);
        }
        if (requestId !== activeTranslationRequestRef.current) return;
      } catch (err) {
        if (
          requestController.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : "Erreur de traduction.";
        setCaptionError(`Traduction: ${toFriendlyAiError(message)}`);
      } finally {
        if (activeTranslationAbortRef.current === requestController) {
          activeTranslationAbortRef.current = null;
        }
        if (requestId === activeTranslationRequestRef.current) {
          setPushToTalkBusy(false);
        }
      }
    },
    [
      activeTranslationAbortRef,
      activeTranslationRequestRef,
      aiTrainingAutoStart,
      aiPartnerActive,
      enqueueTts,
      localParticipant?.identity,
      localReceptionTarget,
      localReceptionTargetName,
      roomId,
      scheduleCaptionClear,
      sendCaption,
      guestTtsEnabled,
      resolveGuestTranslationForTarget,
      ttsEnabled,
      speakGuestCaption,
      activeSpeechLanguageCode,
      activeSpeechLanguageName,
      requestAiPartnerReply,
      effectiveTranslationEnabled,
      translationUnavailableMessage,
    ]
  );
  const clearPushToTalkDraftTimer = useCallback(() => {
    if (pushToTalkDraftTimerRef.current) {
      clearTimeout(pushToTalkDraftTimerRef.current);
      pushToTalkDraftTimerRef.current = null;
    }
  }, []);
  const requestPushToTalkDraftReview = useCallback(
    async (
      draftId: number,
      transcript: string,
      captureSource: PushToTalkDraftCaptureSource = "speech"
    ) => {
      if (!shouldUsePushToTalkDraftReview) return;
      const normalizedTranscript = normalizeComparableText(transcript);
      if (!normalizedTranscript) return;
      const cacheKey = `${activeSpeechLanguageCode}:${captureSource}:${normalizedTranscript}`;
      const cached = pushToTalkDraftReviewCacheRef.current.get(cacheKey);
      if (cached) {
        if (pushToTalkDraftIdRef.current !== draftId) return;
        setPushToTalkDraftReview(cached);
        setPushToTalkDraftReviewBusy(false);
        return;
      }

      pushToTalkDraftReviewAbortRef.current?.abort();
      const requestController = new AbortController();
      pushToTalkDraftReviewAbortRef.current = requestController;
      const requestId = ++pushToTalkDraftReviewRequestRef.current;
      setPushToTalkDraftReview(null);
      setPushToTalkDraftReviewBusy(true);
      try {
        const review = await reviewPushToTalkDraftWithOpenAi(transcript, activeSpeechLanguageName, {
          signal: requestController.signal,
          targetCode: activeSpeechLanguageCode,
          guestToken: guestTtsToken,
          mode: pushToTalkDraftReviewMode,
          captureSource,
        });
        if (
          requestId !== pushToTalkDraftReviewRequestRef.current ||
          pushToTalkDraftIdRef.current !== draftId
        ) {
          return;
        }
        pushToTalkDraftReviewCacheRef.current.set(cacheKey, review);
        setPushToTalkDraftReview(review);
      } catch (err) {
        if (
          requestController.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        if (
          requestId !== pushToTalkDraftReviewRequestRef.current ||
          pushToTalkDraftIdRef.current !== draftId
        ) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Analyse avant envoi indisponible.";
        setCaptionError(
          `${pushToTalkDraftReviewMode === "translation" ? "Verification avant traduction" : "Verification avant envoi"}: ${toFriendlyAiError(message)}`
        );
        setPushToTalkDraftReview({
          status: "review",
          message: "Analyse indisponible. Corrige manuellement ou envoie tel quel.",
          correctedText: "",
          naturalText: "",
          familiarText: "",
          reviewedText: transcript,
        });
      } finally {
        if (pushToTalkDraftReviewAbortRef.current === requestController) {
          pushToTalkDraftReviewAbortRef.current = null;
        }
        if (
          requestId === pushToTalkDraftReviewRequestRef.current &&
          pushToTalkDraftIdRef.current === draftId
        ) {
          setPushToTalkDraftReviewBusy(false);
        }
      }
    },
    [
      activeSpeechLanguageCode,
      activeSpeechLanguageName,
      guestTtsToken,
      pushToTalkDraftReviewMode,
      shouldUsePushToTalkDraftReview,
    ]
  );
  const openPushToTalkManualDraft = useCallback(
    (message: string, elapsedSeconds: number, initialText = "") => {
      const transcript = initialText.trim();
      clearPushToTalkDraftTimer();
      const draftId = pushToTalkDraftIdRef.current + 1;
      pushToTalkDraftIdRef.current = draftId;
      setPushToTalkDraft({
        id: draftId,
        transcript,
        elapsedSeconds: Math.max(1, Math.floor(elapsedSeconds || 1)),
        captureSource: transcript ? "recording" : "manual",
        requiresExplicitConfirmation: true,
      });
      setPushToTalkDraftText(transcript);
      resetPushToTalkDraftReview();
      setPushToTalkDraftReview(buildManualPushToTalkDraftReview(message, transcript));
      setPushToTalkDraftEditing(true);
      setCaptionError(message);
    },
    [clearPushToTalkDraftTimer, resetPushToTalkDraftReview]
  );
  const submitPushToTalkDraft = useCallback(
    async (overrideText?: string) => {
      const draft = pushToTalkDraft;
      if (!draft) return;
      const finalTranscript = (overrideText ?? pushToTalkDraftText).trim();
      if (!finalTranscript) {
        setCaptionError("Corrige la phrase avant de l'envoyer.");
        return;
      }
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      pushToTalkDraftIdRef.current += 1;
      setPushToTalkDraft(null);
      setPushToTalkDraftEditing(false);
      setPushToTalkDraftText("");
      setPushToTalkGestureHint("");
      const deliveryGate = translationController
        ? onConsumeTranslationSeconds(draft.elapsedSeconds, "local")
        : undefined;
      try {
        await publishTalkieLock("claim");
        await translateAndBroadcast(finalTranscript, draft.elapsedSeconds, deliveryGate);
      } finally {
        void publishTalkieLock("release");
      }
    },
    [
      clearPushToTalkDraftTimer,
      onConsumeTranslationSeconds,
      publishTalkieLock,
      pushToTalkDraft,
      pushToTalkDraftText,
      resetPushToTalkDraftReview,
      translationController,
      translateAndBroadcast,
    ]
  );
  const queuePushToTalkDraft = useCallback(
    (
      rawTranscript: string,
      elapsedSeconds: number,
      options: QueuePushToTalkDraftOptions = {}
    ) => {
      const transcript = rawTranscript.trim();
      if (!transcript && !options.forceEditing) {
        void publishTalkieLock("release");
        setCaptionError(ui.noVoiceDetected);
        return;
      }
      clearPushToTalkDraftTimer();
      void publishTalkieLock("release");
      const draftId = pushToTalkDraftIdRef.current + 1;
      pushToTalkDraftIdRef.current = draftId;
      const draft: PushToTalkDraft = {
        id: draftId,
        transcript,
        elapsedSeconds: Math.max(1, Math.floor(elapsedSeconds || 1)),
        captureSource: options.captureSource || "speech",
        requiresExplicitConfirmation: Boolean(options.requiresExplicitConfirmation),
      };
      setPushToTalkDraft(draft);
      setPushToTalkDraftText(transcript);
      resetPushToTalkDraftReview();
      if (options.reviewOverride) {
        setPushToTalkDraftReview(options.reviewOverride);
      }
      const requireCorrection = transcript ? shouldForcePushToTalkCorrection(transcript) : true;
      const shouldStartEditing = Boolean(options.forceEditing) || requireCorrection;
      setPushToTalkDraftEditing(shouldStartEditing);
      if (shouldStartEditing) {
        setCaptionError(options.reviewOverride?.message || ui.incompleteDetection);
        return;
      }
      if (shouldUsePushToTalkDraftReview) {
        void requestPushToTalkDraftReview(draftId, transcript, draft.captureSource);
      }
    },
    [
      clearPushToTalkDraftTimer,
      publishTalkieLock,
      requestPushToTalkDraftReview,
      resetPushToTalkDraftReview,
      shouldUsePushToTalkDraftReview,
      ui.incompleteDetection,
      ui.noVoiceDetected,
    ]
  );
  const cancelPushToTalkDraft = useCallback(
    (message = "Capture annulee.") => {
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      void publishTalkieLock("release");
      pushToTalkDraftIdRef.current += 1;
      setPushToTalkDraft(null);
      setPushToTalkDraftText("");
      setPushToTalkDraftEditing(false);
      setPushToTalkGestureHint("");
      setCaptionError(message);
    },
    [clearPushToTalkDraftTimer, publishTalkieLock, resetPushToTalkDraftReview]
  );
  const cancelPushToTalkCapture = useCallback(
    (message = "Capture annulee.") => {
      pushToTalkSessionRef.current += 1;
      pushToTalkPressedRef.current = false;
      pushToTalkStartedAtRef.current = null;
      pushToTalkPointerIdRef.current = null;
      pushToTalkPointerStartRef.current = null;
      pushToTalkCancelArmedRef.current = false;
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      recognitionRef.current = null;
      const recorder = pushToTalkRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
      pushToTalkRecorderRef.current = null;
      pushToTalkChunksRef.current = [];
      releasePushToTalkStream();
      void publishTalkieLock("release");
      setPushToTalkActive(false);
      setPushToTalkBusy(false);
      cancelPushToTalkDraft(message);
      if (pushToTalkInterruptTimerRef.current) {
        clearTimeout(pushToTalkInterruptTimerRef.current);
      }
      setPushToTalkInterruptHint("Interrompu: nouvelle capture en cours.");
      pushToTalkInterruptTimerRef.current = setTimeout(() => {
        setPushToTalkInterruptHint("");
        pushToTalkInterruptTimerRef.current = null;
      }, 1800);
      void stopTts();
      stopGuestCaptionPlayback();
    },
    [
      cancelPushToTalkDraft,
      publishTalkieLock,
      releasePushToTalkStream,
      stopGuestCaptionPlayback,
      stopTts,
    ]
  );
  const setPushToTalkDraftEditMode = useCallback(() => {
    clearPushToTalkDraftTimer();
    setPushToTalkDraftEditing(true);
  }, [clearPushToTalkDraftTimer]);
  const handlePushToTalkDraftTextChange = useCallback(
    (nextValue: string) => {
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      setPushToTalkDraftEditing(true);
      setPushToTalkDraftText(nextValue);
    },
    [clearPushToTalkDraftTimer, resetPushToTalkDraftReview]
  );
  const applyPushToTalkDraftSuggestion = useCallback(
    (nextValue: string) => {
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      setPushToTalkDraftText(nextValue);
      setPushToTalkDraftEditing(true);
    },
    [clearPushToTalkDraftTimer, resetPushToTalkDraftReview]
  );
  const pushToTalkDraftReviewCurrent = isPushToTalkDraftReviewCurrent(
    pushToTalkDraftReview,
    pushToTalkDraftText
  );
  const pushToTalkDraftAutoSendEnabled =
    Boolean(pushToTalkDraft) &&
    !pushToTalkDraftEditing &&
    !pushToTalkDraft?.requiresExplicitConfirmation &&
    !shouldForcePushToTalkCorrection(pushToTalkDraftText) &&
    (!shouldUsePushToTalkDraftReview ||
      (!pushToTalkDraftReviewBusy &&
        pushToTalkDraftReviewCurrent &&
        pushToTalkDraftReview?.status === "ok"));
  useEffect(() => {
    clearPushToTalkDraftTimer();
    if (!pushToTalkDraft || !pushToTalkDraftAutoSendEnabled) return;
    const draftId = pushToTalkDraft.id;
    pushToTalkDraftTimerRef.current = setTimeout(() => {
      if (pushToTalkDraftIdRef.current !== draftId) return;
      void submitPushToTalkDraft();
    }, PUSH_TO_TALK_AUTO_SEND_MS);
    return clearPushToTalkDraftTimer;
  }, [
    clearPushToTalkDraftTimer,
    pushToTalkDraft,
    pushToTalkDraftAutoSendEnabled,
    submitPushToTalkDraft,
  ]);

  const startPushToTalkRecognition = useCallback(() => {
    if (!effectiveTranslationEnabled) {
      setCaptionError(translationUnavailableMessage);
      return;
    }
    if (!captionsEnabled) return;
    if (isTalkieLockedByOther) {
      setCaptionError(talkieLockedMessage);
      return;
    }
    if (pushToTalkPressedRef.current) return;
    if (pushToTalkBusy || aiPartnerBusyRef.current) {
      interruptCurrentTurn();
      showPushToTalkInterruptHint();
    }
    if (realtimeEnabled) {
      setCaptionError(ui.disableRealtimeForPushToTalk);
      return;
    }
    if (!captionsSupported || typeof window === "undefined") return;
    if (pushToTalkRecorderRef.current || recognitionRef.current) {
      stopPushToTalkRecognition();
    }
    if (ttsPlayingRef.current || ttsQueueRef.current.length > 0) {
      void stopTts();
    }
    stopGuestCaptionPlayback();
    setAiPartnerOverlayText("");
    const sessionId = pushToTalkSessionRef.current + 1;
    pushToTalkSessionRef.current = sessionId;
    pushToTalkPressedRef.current = true;
    pushToTalkStartedAtRef.current = Date.now();
    setCaptionError("");
    setPushToTalkActive(true);
    void publishTalkieLock("claim");

    if (speechRecognitionSupported && !preferRecorderPushToTalk) {
      const maybeWindow = window as unknown as {
        SpeechRecognition?: new () => any;
        webkitSpeechRecognition?: new () => any;
      };
      const SpeechCtor = maybeWindow.SpeechRecognition || maybeWindow.webkitSpeechRecognition;
      if (SpeechCtor) {
        let finalTranscript = "";
        const recognition = new SpeechCtor();
        recognition.lang = activeSpeechLanguageLocale || "fr-FR";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;
        recognition.onresult = (event: any) => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          let interim = "";
          let finalChunk = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const item = event.results[index];
            const transcript = String(item?.[0]?.transcript || "").trim();
            if (!transcript) continue;
            if (item.isFinal) {
              finalChunk += ` ${transcript}`;
            } else {
              interim += ` ${transcript}`;
            }
          }
          if (finalChunk.trim()) {
            finalTranscript = `${finalTranscript} ${finalChunk}`.trim();
          }
          const preview = `${finalTranscript} ${interim}`.trim();
          if (preview) {
            setSourceText(preview);
            setSourceFromLocal(true);
          }
        };
        recognition.onerror = (event: any) => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          const reason = String(event?.error || "Erreur micro");
          if (reason === "aborted") return;
          void publishTalkieLock("release");
          if (reason === "no-speech") {
      setCaptionError(ui.noVoiceDetected);
            return;
          }
          const friendly = toFriendlyAiError(reason);
          setCaptionError(`Micro: ${friendly}`);
          if (/not-allowed|service-not-allowed|permission|denied/i.test(reason)) {
            onDisableCaptions();
          }
        };
        recognition.onend = () => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          recognitionRef.current = null;
          setPushToTalkActive(false);
          const transcript = finalTranscript.trim();
          const elapsedSeconds = Math.max(
            1,
            Math.round(
              ((Date.now() - (pushToTalkStartedAtRef.current ?? Date.now())) / 1000) || 1
            )
          );
          pushToTalkStartedAtRef.current = null;
          if (!transcript) {
            void publishTalkieLock("release");
            if (!pushToTalkBusy) {
              setCaptionError(ui.noVoiceDetected);
            }
            return;
          }
          void publishTalkieLock("release");
          queuePushToTalkDraft(transcript, elapsedSeconds, {
            captureSource: "speech",
          });
        };
        try {
          recognition.start();
          return;
        } catch (err) {
          recognitionRef.current = null;
        }
      }
    }

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPushToTalkActive(false);
      void publishTalkieLock("release");
      setCaptionError("Push-to-talk indisponible sur ce navigateur.");
      return;
    }

    void (async () => {
      try {
        const warmedStream = pushToTalkStreamRef.current;
        const stream =
          warmedStream && warmedStream.active
            ? warmedStream
            : await navigator.mediaDevices.getUserMedia({ audio: true });
        pushToTalkStreamRef.current = stream;
        if (pushToTalkWarmStreamTimerRef.current) {
          clearTimeout(pushToTalkWarmStreamTimerRef.current);
          pushToTalkWarmStreamTimerRef.current = null;
        }
        pushToTalkChunksRef.current = [];
        const mimeType = getRecorderMimeType();
        pushToTalkMimeTypeRef.current = mimeType || "audio/webm";
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        pushToTalkRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          if (!event.data || event.data.size === 0) return;
          pushToTalkChunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          void publishTalkieLock("release");
          setCaptionError("Enregistrement audio interrompu.");
          setPushToTalkBusy(false);
          setPushToTalkActive(false);
          pushToTalkRecorderRef.current = null;
          pushToTalkChunksRef.current = [];
          releasePushToTalkStream();
        };
        recorder.onstop = () => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          const chunks = [...pushToTalkChunksRef.current];
          pushToTalkChunksRef.current = [];
          pushToTalkRecorderRef.current = null;
          releasePushToTalkStream();
          if (chunks.length === 0) {
            pushToTalkStartedAtRef.current = null;
            void publishTalkieLock("release");
            setPushToTalkBusy(false);
            return;
          }
          const mimeTypeValue = pushToTalkMimeTypeRef.current || "audio/webm";
          const blob = new Blob(chunks, { type: mimeTypeValue });
          if (blob.size < 1400) {
            pushToTalkStartedAtRef.current = null;
            void publishTalkieLock("release");
            setCaptionError("Audio trop court. Maintiens le bouton un peu plus longtemps.");
            setPushToTalkBusy(false);
            return;
          }
          void (async () => {
            const elapsedSeconds = Math.max(
              1,
              Math.round(
                ((Date.now() - (pushToTalkStartedAtRef.current ?? Date.now())) / 1000) || 1
              )
            );
            pushToTalkStartedAtRef.current = null;
            try {
              if (sessionId !== pushToTalkSessionRef.current) return;
              setPushToTalkBusy(true);
              const transcript = await transcribePushToTalkBlob(blob, mimeTypeValue);
              if (sessionId !== pushToTalkSessionRef.current) return;
              if (!transcript) {
                void publishTalkieLock("release");
                if (aiTrainingAutoStart) {
                  openPushToTalkManualDraft(
                    ui.mobileTranscriptionUnclear,
                    elapsedSeconds
                  );
                  return;
                }
                setCaptionError(ui.noVoiceDetected);
                return;
              }
              void publishTalkieLock("release");
              queuePushToTalkDraft(transcript, elapsedSeconds, {
                captureSource: "recording",
                requiresExplicitConfirmation: aiTrainingAutoStart,
              });
            } catch (err) {
              if (sessionId !== pushToTalkSessionRef.current) return;
              void publishTalkieLock("release");
              const message = err instanceof Error ? err.message : "Transcription impossible.";
              if (aiTrainingAutoStart) {
                openPushToTalkManualDraft(
                  `${ui.mobileTranscriptionFailed} (${toFriendlyAiError(message)})`,
                  elapsedSeconds
                );
                return;
              }
              setCaptionError(`Traduction: ${toFriendlyAiError(message)}`);
            } finally {
              if (sessionId !== pushToTalkSessionRef.current) return;
              setPushToTalkBusy(false);
            }
          })();
        };
        recorder.start();
        if (!pushToTalkPressedRef.current && recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (err) {
        if (sessionId !== pushToTalkSessionRef.current) return;
        pushToTalkStartedAtRef.current = null;
        setPushToTalkActive(false);
        setPushToTalkBusy(false);
        void publishTalkieLock("release");
        const message = err instanceof Error ? err.message : "Acces micro refuse.";
        setCaptionError(`Micro: ${toFriendlyAiError(message)}`);
        if (/denied|notallowed|permission/i.test(message)) {
          onDisableCaptions();
        }
        pushToTalkRecorderRef.current = null;
        pushToTalkChunksRef.current = [];
        releasePushToTalkStream();
      }
    })();
  }, [
    captionsEnabled,
    captionsSupported,
    getRecorderMimeType,
    onDisableCaptions,
    pushToTalkBusy,
    realtimeEnabled,
    releasePushToTalkStream,
    activeSpeechLanguageLocale,
    preferRecorderPushToTalk,
    speechRecognitionSupported,
    interruptCurrentTurn,
    isTalkieLockedByOther,
    publishTalkieLock,
    showPushToTalkInterruptHint,
    stopGuestCaptionPlayback,
    stopPushToTalkRecognition,
    stopTts,
    transcribePushToTalkBlob,
    effectiveTranslationEnabled,
    aiTrainingAutoStart,
    openPushToTalkManualDraft,
    queuePushToTalkDraft,
    translationUnavailableMessage,
    talkieLockedMessage,
    ui.disableRealtimeForPushToTalk,
    ui.mobileTranscriptionFailed,
    ui.mobileTranscriptionUnclear,
    ui.noVoiceDetected,
  ]);
  const handlePushToTalkPointerDown = useCallback(
    (event: any) => {
      event.preventDefault();
      if (typeof event.pointerId === "number" && event.currentTarget?.setPointerCapture) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
      }
      pushToTalkPointerIdRef.current =
        typeof event.pointerId === "number" ? event.pointerId : null;
      pushToTalkPointerStartRef.current = {
        x: Number(event.clientX ?? 0),
        y: Number(event.clientY ?? 0),
      };
      pushToTalkCancelArmedRef.current = false;
      setPushToTalkGestureHint("Glisse a gauche pour annuler.");
      startPushToTalkRecognition();
    },
    [startPushToTalkRecognition]
  );
  const handlePushToTalkPointerMove = useCallback((event: any) => {
    if (!pushToTalkPressedRef.current) return;
    const activePointerId = pushToTalkPointerIdRef.current;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    const origin = pushToTalkPointerStartRef.current;
    if (!origin) return;
    const deltaX = Number(event.clientX ?? origin.x) - origin.x;
    if (deltaX <= -PUSH_TO_TALK_CANCEL_DISTANCE_PX) {
      if (!pushToTalkCancelArmedRef.current) {
        pushToTalkCancelArmedRef.current = true;
        setPushToTalkGestureHint("Relache pour annuler.");
      }
    } else if (pushToTalkCancelArmedRef.current) {
      pushToTalkCancelArmedRef.current = false;
      setPushToTalkGestureHint("Glisse a gauche pour annuler.");
    }
  }, []);
  const handlePushToTalkPointerEnd = useCallback(
    (event?: any, forcedCancel = false) => {
      if (event) {
        event.preventDefault();
        const activePointerId = pushToTalkPointerIdRef.current;
        if (
          typeof event.pointerId === "number" &&
          activePointerId !== null &&
          activePointerId !== event.pointerId
        ) {
          return;
        }
      }
      if (!pushToTalkPressedRef.current) {
        setPushToTalkGestureHint("");
        return;
      }
      const shouldCancel = forcedCancel || pushToTalkCancelArmedRef.current;
      pushToTalkPointerIdRef.current = null;
      pushToTalkPointerStartRef.current = null;
      pushToTalkCancelArmedRef.current = false;
      setPushToTalkGestureHint("");
      if (shouldCancel) {
        cancelPushToTalkCapture("Capture annulee: relance une nouvelle prise.");
        return;
      }
      stopPushToTalkRecognition();
    },
    [cancelPushToTalkCapture, stopPushToTalkRecognition]
  );

  useEffect(() => {
    if (!captionsEnabled || realtimeEnabled || !effectiveTranslationEnabled) {
      stopPushToTalkRecognition();
      void publishTalkieLock("release");
      setPushToTalkActive(false);
      setPushToTalkBusy(false);
      clearPushToTalkDraftTimer();
      setPushToTalkDraft(null);
      setPushToTalkDraftText("");
      setPushToTalkDraftEditing(false);
      resetPushToTalkDraftReview();
      setPushToTalkGestureHint("");
    }
  }, [
    captionsEnabled,
    realtimeEnabled,
    publishTalkieLock,
    stopPushToTalkRecognition,
    effectiveTranslationEnabled,
    clearPushToTalkDraftTimer,
    resetPushToTalkDraftReview,
  ]);

  const retryMicrophone = async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "Erreur micro inconnue.");
    }
  };

  const toggleCamera = async () => {
    if (!localParticipant) return;
    if (isTogglingCamera) return;
    if (roomIsRecovering) return;
    setIsTogglingCamera(true);
    setMediaError("");

    const nextEnabled = !isCameraEnabled;
    try {
      if (
        nextEnabled &&
        typeof navigator !== "undefined" &&
        navigator.mediaDevices?.getUserMedia
      ) {
        // iOS Safari sometimes needs an explicit media request before publishing camera.
        const warmup = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        warmup.getTracks().forEach((track) => track.stop());
      }

      await localParticipant.setCameraEnabled(nextEnabled);

      if (nextEnabled) {
        const publication = localParticipant.getTrackPublication(Track.Source.Camera);
        if (!publication?.track) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await localParticipant.setCameraEnabled(true);
        }
      }
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : "Impossible d'activer la camera."
      );
    } finally {
      setIsTogglingCamera(false);
    }
  };

  const flipCamera = async () => {
    if (isFlippingCamera) return;
    setIsFlippingCamera(true);
    try {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const track = publication?.track as unknown as
        | {
            getDeviceId: (normalize?: boolean) => Promise<string | undefined>;
            setDeviceId: (id: string) => Promise<boolean>;
          }
        | undefined;
      if (!track) {
        setMediaError("Camera non active.");
        return;
      }
      const devices = await Room.getLocalDevices("videoinput");
      if (devices.length < 2) return;
      const currentId = await track.getDeviceId();
      let currentIndex = devices.findIndex((device) => device.deviceId === currentId);
      if (currentIndex < 0) currentIndex = 0;
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      await track.setDeviceId(nextDevice.deviceId);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "Impossible de changer de camera.");
    } finally {
      setIsFlippingCamera(false);
    }
  };

  useEffect(() => {
    if (!isMobile) return;
    if (focusTrack) return;
    if (layoutContext.pin.state && layoutContext.pin.state.length > 0) return;
    if (remoteParticipants.length === 0) return;
    if (manualPinRef.current) return;

    const primaryRemote = remoteParticipants.find(
      (participant) => participant.identity === lastAutoPinnedParticipantRef.current
    ) ?? remoteParticipants[0];
    if (!primaryRemote) return;

    const remoteCamera = tracks.find(
      (track) =>
        track.publication?.source === Track.Source.Camera &&
        track.participant?.identity === primaryRemote.identity
    );
    if (remoteCamera && isTrackReference(remoteCamera)) {
      layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: remoteCamera });
      lastAutoPinnedParticipantRef.current = primaryRemote.identity;
    }
  }, [focusTrack, isMobile, layoutContext.pin, remoteParticipants, tracks]);

  useEffect(() => {
    if (!room || !isMobile) return;

    const handleActiveSpeakers = (speakers: Participant[]) => {
      if (manualPinRef.current) return;
      const remoteSpeaker = speakers.find((speaker) => !speaker.isLocal);
      if (!remoteSpeaker) return;
      if (lastAutoSpeakerRef.current === remoteSpeaker.identity) return;
      const now = Date.now();
      if (now - lastAutoSpeakerSwitchRef.current < 2500) return;

      const remoteCamera = tracks.find(
        (track) =>
          track.publication?.source === Track.Source.Camera &&
          track.participant?.identity === remoteSpeaker.identity
      );
      if (remoteCamera && isTrackReference(remoteCamera)) {
        layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: remoteCamera });
        lastAutoPinnedParticipantRef.current = remoteSpeaker.identity;
        lastAutoSpeakerRef.current = remoteSpeaker.identity;
        lastAutoSpeakerSwitchRef.current = now;
      }
    };

    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    };
  }, [isMobile, layoutContext.pin, room, tracks]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS || !localParticipant) return;

    const refreshCamera = (eventType?: "visibilitychange" | "pageshow" | "orientationchange") => {
      if (roomIsRecovering) return;
      if (eventType === "pageshow" && initialPageShowRef.current) {
        initialPageShowRef.current = false;
        return;
      }
      const now = Date.now();
      if (now - lastCameraRefreshRef.current < 2500) return;
      lastCameraRefreshRef.current = now;
      if (document.visibilityState !== "visible") return;
      if (!isCameraEnabled) return;
      const pub = localParticipant.getTrackPublication(Track.Source.Camera);
      if (!pub || !pub.isEnabled) return;
      void localParticipant.setCameraEnabled(false).then(() => {
        setTimeout(() => {
          void localParticipant.setCameraEnabled(true);
        }, 250);
      });
    };

    const handleVisibility = () => refreshCamera("visibilitychange");
    const handlePageShow = () => refreshCamera("pageshow");
    const handleOrientation = () => refreshCamera("orientationchange");

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("orientationchange", handleOrientation);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("orientationchange", handleOrientation);
    };
  }, [isCameraEnabled, localParticipant, roomIsRecovering]);

  const handleTrackSelect = useCallback(
    (trackRef: TrackReferenceOrPlaceholder) => {
      let resolvedTrack = trackRef;
      if (!isTrackReference(trackRef)) {
        const fallback = tracks.find(
          (track) =>
            isTrackReference(track) &&
            track.participant.identity === trackRef.participant.identity &&
            track.source === trackRef.source
        );
        if (fallback) resolvedTrack = fallback;
      }
      if (isIPhone) {
        setIphoneFocus(resolvedTrack);
        return;
      }
      if (!isTrackReference(resolvedTrack)) return;

      const isPinned = isTrackReferencePinned(resolvedTrack, layoutContext.pin.state);
      manualPinRef.current = !isPinned;
      layoutContext.pin.dispatch?.({
        msg: isPinned ? "clear_pin" : "set_pin",
        trackReference: resolvedTrack,
      });
    },
    [isIPhone, layoutContext.pin, tracks]
  );

  useEffect(() => {
    const hasScreenShare = screenShareTracks.length > 0;
    if (hasScreenShare && lastAutoFocusedScreenShareTrack.current === null) {
      layoutContext.pin.dispatch?.({
        msg: "set_pin",
        trackReference: screenShareTracks[0],
      });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (track) =>
          track.publication.trackSid ===
          lastAutoFocusedScreenShareTrack.current?.publication?.trackSid
      )
    ) {
      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
      lastAutoFocusedScreenShareTrack.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updatedFocusTrack = tracks.find(
        (tr) =>
          tr.participant.identity === focusTrack.participant.identity &&
          tr.source === focusTrack.source
      );
      if (updatedFocusTrack !== focusTrack && isTrackReference(updatedFocusTrack)) {
        layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: updatedFocusTrack });
      }
    }
    if (focusTrack && isTrackReference(focusTrack)) {
      const stillExists = tracks.some((track) => isEqualTrackRef(track, focusTrack));
      if (!stillExists) {
        manualPinRef.current = false;
        layoutContext.pin.dispatch?.({ msg: "clear_pin" });
      }
    }
  }, [screenShareTracks, focusTrack, tracks, layoutContext.pin]);

  const resolvedIphoneFocus = useMemo(() => {
    if (!isIPhone) return null;
    if (iphoneFocus && iphoneCameraTracks.some((track) => isEqualTrackRef(track, iphoneFocus))) {
      return iphoneFocus;
    }
    const remoteFirst = iphoneCameraTracks.find(
      (track) => track.participant && track.participant.identity !== localParticipant?.identity
    );
    return remoteFirst || iphoneCameraTracks[0] || null;
  }, [iphoneCameraTracks, iphoneFocus, isIPhone, localParticipant?.identity]);

  useEffect(() => {
    if (!isIPhone) return;
    if (!iphoneFocus) return;
    const stillExists = iphoneCameraTracks.some((track) => isEqualTrackRef(track, iphoneFocus));
    if (!stillExists) {
      setIphoneFocus(null);
    }
  }, [iphoneCameraTracks, iphoneFocus, isIPhone]);

  const annotationOverlay = useAnnotationSync({ roomId, isHost });
  const {
    overlayRef,
    drawingEnabled,
    setDrawingEnabled,
    brushColor,
    setBrushColor,
    brushWidth,
    setBrushWidth,
    handleAnnotationStart,
    handleAnnotationMove,
    stopAnnotation,
    undoAnnotation,
    clearAnnotations,
    getLatestStroke,
    sendStroke,
    sendUndo,
    sendClear,
    addTextEntry,
    sendTextEntry,
  } = annotationOverlay;
  const handleAnnotationStop = useCallback(() => {
    const stroke = getLatestStroke();
    if (stroke) {
      sendStroke(stroke);
    }
  }, [getLatestStroke, sendStroke]);
  const handleAnnotationUndo = useCallback(() => {
    sendUndo();
  }, [sendUndo]);
  const handleAnnotationClear = useCallback(() => {
    sendClear();
  }, [sendClear]);
  const handleAnnotationTextDesktop = useCallback(
    (entry: AnnotationText) => {
      addTextEntry(entry);
      sendTextEntry(entry);
    },
    [addTextEntry, sendTextEntry]
  );
  const ensureShareInviteId = useCallback(async () => {
    if (!isHost || !roomId) return "";
    if (shareInviteId) return shareInviteId;
    const inviteId = await createLivekitRoomInviteId(roomId);
    setShareInviteId((current) => current || inviteId);
    return inviteId;
  }, [isHost, roomId, shareInviteId]);
  useEffect(() => {
    setShareInviteId("");
  }, [roomId]);
  useEffect(() => {
    if (!isHost || !roomId) return;
    void ensureShareInviteId().catch(() => {});
  }, [ensureShareInviteId, isHost, roomId]);

  const inviteLinks = shareInviteId ? buildInviteLinks(shareInviteId) : { smart: "" };

  const copyInvite = async (kind: InviteLinkKind) => {
    const activeInviteId = await ensureShareInviteId().catch(() => "");
    const link = activeInviteId ? buildInviteLinks(activeInviteId)[kind] : inviteLinks[kind];
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(kind);
      setTimeout(() => setInviteCopied(null), 1500);
    } catch {
      setInviteCopied(null);
    }
  };
  const shareInvite = async () => {
    const activeInviteId = await ensureShareInviteId().catch(() => "");
    const link = activeInviteId ? buildInviteLinks(activeInviteId).smart : inviteLinks.smart;
    if (!link) return;
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      setInviteCopied(null);
      return;
    }
    const shareTitle = ui.inviteEmailSubject;
    const shareText = ui.inviteEmailBody;
    void navigator
      .share({
        title: shareTitle,
        text: shareText,
        url: link,
      })
      .then(() => {
        setInviteCopied("shared");
        setTimeout(() => setInviteCopied(null), 1500);
      })
      .catch(() => {
        setInviteCopied(null);
      });
  };
  const pushToTalkDisabled =
    translationControlsDisabled ||
    !captionsSupported ||
    !pushToTalkSupported ||
    realtimeEnabled ||
    isTalkieLockedByOther;
  const pushToTalkTitle = translationControlsDisabled
    ? translationUnavailableMessage
    : isTalkieLockedByOther
    ? talkieLockedMessage
    : realtimeEnabled
    ? "Desactive Realtime pour utiliser ce mode."
    : "Maintiens le bouton pendant que tu parles, puis relache pour traduire.";
  const pushToTalkOverlay =
    captionsEnabled && !aiPartnerActive ? (
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4 sm:bottom-8">
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={handlePushToTalkPointerDown}
          onPointerMove={handlePushToTalkPointerMove}
          onPointerUp={handlePushToTalkPointerEnd}
          onPointerCancel={(event) => handlePushToTalkPointerEnd(event, true)}
          onTouchStart={(event) => {
            event.preventDefault();
            startPushToTalkRecognition();
          }}
          onTouchEnd={(event) => {
            event.preventDefault();
            handlePushToTalkPointerEnd();
          }}
          onTouchCancel={(event) => {
            event.preventDefault();
            handlePushToTalkPointerEnd(undefined, true);
          }}
          onMouseDown={startPushToTalkRecognition}
          onMouseUp={() => handlePushToTalkPointerEnd()}
          onMouseLeave={() => {
            if (!pushToTalkPressedRef.current) return;
            handlePushToTalkPointerEnd(undefined, true);
          }}
          disabled={pushToTalkDisabled}
          className={`pointer-events-auto inline-flex min-h-11 w-full max-w-sm items-center justify-center gap-2 rounded-full border px-5 py-3 text-[13px] font-semibold shadow-2xl ring-1 ring-black/40 transition ${
            pushToTalkActive
              ? "border-rose-200! bg-rose-600! text-white!"
              : pushToTalkBusy
              ? "border-sky-200! bg-sky-600! text-white!"
              : "border-emerald-200! bg-emerald-700! text-white! hover:bg-emerald-600!"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title={pushToTalkTitle}
          style={{
            backgroundColor: pushToTalkActive
              ? "rgba(225, 29, 72, 0.95)"
              : pushToTalkBusy
              ? "rgba(2, 132, 199, 0.95)"
              : "rgba(4, 120, 87, 0.95)",
            color: "#ffffff",
            borderColor: "rgba(226, 232, 240, 0.95)",
          }}
        >
          <Mic className="h-4 w-4" />
          <span className="whitespace-nowrap">
            {pushToTalkActive
              ? ui.releaseToTranslate
              : pushToTalkBusy
              ? ui.translating
              : ui.holdToTalk}
          </span>
        </button>
      </div>
    ) : null;
  const languageOverlay = !aiPartnerActive ? (
    <div className="pointer-events-none absolute left-4 top-4 z-30 w-[min(22rem,calc(100%-2rem))]">
      <details
        onClick={(event) => event.stopPropagation()}
        className="pointer-events-auto rounded-2xl border px-3 py-2 text-[11px] text-slate-100 shadow-xl backdrop-blur"
        style={{
          backgroundColor: "rgba(2, 6, 23, 0.9)",
          color: "#f8fafc",
          borderColor: "rgba(100, 116, 139, 0.8)",
        }}
      >
        <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200/90">
          {ui.translationLanguages}
        </summary>
        <div className="mt-3 space-y-3">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-slate-100">{ui.spokenLanguage}</span>
            <select
              value={sourceLanguage}
              onChange={(event) =>
                onChangeSourceLanguage(event.target.value as SourceLanguageOption["code"])
              }
              disabled={translationControlsDisabled}
              className="rounded-md border border-slate-500 bg-slate-900 px-2 py-2 text-[11px] text-slate-100"
              style={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                color: "#f8fafc",
                borderColor: "rgba(100, 116, 139, 0.85)",
              }}
            >
              {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {`${option.name} (${option.label})`}
                </option>
              ))}
            </select>
          </label>
          {!isChatSession && !aiTrainingAutoStart && (
            <button
              type="button"
              onClick={onToggleGuestTts}
              disabled={translationControlsDisabled}
              className={`inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-full border px-3 py-2 text-[12px] font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-55 ${
                guestTtsEnabled
                  ? "border-sky-300/80 bg-sky-600/90 text-white"
                  : "border-slate-500/70 bg-slate-800/80 text-slate-100"
              }`}
              title="Active la voix traduite locale pour s'exercer."
              style={{
                backgroundColor: guestTtsEnabled
                  ? "rgba(2, 132, 199, 0.95)"
                  : "rgba(15, 23, 42, 0.95)",
                color: "#ffffff",
                borderColor: guestTtsEnabled
                  ? "rgba(125, 211, 252, 0.95)"
                  : "rgba(148, 163, 184, 0.85)",
              }}
            >
              <Volume2 className="h-4 w-4" />
              <span>
                {ui.localPlayback}:{" "}
                {translationControlsDisabled ? ui.blocked : guestTtsEnabled ? "ON" : "OFF"}
              </span>
            </button>
          )}
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-slate-100">
              {guestTtsEnabled ? ui.communicationLanguage : ui.personalReceptionLanguage}
            </span>
            <select
              value={localReceptionTarget}
              onChange={(event) =>
                handleLocalReceptionTargetChange(event.target.value as CaptionTarget)
              }
              disabled={translationControlsDisabled}
              className="rounded-md border border-slate-500 bg-slate-900 px-2 py-2 text-[11px] text-slate-100"
              style={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                color: "#f8fafc",
                borderColor: "rgba(100, 116, 139, 0.85)",
              }}
            >
              {CAPTION_TARGETS_CONFIG.map((target) => (
                <option key={target.code} value={target.code}>
                  {`${target.name} (${target.label})`}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-flex items-center gap-1">
            <span className="text-[10px] text-slate-300">{ui.info}</span>
            <InfoBubble text={localReceptionHint} label={ui.receptionInfoLabel} align="right" />
          </div>
        </div>
      </details>
    </div>
  ) : null;

  return (
    <div
      className="lk-video-conference"
      data-auto-frame={autoFrame ? "true" : "false"}
      data-video-fit={videoFit}
      data-unmirror-local-preview={backgroundMode === "ai" ? "true" : "false"}
    >
      <LayoutContextProvider value={layoutContext} onWidgetChange={onWidgetChange}>
        <div
          className="lk-video-conference-inner"
          onClick={() => {
            if (lockControlsToggleInAiMode) return;
            setControlsHidden((value) => !value);
          }}
        >
          <AnnotationLayer
            overlayRef={overlayRef}
            drawingEnabled={drawingEnabled}
            setDrawingEnabled={setDrawingEnabled}
            brushColor={brushColor}
            setBrushColor={setBrushColor}
            brushWidth={brushWidth}
            setBrushWidth={setBrushWidth}
            handleAnnotationStart={handleAnnotationStart}
            handleAnnotationMove={handleAnnotationMove}
            stopAnnotation={stopAnnotation}
            undoAnnotation={undoAnnotation}
            clearAnnotations={clearAnnotations}
            onAnnotationStop={handleAnnotationStop}
            onAnnotationUndo={handleAnnotationUndo}
            onAnnotationClear={handleAnnotationClear}
            onAnnotationText={handleAnnotationTextDesktop}
            isHost={isHost}
            drawerOpen={isSettingsOpen}
          />
          <TimerOverlay timerState={timerState} />
          <ActionControls
            visible={actionControlsState.visible}
            onAction={sendActionItem}
            onClose={() =>
              setActionControlsState((state) => ({ ...state, visible: false }))
            }
          />
          {audioUnlockRequired && (
            <div className="absolute right-3 top-3 z-40">
              <button
                type="button"
                onClick={() => {
                  void activateRoomAudio();
                }}
                className="rounded-full border border-amber-300/80 bg-amber-500/95 px-3 py-1 text-[11px] font-semibold text-slate-950 shadow-lg"
              >
                Activer audio
              </button>
            </div>
          )}
          {!widgetState.showChat && roomChat.toastMessage && (
            <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-sky-300/70 bg-slate-900/95 px-4 py-1 text-[11px] text-sky-100 shadow-lg">
              {roomChat.toastMessage}
            </div>
          )}
          {showCaptionStack && (
            <div className="pointer-events-none absolute inset-x-0 top-18 z-20 flex justify-center px-4 sm:top-20">
              <div className="w-full max-w-4xl space-y-2">
                {sourceText && (
                  <div className="rounded-xl border border-slate-400/70 bg-slate-950/90 px-3 py-2 text-slate-50 shadow-lg backdrop-blur">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-200/90">
                        {ui.sourceLabel(activeSpeechLanguageName)}
                      </p>
                      {sourceFromLocal && (
                        <span className="rounded-full border border-emerald-300/70 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                          {ui.directSpeech}
                        </span>
                      )}
                    </div>
                    <p
                      className={
                        captionSize === "lg"
                          ? "text-[15px]"
                          : captionSize === "md"
                          ? "text-[13px]"
                          : "text-[12px]"
                      }
                    >
                      {sourceText}
                    </p>
                  </div>
                )}
                {captionText && (
                  <div className="rounded-xl border border-sky-300/80 bg-slate-950/90 px-4 py-2 text-center text-slate-50 shadow-lg backdrop-blur">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-200/90">
                      {ui.translationLabel(captionTargetLabel)}
                    </p>
                    <p
                      className={
                        captionSize === "lg"
                          ? "text-[16px] font-semibold"
                          : captionSize === "md"
                          ? "text-[14px] font-semibold"
                          : "text-[12px] font-semibold"
                      }
                    >
                      {captionText}
                    </p>
                    {exercisePhoneticEnabled && captionPhoneticText && (
                      <p className="mt-1 text-[11px] italic text-violet-100/95">
                        Phonetique: {captionPhoneticText}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {!lockControlsToggleInAiMode && (
            <button
              onClick={() => setControlsHidden((value) => !value)}
              className="absolute left-4 bottom-[calc(var(--lk-control-bar-height)+12px)] z-20 rounded-full border px-3 py-2 text-[11px] font-semibold shadow-md"
              aria-label="Afficher ou masquer les controles"
              onClickCapture={(event) => event.stopPropagation()}
              style={{
                backgroundColor: "rgba(2, 6, 23, 0.9)",
                color: "#f8fafc",
                borderColor: "rgba(148, 163, 184, 0.85)",
              }}
            >
              {controlsHidden ? "Afficher" : "Masquer"}
            </button>
          )}
          {aiPartnerActive ? (
            <AiPartnerAvatarStage
              roomId={roomId}
              sourceLanguageCode={sourceLanguage}
              sourceLanguageName={sourceLanguageName}
              spokenLanguageCode={activeSpeechLanguageCode}
              spokenLanguageName={activeSpeechLanguageName}
              targetLanguageName={captionDisplayTargetName}
              sourceText={sourceText}
              userTranslatedText={captionText}
              userPhoneticText={captionPhoneticText}
              coachText={aiPartnerDisplayText}
              coachSourceText={aiPartnerLastReply}
              coachTranslatedText={aiPartnerLastTranslatedReply}
              coachFeedbackSourceText={aiPartnerFeedbackSource}
              coachFeedbackFrenchText={aiPartnerFeedbackFrench}
              coachFeedback={aiPartnerFeedbackDisplay}
              coachHelpView={aiPartnerFeedbackView}
              coachHelpFrenchBusy={aiPartnerFeedbackFrenchBusy}
              canShowCoachHelpTarget={aiPartnerFeedbackHasTargetVariant}
              canShowCoachHelpSource={aiPartnerFeedbackHasSource}
              coachBusy={aiPartnerBusy}
              canToggleView={aiPartnerCanToggleView}
              view={aiPartnerView}
              avatarTheme={aiPartnerAvatarTheme}
              coachPhoneticText={aiPartnerCoachPhoneticText}
              coachPhoneticBusy={aiPartnerCoachPhoneticBusy}
              realtimeVoice={realtimeVoice}
              pushToTalkActive={pushToTalkActive}
              pushToTalkBusy={pushToTalkBusy}
              pushToTalkDisabled={
                translationControlsDisabled ||
                !captionsSupported ||
                !pushToTalkSupported ||
                realtimeEnabled ||
                isTalkieLockedByOther
              }
              pushToTalkDraftVisible={Boolean(pushToTalkDraft)}
              onReplayUserTranslation={replayAiPartnerUserTranslation}
              onReplayCoach={replayAiPartnerCoach}
              onPushToTalkPointerDown={handlePushToTalkPointerDown}
              onPushToTalkPointerMove={handlePushToTalkPointerMove}
              onPushToTalkPointerEnd={handlePushToTalkPointerEnd}
              onPushToTalkStart={startPushToTalkRecognition}
              onChangeSourceLanguage={onChangeSourceLanguage}
              respondInTrainingLanguage={respondInTrainingLanguage}
              onChangeRespondInTrainingLanguage={onChangeRespondInTrainingLanguage}
              trainingTarget={localReceptionTarget}
              onChangeTrainingTarget={handleLocalReceptionTargetChange}
              onSetCoachHelpView={setAiPartnerFeedbackView}
              onEnsureCoachHelpFrench={ensureAiPartnerFeedbackFrench}
              onToggleView={setAiPartnerView}
            />
          ) : isIPhone ? (
            <div className="lk-focus-layout-wrapper">
              <div className="bf-iphone-layout relative" onClick={(event) => event.stopPropagation()}>
                {languageOverlay}
                <div className="bf-iphone-focus">
                  {resolvedIphoneFocus && <ParticipantTile trackRef={resolvedIphoneFocus} />}
                </div>
                <div className="bf-iphone-strip">
                  {iphoneCameraTracks
                    .filter((track) =>
                      resolvedIphoneFocus ? !isEqualTrackRef(track, resolvedIphoneFocus) : true
                    )
                    .map((track) => (
                      <button
                        key={
                          isTrackReference(track)
                            ? track.publication.trackSid
                            : track.participant.identity
                        }
                        type="button"
                        className="bf-iphone-thumb"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleTrackSelect(track);
                        }}
                      >
                        <ParticipantTile trackRef={track} />
                      </button>
                    ))}
                </div>
                {pushToTalkOverlay}
              </div>
            </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
                <FocusLayoutContainer className={focusLayoutClass}>
                {(screenShareTracks.length === 0 || galleryVisible) && (
                  <CarouselLayout
                    tracks={carouselTracks}
                    orientation={isMobile ? "horizontal" : "vertical"}
                  >
                    <ClickableParticipantTile onSelect={handleTrackSelect} />
                  </CarouselLayout>
                )}
              {focusTrack ? (
                <div
                    key={
                      isTrackReference(focusTrack)
                        ? focusTrack.publication.trackSid
                        : focusTrack.participant.identity
                    }
                    role="button"
                    tabIndex={0}
                    className="lk-focus-click-area"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (screenShareTracks.length > 0) return;
                      manualPinRef.current = false;
                      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (screenShareTracks.length > 0) return;
                        manualPinRef.current = false;
                        layoutContext.pin.dispatch?.({ msg: "clear_pin" });
                      }
                    }}
                  >
                    <FocusLayout trackRef={focusTrack} />
                    {screenShareTracks.length > 0 && (
                      <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-3">
                        <span className="rounded-full bg-slate-900/80 px-3 py-1 text-[10px] text-white">
                          {ui.screenShareInProgress(
                            screenShareTracks[0]?.publication?.trackName
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}
              </FocusLayoutContainer>
              {screenShareTracks.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-4">
                  <div className="pointer-events-auto rounded-full bg-slate-900/80 px-3 py-2 text-[11px] text-white">
                    {ui.screenShareInProgress(
                      screenShareTracks[0]?.publication?.trackName
                    )}
                    <button
                      onClick={() => setGalleryVisible((value) => !value)}
                      className="ml-3 rounded-full border border-slate-500/60 bg-slate-900/60 px-2 py-1 text-[10px] text-slate-200"
                      type="button"
                    >
                      {galleryVisible ? ui.hideGallery : ui.showGallery}
                    </button>
                  </div>
                </div>
              )}
              {screenShareTracks.length > 0 && isScreenSharing && (
                <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-6">
                  <button
                    onClick={() => {
                      if (confirm(ui.stopShareConfirm)) {
                        handleToggleScreenShare();
                      }
                    }}
                    className="pointer-events-auto rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
                  >
                    {ui.stopSharing}
                  </button>
                </div>
              )}
              {languageOverlay}
              {pushToTalkOverlay}
            </div>
          )}
          <div
            className={controlsHidden ? "hidden" : "relative z-20"}
            onClick={(event) => event.stopPropagation()}
          >
            {!aiTrainingAutoStart && (
            <div className="lk-control-bar flex items-center justify-between gap-2 border-0! bg-transparent! p-2! sm:p-3!">
              <div className="flex items-center gap-2">
                {isHost && !aiTrainingAutoStart && (
                  <button
                    onClick={() => setInviteOpen(true)}
                    className="lk-button"
                    aria-label={ui.shareAria}
                  >
                    <Share2 className="h-4 w-4" />
                    <span className="hidden sm:inline">{ui.share}</span>
                  </button>
                )}
                {isHost && !aiTrainingAutoStart && inviteCopied && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                    {getInviteCopiedLabel(inviteCopied, locale)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2">
                <TrackToggle
                  source={Track.Source.Microphone}
                  showIcon={false}
                  disabled={isHost && !shareMicToGuests}
                >
                  {isMicrophoneEnabled ? (
                    <Mic className="h-4 w-4 text-slate-100" />
                  ) : (
                    <MicOff className="h-4 w-4 text-red-300" />
                  )}
                  <span className="hidden text-slate-100 sm:inline">{ui.microphone}</span>
                </TrackToggle>
                <button
                  type="button"
                  onClick={toggleCamera}
                  disabled={isTogglingCamera}
                  className="lk-button"
                  aria-label={isCameraEnabled ? ui.disableCameraAria : ui.enableCameraAria}
                >
                  {isCameraEnabled ? (
                    <Camera className="h-4 w-4 text-slate-100" />
                  ) : (
                    <CameraOff className="h-4 w-4 text-red-300" />
                  )}
                  <span className="hidden text-slate-100 sm:inline">
                    {isTogglingCamera ? ui.cameraBusy : ui.camera}
                  </span>
                </button>
                {isMobile && (
                  <button
                    onClick={flipCamera}
                    className="lk-button"
                    disabled={!isCameraEnabled || isFlippingCamera}
                    aria-label={ui.flipCameraAria}
                  >
                    <SwitchCamera className="h-4 w-4 text-slate-100" />
                    <span className="hidden text-slate-100 sm:inline">{ui.flip}</span>
                  </button>
                )}
                <button
                  onClick={handleToggleScreenShare}
                  className={`lk-button ${isScreenSharing ? "bg-sky-600" : ""}`}
                >
                  <ScreenShare className="h-4 w-4 text-slate-100" />
                  <span className="hidden text-slate-100 sm:inline">{ui.screen}</span>
                </button>
                <ChatToggle>
                  <MessageCircle className="h-4 w-4 text-slate-100" />
                  <span className="hidden text-slate-100 sm:inline">{ui.chat}</span>
                </ChatToggle>
                <button onClick={onOpenSettings} className="lk-button">
                  <Settings className="h-4 w-4 text-slate-100" />
                  <span className="hidden text-slate-100 sm:inline">{ui.settings}</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {isHost && !aiTrainingAutoStart && (
                  <button
                    type="button"
                    onClick={handleEndRoomForAll}
                    disabled={endingRoomForAll}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold shadow-md transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      backgroundColor: "rgba(190, 24, 93, 0.95)",
                      color: "#ffffff",
                      borderColor: "rgba(253, 164, 175, 0.95)",
                    }}
                  >
                    <Power className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {endingRoomForAll ? ui.ending : ui.endForAll}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="lk-disconnect-button bg-rose-600/90! text-white! hover:bg-rose-600!"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">{ui.leave}</span>
                </button>
              </div>
            </div>
            )}
            {captionsEnabled && (
              <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Coach conversation IA et info-bulle masqués en visio classique */}
                {/* Bloc-notes masqué en visio conférence */}
                {!aiTrainingAutoStart && (
                  <div className="inline-flex items-center">
                    <InfoBubble
                      text={ui.talkieInfo}
                      label="Info talkie traduction"
                      align="left"
                    />
                  </div>
                )}
              </div>
              {pushToTalkInterruptHint && captionsEnabled && (
                <div
                  className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                  style={{
                    backgroundColor: "rgba(7, 89, 133, 0.96)",
                    color: "#e0f2fe",
                    borderColor: "rgba(56, 189, 248, 0.85)",
                  }}
                >
                  {pushToTalkInterruptHint}
                </div>
              )}
              {isTalkieLockedByOther && !pushToTalkActive && !pushToTalkBusy && captionsEnabled && (
                <div
                  className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                  style={{
                    backgroundColor: "rgba(51, 65, 85, 0.96)",
                    color: "#e2e8f0",
                    borderColor: "rgba(148, 163, 184, 0.85)",
                  }}
                >
                  {talkieLockedMessage}
                </div>
              )}
              {pushToTalkGestureHint && pushToTalkActive && (
                <div
                  className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                  style={{
                    backgroundColor: "rgba(67, 20, 7, 0.96)",
                    color: "#ffedd5",
                    borderColor: "rgba(251, 146, 60, 0.9)",
                  }}
                >
                  {pushToTalkGestureHint}
                </div>
              )}
              {pushToTalkDraft && (
                <PushToTalkDraftModal
                  draftText={pushToTalkDraftText}
                  editing={pushToTalkDraftEditing}
                  review={pushToTalkDraftReview}
                  reviewBusy={pushToTalkDraftReviewBusy}
                  reviewMode={pushToTalkDraftReviewMode}
                  showAutoSendHint={pushToTalkDraftAutoSendEnabled}
                  notebookEnabled={aiPartnerActive && activeSpeechLanguageCode === localReceptionTarget}
                  notebookBaseText={pushToTalkDraftReview?.reviewedText || pushToTalkDraftText}
                  notebookRoomId={roomId}
                  notebookTargetLanguageCode={activeSpeechLanguageCode}
                  notebookTargetLanguageName={activeSpeechLanguageName}
                  notebookVoice={realtimeVoice}
                  onChangeText={handlePushToTalkDraftTextChange}
                  onSubmit={() => void submitPushToTalkDraft()}
                  onEdit={setPushToTalkDraftEditMode}
                  onCancel={() => cancelPushToTalkDraft("Capture annulee.")}
                  onApplySuggestion={applyPushToTalkDraftSuggestion}
                />
              )}
              {!aiTrainingAutoStart && (
                <div
                  className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                  style={{
                    backgroundColor: "rgba(15, 23, 42, 0.96)",
                    color: "#f8fafc",
                    borderColor: "rgba(56, 189, 248, 0.85)",
                  }}
                >
                  {isChatSession
                    ? ui.translationRemaining
                    : ui.translationRemainingHost}
                  {translationRemainingLabel}
                </div>
              )}
              </>
            )}
            {!effectiveTranslationEnabled && captionsEnabled && (
              <div
                className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                style={{
                  backgroundColor: "rgba(120, 53, 15, 0.96)",
                  color: "#fef3c7",
                  borderColor: "rgba(251, 191, 36, 0.9)",
                }}
              >
                <div>{translationUnavailableMessage}</div>
                {translationController ? (
                  <button
                    type="button"
                    onClick={openCreditsTopUpFromCall}
                    className="mt-2 inline-flex items-center rounded-full border border-amber-200/70 bg-amber-100/12 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-50 transition hover:bg-amber-100/20"
                  >
                    {ui.topUpNow}
                  </button>
                ) : (
                  <div className="mt-2 text-[10px] font-semibold text-amber-100/90">
                    {ui.askHostToTopUp}
                  </div>
                )}
              </div>
            )}
            {endRoomError && (
              <div className="mt-2 rounded-lg border border-rose-400/70 bg-rose-950/80 px-3 py-2 text-[11px] font-medium text-rose-100 shadow-sm">
                Fin de reunion: {endRoomError}
              </div>
            )}
            {mediaError && (
              <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                <div className="flex items-center justify-between gap-2">
                  <span>Micro/camera: {mediaError}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={retryMicrophone}
                      className="rounded-md border border-rose-400/60 px-2 py-1 text-[11px] text-rose-100"
                    >
                      Debloquer micro
                    </button>
                    <button
                      onClick={toggleCamera}
                      disabled={isTogglingCamera}
                      className="rounded-md border border-rose-400/60 px-2 py-1 text-[11px] text-rose-100 disabled:opacity-60"
                    >
                      {isTogglingCamera ? "Camera..." : "Debloquer camera"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {screenShareError && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Ecran: {screenShareError}
              </div>
            )}
            {captionError && captionsEnabled && (
              <div
                className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-medium shadow-sm"
                style={{
                  backgroundColor: "rgba(120, 53, 15, 0.96)",
                  color: "#fef3c7",
                  borderColor: "rgba(251, 191, 36, 0.85)",
                }}
              >
                Sous-titres: {captionError}
              </div>
            )}
          </div>
        </div>
        <ChatDrawer
          roomId={roomId}
          isOpen={widgetState.showChat}
          onClose={() => layoutContext.widget.dispatch?.({ msg: "hide_chat" })}
          unreadCount={roomChat.unreadCount}
          messages={roomChat.messages}
          onSendMessage={roomChat.sendMessage}
          isSending={roomChat.isSending}
          translationEnabled={effectiveTranslationEnabled}
          translationLockMessage={effectiveTranslationLockMessage}
          onConsumeTranslationSeconds={onConsumeTranslationSeconds}
          onUnreadChange={(count) => roomChat.setUnreadCount(count)}
        />
        {!aiTrainingAutoStart && (
          <InviteDrawer
            isOpen={inviteOpen}
            onClose={() => setInviteOpen(false)}
            inviteLinks={inviteLinks}
            onShare={shareInvite}
            onCopy={copyInvite}
            copied={inviteCopied}
          />
        )}
      </LayoutContextProvider>
      <ConnectionStateToast />
    </div>
  );
}

function AiPartnerAvatarStage({
  roomId,
  sourceLanguageCode,
  sourceLanguageName,
  spokenLanguageCode,
  spokenLanguageName,
  targetLanguageName,
  sourceText,
  userTranslatedText,
  userPhoneticText,
  coachText,
  coachSourceText,
  coachTranslatedText,
  coachFeedbackSourceText,
  coachFeedbackFrenchText,
  coachFeedback,
  coachHelpView,
  coachHelpFrenchBusy,
  canShowCoachHelpTarget,
  canShowCoachHelpSource,
  coachBusy,
  canToggleView,
  view,
  avatarTheme,
  coachPhoneticText,
  coachPhoneticBusy,
  realtimeVoice,
  pushToTalkActive,
  pushToTalkBusy,
  pushToTalkDisabled,
  pushToTalkDraftVisible,
  onReplayUserTranslation,
  onReplayCoach,
  onPushToTalkPointerDown,
  onPushToTalkPointerMove,
  onPushToTalkPointerEnd,
  onPushToTalkStart,
  onChangeSourceLanguage,
  respondInTrainingLanguage,
  onChangeRespondInTrainingLanguage,
  trainingTarget,
  onChangeTrainingTarget,
  onSetCoachHelpView,
  onEnsureCoachHelpFrench,
  onToggleView,
}: {
  roomId: string;
  sourceLanguageCode: SourceLanguageOption["code"];
  sourceLanguageName: string;
  spokenLanguageCode: string;
  spokenLanguageName: string;
  targetLanguageName: string;
  sourceText: string;
  userTranslatedText: string;
  userPhoneticText: string;
  coachText: string;
  coachSourceText: string;
  coachTranslatedText: string;
  coachFeedbackSourceText: string;
  coachFeedbackFrenchText: string;
  coachFeedback: string;
  coachHelpView: AiPartnerFeedbackView;
  coachHelpFrenchBusy: boolean;
  canShowCoachHelpTarget: boolean;
  canShowCoachHelpSource: boolean;
  coachBusy: boolean;
  canToggleView: boolean;
  view: "translation" | "source";
  avatarTheme: AiPartnerAvatarTheme;
  coachPhoneticText: string;
  coachPhoneticBusy: boolean;
  realtimeVoice: string;
  pushToTalkActive: boolean;
  pushToTalkBusy: boolean;
  pushToTalkDisabled: boolean;
  pushToTalkDraftVisible: boolean;
  onReplayUserTranslation: (text?: string, target?: CaptionTarget) => void;
  onReplayCoach: (textOverride?: string, targetOverride?: CaptionTarget) => void;
  onPushToTalkPointerDown: (event: any) => void;
  onPushToTalkPointerMove: (event: any) => void;
  onPushToTalkPointerEnd: (event?: any, forcedCancel?: boolean) => void;
  onPushToTalkStart: () => void;
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  respondInTrainingLanguage: boolean;
  onChangeRespondInTrainingLanguage: (next: boolean) => void;
  trainingTarget: CaptionTarget;
  onChangeTrainingTarget: (target: CaptionTarget) => void;
  onSetCoachHelpView: (next: AiPartnerFeedbackView) => void;
  onEnsureCoachHelpFrench: () => void;
  onToggleView: (next: "translation" | "source") => void;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const isFr = locale === "fr";
  const hasSource = sourceText.trim().length > 0;
  const hasUserTranslation = userTranslatedText.trim().length > 0;
  const hasCoach = coachText.trim().length > 0;
  const boxingTheme = avatarTheme === "boxing";
  const stageBackground = boxingTheme
    ? "radial-gradient(120% 120% at 10% 0%, rgba(190, 24, 93, 0.22), rgba(2, 6, 23, 0.95) 42%), linear-gradient(155deg, rgba(2, 6, 23, 0.97), rgba(69, 10, 10, 0.92))"
    : "radial-gradient(120% 120% at 10% 0%, rgba(14, 116, 144, 0.25), rgba(2, 6, 23, 0.95) 42%), linear-gradient(155deg, rgba(2, 6, 23, 0.97), rgba(15, 23, 42, 0.95))";
  const stageBorderColor = boxingTheme ? "rgba(251, 113, 133, 0.5)" : "rgba(56, 189, 248, 0.45)";
  const coachTitle = boxingTheme
    ? isFr
      ? "Coach IA (Boxe)"
      : "AI Coach (Boxing)"
    : isFr
    ? AI_PARTNER_NAME
    : "AI Partner";
  const coachSubtitle = coachBusy
    ? isFr
      ? "Analyse en cours..."
      : "Thinking..."
    : isFr
    ? `Reponse en ${targetLanguageName}`
    : `Reply in ${targetLanguageName}`;
  const baseLanguageLabel = isFr ? "Langue de base" : "Base language";
  const targetLanguageLabel = isFr ? "Langue a travailler" : "Target language";
  const workLanguageLine = isFr
    ? `Langue de travail: ${targetLanguageName} (traduction de l'echange).`
    : `Practice language: ${targetLanguageName} (translated exchange).`;
  const quickTranslationLabel = isFr ? "Traduction rapide" : "Quick translation";
  const translateLabel = isFr ? "Traduire" : "Translate";
  const playTranslationLabel = isFr ? "Lire la traduction" : "Play translation";
  const phoneticLabel = isFr ? "Phonetique" : "Phonetic";
  const userCardTitle = isFr ? "Utilisateur" : "User";
  const userMicLabel = isFr ? `Micro en ${spokenLanguageName}` : `Mic in ${spokenLanguageName}`;
  const userSectionTitle = isFr
    ? `Ce que tu dis (${spokenLanguageName})`
    : `What you say (${spokenLanguageName})`;
  const holdToTalkHint = isFr
    ? 'Maintiens "Maintenir pour parler" pour envoyer ta phrase.'
    : 'Hold "Hold to talk" to send your sentence.';
  const formatUserTranslationLine = (text: string) =>
    isFr ? `Traduction de ta phrase: ${text}` : `Translation of your sentence: ${text}`;
  const directReplyLabel = isFr
    ? `Je réponds directement en ${targetLanguageName}`
    : `I reply directly in ${targetLanguageName}`;
  const micTranscriptionLine = isFr
    ? `Base conservée: ${sourceLanguageName}. Le micro sera transcrit en ${
        respondInTrainingLanguage ? targetLanguageName : sourceLanguageName
      }.`
    : `Base kept: ${sourceLanguageName}. The microphone will be transcribed in ${
        respondInTrainingLanguage ? targetLanguageName : sourceLanguageName
      }.`;
  const coachHelpHiddenLabel = isFr
    ? "Aide coach masquée pendant la vérification du texte capté."
    : "Coach help is hidden while the captured text is being reviewed.";
  const coachHelpTitle = isFr ? "Aide pour repondre" : "Reply help";
  const receptionLabel = isFr ? "Reception" : "Target";
  const frenchLabel = isFr ? "Francais" : "French";
  const coachReplyTitle = isFr ? "Réponse Coach IA" : "AI coach reply";
  const coachReplyPlaceholder = isFr
    ? "Le coach IA repondra ici."
    : "The AI coach will answer here.";
  const playCoachLabel = isFr ? "Lire" : "Play";
  const notebookSimpleLabel = isFr
    ? `Ajouter au carnet (${formatNotebookChargeMinutes(AI_PRACTICE_NOTEBOOK_SIMPLE_SECONDS)})`
    : `Add to notebook (${formatNotebookChargeMinutes(AI_PRACTICE_NOTEBOOK_SIMPLE_SECONDS)})`;
  const notebookEnrichedLabel = isFr
    ? `Ajouter au carnet enrichi (${formatNotebookChargeMinutes(AI_PRACTICE_NOTEBOOK_ENRICHED_SECONDS)})`
    : `Add enriched note (${formatNotebookChargeMinutes(AI_PRACTICE_NOTEBOOK_ENRICHED_SECONDS)})`;
  const quickTranslationOptions = useMemo(
    () => CAPTION_TARGETS_CONFIG.filter((option) => option.code !== trainingTarget),
    [trainingTarget]
  );
  const resolvePreferredQuickTarget = useCallback(
    (preferred: CaptionTarget): CaptionTarget => {
      if (quickTranslationOptions.some((option) => option.code === preferred)) {
        return preferred;
      }
      return ((
        quickTranslationOptions.find((option) => option.code === "fr")?.code ||
        quickTranslationOptions[0]?.code ||
        "en"
      ) as CaptionTarget);
    },
    [quickTranslationOptions]
  );
  const [userQuickTargetCode, setUserQuickTargetCode] = useState<CaptionTarget>("fr");
  const [userQuickActive, setUserQuickActive] = useState(false);
  const [userQuickTranslations, setUserQuickTranslations] = useState<Record<string, string>>({});
  const [userQuickBusyCode, setUserQuickBusyCode] = useState<CaptionTarget | null>(null);
  const [userQuickError, setUserQuickError] = useState("");
  const userQuickRequestRef = useRef(0);
  const userBaseText = userTranslatedText.trim();
  const [coachQuickTargetCode, setCoachQuickTargetCode] = useState<CaptionTarget>("fr");
  const [coachQuickActive, setCoachQuickActive] = useState(false);
  const [coachQuickTranslations, setCoachQuickTranslations] = useState<Record<string, string>>({});
  const [coachQuickBusyCode, setCoachQuickBusyCode] = useState<CaptionTarget | null>(null);
  const [coachQuickError, setCoachQuickError] = useState("");
  const coachQuickRequestRef = useRef(0);
  const coachTranslationSource = useMemo(() => {
    const sourceText = coachSourceText.trim();
    if (sourceText) {
      return {
        text: sourceText,
        fromCode: spokenLanguageCode,
        fromName: spokenLanguageName,
      };
    }
    return {
      text: coachText.trim(),
      fromCode: trainingTarget,
      fromName: targetLanguageName,
    };
  }, [
    coachSourceText,
    coachText,
    spokenLanguageCode,
    spokenLanguageName,
    trainingTarget,
    targetLanguageName,
  ]);

  useEffect(() => {
    userQuickRequestRef.current += 1;
    setUserQuickTargetCode((current) => resolvePreferredQuickTarget(current));
    setUserQuickActive(false);
    setUserQuickTranslations({});
    setUserQuickBusyCode(null);
    setUserQuickError("");
  }, [resolvePreferredQuickTarget, userTranslatedText]);

  const requestUserQuickTranslation = useCallback(
    async (targetCode: CaptionTarget) => {
      const baseText = userBaseText.trim();
      if (!baseText) return;
      const targetConfig = CAPTION_TARGETS_CONFIG.find((option) => option.code === targetCode);
      if (!targetConfig) return;
      const requestId = userQuickRequestRef.current + 1;
      userQuickRequestRef.current = requestId;
      setUserQuickBusyCode(targetCode);
      setUserQuickError("");
      try {
        const translated = await translateWithOpenAi(
          baseText,
          targetLanguageName,
          targetConfig.name,
          {
            fromCode: trainingTarget,
            toCode: targetConfig.code,
            intent: "translation",
          }
        );
        if (requestId !== userQuickRequestRef.current) return;
        const cleaned = translated.trim();
        if (cleaned) {
          setUserQuickTranslations((previous) => ({ ...previous, [targetCode]: cleaned }));
        }
      } catch (err) {
        if (requestId !== userQuickRequestRef.current) return;
        const message = err instanceof Error ? err.message : "Traduction indisponible.";
        setUserQuickError(
          `${
            isFr ? "Traduction" : "Translation"
          } ${targetConfig.name} ${isFr ? "indisponible" : "unavailable"}: ${toFriendlyAiError(message)}`
        );
      } finally {
        if (requestId === userQuickRequestRef.current) {
          setUserQuickBusyCode((previous) => (previous === targetCode ? null : previous));
        }
      }
    },
    [isFr, trainingTarget, targetLanguageName, userBaseText]
  );

  const onSelectUserQuickTarget = useCallback(
    (targetCode: CaptionTarget) => {
      const normalizedTarget = resolvePreferredQuickTarget(targetCode);
      setUserQuickTargetCode(normalizedTarget);
      setUserQuickActive(true);
      setUserQuickError("");
      if ((userQuickTranslations[normalizedTarget] || "").trim().length > 0) return;
      void requestUserQuickTranslation(normalizedTarget);
    },
    [requestUserQuickTranslation, resolvePreferredQuickTarget, userQuickTranslations]
  );

  const onSelectUserQuickOriginal = useCallback(() => {
    setUserQuickActive(false);
    setUserQuickError("");
  }, []);

  const userQuickTargetLabel = useMemo(
    () =>
      CAPTION_TARGETS_CONFIG.find((option) => option.code === userQuickTargetCode)?.name ||
      userQuickTargetCode,
    [userQuickTargetCode]
  );

  const userDisplayText =
    !userQuickActive
      ? userTranslatedText
      : userQuickBusyCode === userQuickTargetCode &&
        !(userQuickTranslations[userQuickTargetCode] || "").trim()
      ? `${
          isFr ? "Traduction" : "Translation"
        } ${userQuickTargetLabel} ${isFr ? "en cours..." : "in progress..."}`
      : (userQuickTranslations[userQuickTargetCode] || "").trim() || userTranslatedText;

  useEffect(() => {
    coachQuickRequestRef.current += 1;
    setCoachQuickTargetCode((current) => resolvePreferredQuickTarget(current));
    setCoachQuickActive(false);
    setCoachQuickTranslations({});
    setCoachQuickBusyCode(null);
    setCoachQuickError("");
  }, [coachSourceText, coachText, resolvePreferredQuickTarget]);

  const requestCoachQuickTranslation = useCallback(
    async (targetCode: CaptionTarget) => {
      const baseText = coachTranslationSource.text.trim();
      if (!baseText) return;
      const targetConfig = CAPTION_TARGETS_CONFIG.find((option) => option.code === targetCode);
      if (!targetConfig) return;
      const requestId = coachQuickRequestRef.current + 1;
      coachQuickRequestRef.current = requestId;
      setCoachQuickBusyCode(targetCode);
      setCoachQuickError("");
      try {
        const translated = await translateWithOpenAi(
          baseText,
          coachTranslationSource.fromName,
          targetConfig.name,
          {
            fromCode: coachTranslationSource.fromCode,
            toCode: targetConfig.code,
            intent: "translation",
          }
        );
        if (requestId !== coachQuickRequestRef.current) return;
        const cleaned = translated.trim();
        if (cleaned) {
          setCoachQuickTranslations((previous) => ({ ...previous, [targetCode]: cleaned }));
        }
      } catch (err) {
        if (requestId !== coachQuickRequestRef.current) return;
        const message = err instanceof Error ? err.message : "Traduction indisponible.";
        setCoachQuickError(
          `${
            isFr ? "Traduction" : "Translation"
          } ${targetConfig.name} ${isFr ? "indisponible" : "unavailable"}: ${toFriendlyAiError(message)}`
        );
      } finally {
        if (requestId === coachQuickRequestRef.current) {
          setCoachQuickBusyCode((previous) => (previous === targetCode ? null : previous));
        }
      }
    },
    [coachTranslationSource, isFr]
  );

  const onSelectCoachQuickTarget = useCallback(
    (targetCode: CaptionTarget) => {
      const normalizedTarget = resolvePreferredQuickTarget(targetCode);
      setCoachQuickTargetCode(normalizedTarget);
      setCoachQuickActive(true);
      setCoachQuickError("");
      if ((coachQuickTranslations[normalizedTarget] || "").trim().length > 0) return;
      void requestCoachQuickTranslation(normalizedTarget);
    },
    [coachQuickTranslations, requestCoachQuickTranslation, resolvePreferredQuickTarget]
  );

  const onSelectCoachQuickOriginal = useCallback(() => {
    setCoachQuickActive(false);
    setCoachQuickError("");
  }, []);

  const coachQuickTargetLabel = useMemo(
    () =>
      CAPTION_TARGETS_CONFIG.find((option) => option.code === coachQuickTargetCode)?.name ||
      coachQuickTargetCode,
    [coachQuickTargetCode]
  );

  const coachDisplayText =
    !coachQuickActive
      ? coachText
      : coachQuickBusyCode === coachQuickTargetCode &&
        !(coachQuickTranslations[coachQuickTargetCode] || "").trim()
      ? `${
          isFr ? "Traduction" : "Translation"
        } ${coachQuickTargetLabel} ${isFr ? "en cours..." : "in progress..."}`
      : (coachQuickTranslations[coachQuickTargetCode] || "").trim() || coachText;
  const coachHelpDisplayLanguageCode =
    coachHelpView === "target"
      ? trainingTarget
      : coachHelpView === "source"
      ? spokenLanguageCode
      : "fr";
  const coachHelpDisplayLanguageName =
    coachHelpView === "target"
      ? targetLanguageName
      : coachHelpView === "source"
      ? spokenLanguageName
      : frenchLabel;
  const coachHelpPlaybackTarget = useMemo<CaptionTarget | undefined>(() => {
    return CAPTION_TARGETS_CONFIG.some(
      (target) => target.code === coachHelpDisplayLanguageCode
    )
      ? (coachHelpDisplayLanguageCode as CaptionTarget)
      : undefined;
  }, [coachHelpDisplayLanguageCode]);
  const coachFeedbackLines = useMemo(() => parseCoachFeedbackLines(coachFeedback), [coachFeedback]);
  const coachFeedbackSourceLines = useMemo(
    () => parseCoachFeedbackLines(coachFeedbackSourceText),
    [coachFeedbackSourceText]
  );
  const coachFeedbackFrenchLines = useMemo(
    () => parseCoachFeedbackLines(coachFeedbackFrenchText),
    [coachFeedbackFrenchText]
  );
  const coachFeedbackBaseSuggestionByIndex = useMemo(() => {
    const preferredLines =
      sourceLanguageCode === spokenLanguageCode
        ? coachFeedbackSourceLines
        : sourceLanguageCode === "fr"
        ? coachFeedbackFrenchLines
        : coachFeedbackSourceLines.length > 0
        ? coachFeedbackSourceLines
        : coachFeedbackFrenchLines;

    return preferredLines.map((line) => line.suggestionText.trim());
  }, [
    coachFeedbackFrenchLines,
    coachFeedbackSourceLines,
    sourceLanguageCode,
    spokenLanguageCode,
  ]);
  const coachFeedbackSuggestionLines = useMemo(
    () =>
      coachFeedbackLines.filter(
        (line) => line.phoneticId && line.suggestionText
      ),
    [coachFeedbackLines]
  );
  const coachFeedbackPhoneticCacheRef = useRef<Map<string, string>>(new Map());
  const [coachFeedbackSuggestionPhonetics, setCoachFeedbackSuggestionPhonetics] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    let cancelled = false;
    setCoachFeedbackSuggestionPhonetics({});
    if (!shouldShowPhoneticAidForLanguage(coachHelpDisplayLanguageCode)) return;
    if (coachFeedbackSuggestionLines.length === 0) return;

    const loadPhonetics = async () => {
      const missingLines: Array<{ phoneticId: string; suggestionText: string; cacheKey: string }> = [];
      for (const line of coachFeedbackSuggestionLines) {
        const cacheKey = `${coachHelpDisplayLanguageCode}:${line.suggestionText}`;
        const cached = coachFeedbackPhoneticCacheRef.current.get(cacheKey);
        if (typeof cached === "string") {
          if (cached) {
            setCoachFeedbackSuggestionPhonetics((previous) =>
              previous[line.phoneticId]
                ? previous
                : { ...previous, [line.phoneticId]: cached }
            );
          }
          continue;
        }
        missingLines.push({
          phoneticId: line.phoneticId,
          suggestionText: line.suggestionText,
          cacheKey,
        });
      }

      if (missingLines.length === 0) return;

      try {
        const phoneticsByText = await phoneticBatchWithOpenAi(
          missingLines.map((line) => line.suggestionText),
          coachHelpDisplayLanguageName,
          { targetCode: coachHelpDisplayLanguageCode }
        );
        if (cancelled) return;

        for (const line of missingLines) {
          const cleaned = String(phoneticsByText.get(line.suggestionText) || "").trim();
          const sourceNormalized = line.suggestionText
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const phoneticNormalized = cleaned
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const finalPhonetic =
            cleaned && phoneticNormalized !== sourceNormalized ? cleaned : "";
          coachFeedbackPhoneticCacheRef.current.set(line.cacheKey, finalPhonetic);
          if (!finalPhonetic) continue;
          setCoachFeedbackSuggestionPhonetics((previous) => ({
            ...previous,
            [line.phoneticId]: finalPhonetic,
          }));
        }
      } catch {
        if (cancelled) return;
        for (const line of missingLines) {
          coachFeedbackPhoneticCacheRef.current.set(line.cacheKey, "");
        }
      }
    };

    void loadPhonetics();
    return () => {
      cancelled = true;
    };
  }, [
    coachFeedbackSuggestionLines,
    coachHelpDisplayLanguageCode,
    coachHelpDisplayLanguageName,
  ]);
  const userNotebookPayload: AiPracticeNotebookSaveInput | null =
    hasSource && hasUserTranslation
      ? {
          kind: "user_translation",
          mode: "enriched",
          baseText: sourceText.trim(),
          targetText: userTranslatedText.trim(),
          baseLanguageCode: spokenLanguageCode,
          baseLanguageName: spokenLanguageName,
          targetLanguageCode: trainingTarget,
          targetLanguageName,
          phoneticText: userPhoneticText.trim(),
          contextLabel: "Traduction perso",
          roomId,
          voice: realtimeVoice,
        }
      : null;
  const coachNotebookBaseText =
    coachSourceText.trim() &&
    normalizeComparableText(coachSourceText) !== normalizeComparableText(coachText)
      ? coachSourceText.trim()
      : coachTranslatedText.trim() &&
          normalizeComparableText(coachTranslatedText) !== normalizeComparableText(coachText)
        ? coachTranslatedText.trim()
        : "";
  const canSaveCoachReply = hasCoach && (!canToggleView || view === "translation");
  const coachNotebookPayload: AiPracticeNotebookSaveInput | null =
    canSaveCoachReply && coachText.trim()
      ? {
          kind: "coach_reply",
          mode: "enriched",
          baseText: coachNotebookBaseText,
          targetText: coachText.trim(),
          baseLanguageCode: spokenLanguageCode,
          baseLanguageName: spokenLanguageName,
          targetLanguageCode: trainingTarget,
          targetLanguageName,
          phoneticText: coachPhoneticText.trim(),
          contextLabel: "Reponse coach",
          roomId,
          voice: realtimeVoice,
        }
      : null;

  return (
    <div className="relative flex h-full w-full items-start justify-center overflow-y-auto">
      <div className="w-full p-3 pb-[calc(var(--lk-control-bar-height)+72px)] sm:p-5 sm:pb-[calc(var(--lk-control-bar-height)+88px)]">
        <div
          className="relative mx-auto flex w-full max-w-6xl rounded-2xl border shadow-2xl"
          style={{
            background: stageBackground,
            borderColor: stageBorderColor,
          }}
        >
          <div className="relative z-10 flex w-full flex-col gap-3 p-4 sm:gap-4 sm:p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div
                className="rounded-xl border bg-slate-900/55 p-3"
                style={{
                  borderColor: boxingTheme ? "rgba(251, 113, 133, 0.35)" : "rgba(125, 211, 252, 0.35)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{
                      backgroundColor: boxingTheme
                        ? "rgba(225, 29, 72, 0.88)"
                        : "rgba(2, 132, 199, 0.88)",
                    }}
                  >
                    {boxingTheme ? "P1" : "TOI"}
                  </span>
                  <div className="min-w-0">
                    <p
                      className="truncate text-[11px] font-semibold"
                      style={{ color: boxingTheme ? "#fecdd3" : "#e0f2fe" }}
                    >
                      {userCardTitle}
                    </p>
                    <p className="truncate text-[9px] text-slate-300">{userMicLabel}</p>
                  </div>
                </div>
              </div>
              <div
                className="rounded-xl border bg-slate-900/55 p-3"
                style={{
                  borderColor: boxingTheme
                    ? "rgba(251, 113, 133, 0.45)"
                    : "rgba(252, 211, 77, 0.45)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{
                      backgroundColor: boxingTheme
                        ? "rgba(220, 38, 38, 0.9)"
                        : "rgba(217, 119, 6, 0.88)",
                    }}
                  >
                    {boxingTheme ? "BX" : "IA"}
                  </span>
                  <div className="min-w-0">
                    <p
                      className="truncate text-[11px] font-semibold"
                      style={{ color: boxingTheme ? "#fecdd3" : "#fef3c7" }}
                    >
                      {coachTitle}
                    </p>
                    <p className="truncate text-[9px] text-slate-300">{coachSubtitle}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-2">
              <div
                className="flex min-h-45 min-w-0 flex-col rounded-xl border bg-slate-950/55 p-3"
                style={{
                  borderColor: boxingTheme ? "rgba(251, 113, 133, 0.38)" : "rgba(125, 211, 252, 0.35)",
                }}
              >
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: boxingTheme ? "#fecdd3" : "#bae6fd" }}
                >
                  {userSectionTitle}
                </p>
                <div className="mt-2 pr-1">
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-100">
                    {hasSource ? sourceText : holdToTalkHint}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wide"
                    style={{ color: boxingTheme ? "#fecdd3" : "#e0f2fe" }}
                    >
                      {baseLanguageLabel}
                    </span>
                  <select
                    value={sourceLanguageCode}
                    onChange={(event) =>
                      onChangeSourceLanguage(event.target.value as SourceLanguageOption["code"])
                    }
                    className="rounded-md border px-2 py-1 text-[10px] font-medium text-slate-100"
                    style={{
                      borderColor: "rgba(125, 211, 252, 0.75)",
                      backgroundColor: "rgba(15, 23, 42, 0.8)",
                    }}
                  >
                    {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {`${option.name} (${option.label})`}
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  className="mt-3 rounded-lg border px-2 py-1.5"
                  style={{
                    borderColor: "rgba(125, 211, 252, 0.65)",
                    backgroundColor: "rgba(14, 116, 144, 0.25)",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wide"
                      style={{ color: "#e0f2fe" }}
                    >
                      {targetLanguageLabel}
                    </span>
                    <select
                      value={trainingTarget}
                      onChange={(event) => onChangeTrainingTarget(event.target.value as CaptionTarget)}
                      className="rounded-md border px-2 py-1 text-[10px] font-medium text-slate-100"
                      style={{
                        borderColor: "rgba(125, 211, 252, 0.8)",
                        backgroundColor: "rgba(15, 23, 42, 0.8)",
                      }}
                    >
                      {CAPTION_TARGETS_CONFIG.map((option) => (
                        <option key={option.code} value={option.code}>
                          {`${option.name} (${option.label})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1 text-[9px]" style={{ color: "#e0f2fe" }}>
                    {workLanguageLine}
                  </p>
                  {hasSource && hasUserTranslation && (
                    <div className="mt-1">
                      <p
                        className="whitespace-pre-wrap text-[11px] font-medium leading-relaxed"
                        style={{ color: "#ffffff" }}
                      >
                        {formatUserTranslationLine(userDisplayText)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-300">
                          {quickTranslationLabel}
                        </span>
                        <button
                          type="button"
                          onClick={onSelectUserQuickOriginal}
                          className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                          style={{
                            color: !userQuickActive ? "#f8fafc" : "#e2e8f0",
                            borderColor:
                              !userQuickActive
                                ? "rgba(74, 222, 128, 0.95)"
                                : "rgba(148, 163, 184, 0.7)",
                            backgroundColor:
                              !userQuickActive
                                ? "rgba(21, 128, 61, 0.34)"
                                : "rgba(15, 23, 42, 0.35)",
                          }}
                        >
                          Original
                        </button>
                        <select
                          value={userQuickTargetCode}
                          onChange={(event) => onSelectUserQuickTarget(event.target.value as CaptionTarget)}
                          disabled={quickTranslationOptions.length === 0}
                          className="rounded-md border px-2 py-1 text-[10px] font-medium text-slate-100 disabled:opacity-60"
                          style={{
                            borderColor: "rgba(125, 211, 252, 0.8)",
                            backgroundColor: "rgba(15, 23, 42, 0.75)",
                          }}
                        >
                          {quickTranslationOptions.map((option) => (
                            <option key={option.code} value={option.code}>
                              {`${option.name} (${option.label})`}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => onSelectUserQuickTarget(userQuickTargetCode)}
                          disabled={quickTranslationOptions.length === 0}
                          className="rounded-full border px-2 py-0.5 text-[9px] font-semibold disabled:opacity-60"
                          style={{
                            color: "#f8fafc",
                            borderColor: "rgba(125, 211, 252, 0.85)",
                            backgroundColor: "rgba(2, 132, 199, 0.35)",
                          }}
                        >
                          {userQuickBusyCode === userQuickTargetCode && userQuickActive
                            ? ui.translating
                            : translateLabel}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onReplayUserTranslation(
                            userDisplayText,
                            userQuickActive ? userQuickTargetCode : trainingTarget
                          )
                        }
                        className="mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold text-slate-100"
                        style={{
                          borderColor: "rgba(125, 211, 252, 0.85)",
                          backgroundColor: "rgba(2, 132, 199, 0.22)",
                        }}
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        {playTranslationLabel}
                      </button>
                      {userQuickError && (
                        <p className="mt-1 text-[10px] text-amber-200">{userQuickError}</p>
                      )}
                      {userPhoneticText.trim().length > 0 && (
                        <p
                          className="mt-1 rounded-lg border px-2 py-1 text-[10px] font-medium"
                          style={{
                            borderColor: "rgba(221, 214, 254, 0.9)",
                            backgroundColor: "rgba(91, 33, 182, 0.45)",
                            color: "#ffffff",
                          }}
                        >
                          {phoneticLabel}: {userPhoneticText}
                        </p>
                      )}
                      <AiPracticeNotebookSaveButton
                        payload={userNotebookPayload}
                        label={notebookEnrichedLabel}
                        className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/8 px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-white/12 disabled:opacity-60"
                      />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onPointerDown={onPushToTalkPointerDown}
                  onPointerMove={onPushToTalkPointerMove}
                  onPointerUp={onPushToTalkPointerEnd}
                  onPointerCancel={(event) => onPushToTalkPointerEnd(event, true)}
                  onTouchStart={(event) => {
                    event.preventDefault();
                    onPushToTalkStart();
                  }}
                  onTouchEnd={(event) => {
                    event.preventDefault();
                    onPushToTalkPointerEnd();
                  }}
                  onTouchCancel={(event) => {
                    event.preventDefault();
                    onPushToTalkPointerEnd(undefined, true);
                  }}
                  onMouseDown={onPushToTalkStart}
                  onMouseUp={() => onPushToTalkPointerEnd()}
                  onMouseLeave={() => onPushToTalkPointerEnd(undefined, true)}
                  disabled={pushToTalkDisabled}
                  className={`mt-3 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-full border px-4 py-2 text-[11px] font-semibold shadow-lg ring-1 ring-black/30 ${
                    pushToTalkActive
                      ? "border-rose-200! bg-rose-600! text-white!"
                      : pushToTalkBusy
                      ? "border-sky-200! bg-sky-600! text-white!"
                      : "border-emerald-200! bg-emerald-700! text-white! hover:bg-emerald-600!"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                  title={ui.talkieInfo}
                  aria-label={ui.holdToTalk}
                  style={{
                    backgroundColor: pushToTalkActive
                      ? "rgba(225, 29, 72, 0.95)"
                      : pushToTalkBusy
                      ? "rgba(2, 132, 199, 0.95)"
                      : "rgba(4, 120, 87, 0.95)",
                    color: "#ffffff",
                    borderColor: "rgba(226, 232, 240, 0.95)",
                    touchAction: "none",
                    WebkitUserSelect: "none",
                    userSelect: "none",
                  }}
                >
                  <Mic className="h-4 w-4" />
                  <span className="whitespace-nowrap">
                    {pushToTalkActive
                      ? ui.releaseToTranslate
                      : pushToTalkBusy
                      ? ui.translating
                      : ui.holdToTalk}
                  </span>
                </button>
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-600/80 bg-slate-950/65 px-3 py-2 text-[10px] text-slate-100">
                  <input
                    type="checkbox"
                    checked={respondInTrainingLanguage}
                    onChange={(event) => onChangeRespondInTrainingLanguage(event.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-400 bg-slate-900 text-sky-400"
                  />
                  <span className="leading-relaxed">
                    <span className="block font-semibold text-sky-100">
                      {directReplyLabel}
                    </span>
                    <span className="block text-slate-300">
                      {micTranscriptionLine}
                    </span>
                  </span>
                </label>
                {pushToTalkDraftVisible && coachFeedback.trim().length > 0 ? (
                  <div
                    className="mt-3 rounded-lg border px-2 py-1.5"
                    style={{
                      borderColor: "rgba(125, 211, 252, 0.45)",
                      backgroundColor: "rgba(15, 23, 42, 0.58)",
                    }}
                  >
                    <p className="text-[10px] text-slate-200">{coachHelpHiddenLabel}</p>
                  </div>
                ) : coachFeedback.trim().length > 0 && (
                  <div
                    className="mt-3 rounded-lg border px-2 py-1.5"
                    style={{
                      borderColor: "rgba(125, 211, 252, 0.65)",
                      backgroundColor: "rgba(14, 116, 144, 0.25)",
                    }}
                  >
                    <p
                      className="text-[9px] font-semibold uppercase tracking-wide"
                      style={{ color: "#e0f2fe" }}
                    >
                      {coachHelpTitle}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {canShowCoachHelpTarget && (
                        <button
                          type="button"
                          onClick={() => onSetCoachHelpView("target")}
                          className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                          style={{
                            color: coachHelpView === "target" ? "#f8fafc" : "#e2e8f0",
                            borderColor:
                              coachHelpView === "target"
                                ? "rgba(59, 130, 246, 0.95)"
                                : "rgba(148, 163, 184, 0.7)",
                            backgroundColor:
                              coachHelpView === "target"
                                ? "rgba(30, 64, 175, 0.4)"
                                : "rgba(15, 23, 42, 0.35)",
                          }}
                        >
                          {receptionLabel}
                        </button>
                      )}
                      {canShowCoachHelpSource && (
                        <button
                          type="button"
                          onClick={() => onSetCoachHelpView("source")}
                          className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                          style={{
                            color: coachHelpView === "source" ? "#f8fafc" : "#e2e8f0",
                            borderColor:
                              coachHelpView === "source"
                                ? "rgba(14, 165, 233, 0.95)"
                                : "rgba(148, 163, 184, 0.7)",
                            backgroundColor:
                              coachHelpView === "source"
                                ? "rgba(2, 132, 199, 0.38)"
                                : "rgba(15, 23, 42, 0.35)",
                          }}
                        >
                          Original
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onEnsureCoachHelpFrench}
                        className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                        style={{
                          color: coachHelpView === "fr" ? "#f8fafc" : "#e2e8f0",
                          borderColor:
                            coachHelpView === "fr"
                              ? "rgba(251, 191, 36, 0.95)"
                              : "rgba(148, 163, 184, 0.7)",
                          backgroundColor:
                            coachHelpView === "fr"
                              ? "rgba(217, 119, 6, 0.38)"
                              : "rgba(15, 23, 42, 0.35)",
                        }}
                      >
                        {coachHelpFrenchBusy && coachHelpView === "fr"
                          ? `${frenchLabel}...`
                          : frenchLabel}
                      </button>
                    </div>
                    <div className="mt-1 max-h-64 space-y-1 overflow-y-auto pr-1 sm:max-h-72">
                      {coachFeedbackLines.map((line, index) => (
                        <div key={line.id}>
                          <div className="flex items-start gap-2">
                            <p
                              className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-[10px]"
                              style={{ color: "#ffffff" }}
                            >
                              {line.text}
                            </p>
                            {line.suggestionText &&
                              coachHelpPlaybackTarget &&
                              !/:\s*$/.test(line.suggestionText) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onReplayCoach(
                                      line.suggestionText,
                                      coachHelpPlaybackTarget
                                    )
                                  }
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sky-300/80 bg-sky-500/18 text-sky-100 hover:bg-sky-500/28"
                                  aria-label={`${ui.listen}: ${line.suggestionText}`}
                                  title={isFr ? "Ecouter cette suggestion" : "Listen to this suggestion"}
                                >
                                  <Volume2 className="h-3 w-3" />
                                </button>
                              )}
                          </div>
                          {coachHelpView === "target" &&
                            line.suggestionText &&
                            !/:\s*$/.test(line.suggestionText) && (
                              <AiPracticeNotebookSaveButton
                                payload={{
                                  kind: "coach_suggestion",
                                  mode: "simple",
                                  baseText: coachFeedbackBaseSuggestionByIndex[index] || "",
                                  baseLanguageCode: sourceLanguageCode,
                                  baseLanguageName: sourceLanguageName,
                                  targetText: line.suggestionText,
                                  targetLanguageCode: trainingTarget,
                                  targetLanguageName,
                                  phoneticText:
                                    coachFeedbackSuggestionPhonetics[line.phoneticId] || "",
                                  contextLabel: "Suggestion coach",
                                  roomId,
                                  voice: realtimeVoice,
                                }}
                                label={notebookSimpleLabel}
                                className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/18 bg-white/6 px-2.5 py-1 text-[9px] font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
                              />
                            )}
                          {line.phoneticId &&
                            coachFeedbackSuggestionPhonetics[line.phoneticId] && (
                              <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-[9px] text-violet-100/95">
                                {phoneticLabel}: {coachFeedbackSuggestionPhonetics[line.phoneticId]}
                              </p>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div
                className="flex min-h-45 min-w-0 flex-col rounded-xl border bg-slate-950/55 p-3"
                style={{
                  borderColor: boxingTheme
                    ? "rgba(251, 113, 133, 0.45)"
                    : "rgba(252, 211, 77, 0.45)",
                }}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: boxingTheme ? "#fecdd3" : "#fde68a" }}
                  >
                    {coachReplyTitle}
                  </p>
                  {canToggleView && (
                    <>
                      <button
                        type="button"
                        onClick={() => onToggleView("translation")}
                        className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                        style={{
                          color: view === "translation" ? "#f8fafc" : "#cbd5e1",
                          borderColor:
                            view === "translation"
                              ? "rgba(250, 204, 21, 0.9)"
                              : "rgba(148, 163, 184, 0.7)",
                          backgroundColor:
                            view === "translation"
                              ? "rgba(217, 119, 6, 0.32)"
                              : "rgba(15, 23, 42, 0.36)",
                        }}
                      >
                        {ui.translationLabel(targetLanguageName)}
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleView("source")}
                        className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                        style={{
                          color: view === "source" ? "#f8fafc" : "#cbd5e1",
                          borderColor:
                            view === "source"
                              ? "rgba(56, 189, 248, 0.9)"
                              : "rgba(148, 163, 184, 0.7)",
                          backgroundColor:
                            view === "source"
                              ? "rgba(2, 132, 199, 0.28)"
                              : "rgba(15, 23, 42, 0.36)",
                        }}
                      >
                        Original
                      </button>
                    </>
                  )}
                </div>
                {hasCoach && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-300">
                      {quickTranslationLabel}
                    </span>
                    <button
                      type="button"
                      onClick={onSelectCoachQuickOriginal}
                      className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                      style={{
                        color: !coachQuickActive ? "#f8fafc" : "#e2e8f0",
                        borderColor:
                          !coachQuickActive
                            ? "rgba(74, 222, 128, 0.95)"
                            : "rgba(148, 163, 184, 0.7)",
                        backgroundColor:
                          !coachQuickActive
                            ? "rgba(21, 128, 61, 0.34)"
                            : "rgba(15, 23, 42, 0.35)",
                      }}
                    >
                      Original
                    </button>
                    <select
                      value={coachQuickTargetCode}
                      onChange={(event) => onSelectCoachQuickTarget(event.target.value as CaptionTarget)}
                      disabled={quickTranslationOptions.length === 0}
                      className="rounded-md border px-2 py-1 text-[10px] font-medium text-slate-100 disabled:opacity-60"
                      style={{
                        borderColor: "rgba(125, 211, 252, 0.8)",
                        backgroundColor: "rgba(15, 23, 42, 0.75)",
                      }}
                    >
                      {quickTranslationOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {`${option.name} (${option.label})`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onSelectCoachQuickTarget(coachQuickTargetCode)}
                      disabled={quickTranslationOptions.length === 0}
                      className="rounded-full border px-2 py-0.5 text-[9px] font-semibold disabled:opacity-60"
                      style={{
                        color: "#f8fafc",
                        borderColor: "rgba(125, 211, 252, 0.85)",
                        backgroundColor: "rgba(2, 132, 199, 0.35)",
                      }}
                    >
                      {coachQuickBusyCode === coachQuickTargetCode && coachQuickActive
                        ? ui.translating
                        : translateLabel}
                    </button>
                  </div>
                )}
                <div className="mt-2 pr-1">
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-100">
                    {hasCoach ? coachDisplayText : coachReplyPlaceholder}
                  </p>
                </div>
                {coachQuickError && (
                  <p className="mt-1 text-[10px] text-amber-200">{coachQuickError}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (coachQuickActive) {
                        onReplayCoach(coachDisplayText, coachQuickTargetCode);
                        return;
                      }
                      onReplayCoach();
                    }}
                    disabled={!hasCoach}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      borderColor: "rgba(125, 211, 252, 0.85)",
                      backgroundColor: "rgba(2, 132, 199, 0.22)",
                    }}
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    {playCoachLabel}
                  </button>
                  <AiPracticeNotebookSaveButton
                    payload={coachNotebookPayload}
                    label={notebookEnrichedLabel}
                    disabled={!canSaveCoachReply}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/8 px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-white/12 disabled:opacity-60"
                  />
                </div>
                {(coachPhoneticBusy || coachPhoneticText.trim().length > 0) && (
                  <p
                    className="mt-2 rounded-lg border px-2 py-1 text-[10px] font-medium"
                    style={{
                      borderColor: "rgba(221, 214, 254, 0.9)",
                      backgroundColor: "rgba(91, 33, 182, 0.45)",
                      color: "#ffffff",
                    }}
                  >
                    {coachPhoneticBusy
                      ? `${phoneticLabel}: ${isFr ? "generation..." : "generating..."}`
                      : `${phoneticLabel}: ${coachPhoneticText}`}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveKitConferenceMobile({
  roomId,
  isHost,
  captionsEnabled,
  guestTtsEnabled,
  hasRemotePublishedTranslationAudioTrack,
  onToggleGuestTts,
  shareMicToGuests,
  realtimeEnabled,
  realtimeAvailable,
  realtimeVoice,
  captionTarget,
  widgetState,
  onWidgetChange,
  roomChat,
  timerState,
  onOpenSettings,
  onLeaveSession,
  autoFrame,
  captionSize,
  videoFit,
  sourceLanguage,
  onChangeSourceLanguage,
  respondInTrainingLanguage,
  onChangeRespondInTrainingLanguage,
  onChangeCaptionTarget,
  guestCaptionTarget,
  onChangeGuestCaptionTarget,
  guestTtsToken,
  translationEnabled,
  translationLockMessage,
  translationRemainingSeconds,
  onConsumeTranslationSeconds,
  backgroundMode,
  onChangeBackground,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiBackgroundUrl,
  onAiImageGenerated,
  onClearAiBackground,
  aiGallery,
  onAiGallerySelect,
  onSaveAiBackground,
  isSettingsOpen,
  aiTrainingAutoStart = false,
  isChatSession = false,
}: {
  roomId: string;
  isHost: boolean;
  captionsEnabled: boolean;
  guestTtsEnabled: boolean;
  hasRemotePublishedTranslationAudioTrack: boolean;
  onToggleGuestTts: () => void;
  shareMicToGuests: boolean;
  realtimeEnabled: boolean;
  realtimeAvailable: boolean;
  realtimeVoice: string;
  captionTarget: CaptionTarget;
  widgetState: { showChat: boolean; unreadMessages: number; showSettings?: boolean };
  onWidgetChange: (state: { showChat: boolean; unreadMessages: number; showSettings?: boolean }) => void;
  roomChat: ReturnType<typeof useRoomChat>;
  timerState: RoomTimerState;
  onOpenSettings: () => void;
  onLeaveSession: () => void;
  autoFrame: boolean;
  captionSize: "sm" | "md" | "lg";
  videoFit: "cover" | "contain";
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  respondInTrainingLanguage: boolean;
  onChangeRespondInTrainingLanguage: (next: boolean) => void;
  onChangeCaptionTarget: (target: CaptionTarget) => void;
  guestCaptionTarget: CaptionTarget;
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  guestTtsToken: string;
  translationEnabled: boolean;
  translationLockMessage: string;
  translationRemainingSeconds?: number | null;
  onConsumeTranslationSeconds: (
    seconds: number,
    origin: "local" | "remote"
  ) => Promise<boolean>;
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onClearAiBackground: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  isSettingsOpen: boolean;
  aiTrainingAutoStart?: boolean;
  isChatSession?: boolean;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const [controlsHidden, setControlsHidden] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState<InviteCopyFeedback | null>(null);
  const [shareInviteId, setShareInviteId] = useState("");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const isVerySmallViewport = useIsMobileViewport(430);
  const isIPhone = useMemo(() => {
    return isApplePhonePlatform();
  }, []);
  const backgroundEffectsDisabled = useMemo(() => {
    return isBackgroundEffectsBlockedOnBrowser();
  }, []);

  useEffect(() => {
    if (aiTrainingAutoStart) return;
    if (!isHost || !roomId || typeof window === "undefined") return;
    const key = `bfzoom:invite-opened:${roomId}:mobile`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setInviteOpen(true);
  }, [aiTrainingAutoStart, isHost, roomId]);
  useEffect(() => {
    if (!(isIPhone || isVerySmallViewport)) {
      setMoreActionsOpen(false);
    }
  }, [isIPhone, isVerySmallViewport]);
  const [showMobileBadge, setShowMobileBadge] = useState(false);
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, lastMicrophoneError, lastCameraError } =
    useLocalParticipant();
  const room = useRoomContext();
  useHostRoomHeartbeat({
    room,
    roomId,
    isHost,
    sessionMode: isChatSession ? "chat" : "conference",
  });
  const useCompactPhoneControls = isIPhone || isVerySmallViewport;
  useEffect(() => {
    if (!useCompactPhoneControls || isChatSession || !widgetState.showChat) return;
    onWidgetChange({ ...widgetState, showChat: false });
  }, [isChatSession, onWidgetChange, useCompactPhoneControls, widgetState]);
  const roomIsRecovering =
    room.state === ConnectionState.Reconnecting ||
    room.state === ConnectionState.SignalReconnecting;
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false);
  const activateRoomAudio = useCallback(async () => {
    try {
      await room.startAudio();
      setAudioUnlockRequired(!room.canPlaybackAudio);
    } catch {
      setAudioUnlockRequired(true);
    }
  }, [room]);
  useEffect(() => {
    // Try once on mount; if browser blocks autoplay, fallback UX stays available.
    void activateRoomAudio();
  }, [activateRoomAudio]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncAudioStatus = () => {
      setAudioUnlockRequired(!room.canPlaybackAudio);
    };
    syncAudioStatus();
    const onVisibilityChange = () => syncAudioStatus();
    const onPageShow = () => syncAudioStatus();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [room]);
  useEffect(() => {
    if (!audioUnlockRequired || typeof window === "undefined") return;
    const onFirstInteraction = () => {
      void activateRoomAudio();
    };
    window.addEventListener("pointerdown", onFirstInteraction, { passive: true });
    window.addEventListener("touchstart", onFirstInteraction, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("touchstart", onFirstInteraction);
    };
  }, [activateRoomAudio, audioUnlockRequired]);
  const guestCaptionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === guestCaptionTarget)?.name || "English",
    [guestCaptionTarget]
  );
  const handleLeaveRoom = useCallback(() => {
    onLeaveSession();
    void room.disconnect();
  }, [onLeaveSession, room]);
  const [endingRoomForAll, setEndingRoomForAll] = useState(false);
  const [endRoomError, setEndRoomError] = useState("");
  const handleEndRoomForAll = useCallback(async () => {
    if (!isHost || endingRoomForAll) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Terminer la reunion pour tous les participants ? Cette action est immediate."
      );
      if (!confirmed) return;
    }
    setEndRoomError("");
    setEndingRoomForAll(true);
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch("/api/livekit/room/end", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ room: roomId }),
      });
      if (!response.ok) {
        const message = await readApiErrorMessage(response);
        throw new Error(message);
      }
      handleLeaveRoom();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Impossible de terminer la reunion.";
      setEndRoomError(toFriendlyAiError(message));
    } finally {
      setEndingRoomForAll(false);
    }
  }, [endingRoomForAll, handleLeaveRoom, isHost, roomId]);

  useEffect(() => {
    if (!isHost || shareMicToGuests) return;
    if (!localParticipant) return;
    void localParticipant.setMicrophoneEnabled(false);
  }, [isHost, localParticipant, shareMicToGuests]);
  const [mediaError, setMediaError] = useState<string>("");
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [isTogglingCamera, setIsTogglingCamera] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [sourceFromLocal, setSourceFromLocal] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [captionPhoneticText, setCaptionPhoneticText] = useState("");
  const [captionPhoneticTarget, setCaptionPhoneticTarget] = useState<CaptionTarget>(
    DEFAULT_CAPTION_TARGET
  );
  const [captionError, setCaptionError] = useState("");
  const [pushToTalkActive, setPushToTalkActive] = useState(false);
  const [pushToTalkBusy, setPushToTalkBusy] = useState(false);
  const [pushToTalkInterruptHint, setPushToTalkInterruptHint] = useState("");
  const [pushToTalkDraft, setPushToTalkDraft] = useState<PushToTalkDraft | null>(null);
  const [pushToTalkDraftText, setPushToTalkDraftText] = useState("");
  const [pushToTalkDraftEditing, setPushToTalkDraftEditing] = useState(false);
  const [pushToTalkDraftReview, setPushToTalkDraftReview] = useState<PushToTalkDraftReview | null>(
    null
  );
  const [pushToTalkDraftReviewBusy, setPushToTalkDraftReviewBusy] = useState(false);
  const [pushToTalkGestureHint, setPushToTalkGestureHint] = useState("");
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToTalkInterruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToTalkDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPartnerOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);
  const pushToTalkRecorderRef = useRef<MediaRecorder | null>(null);
  const pushToTalkStreamRef = useRef<MediaStream | null>(null);
  const pushToTalkWarmStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToTalkWarmupDoneRef = useRef(false);
  const pushToTalkWarmupInFlightRef = useRef<Promise<void> | null>(null);
  const pushToTalkChunksRef = useRef<BlobPart[]>([]);
  const pushToTalkMimeTypeRef = useRef("audio/webm");
  const pushToTalkPressedRef = useRef(false);
  const pushToTalkStartedAtRef = useRef<number | null>(null);
  const pushToTalkSessionRef = useRef(0);
  const pushToTalkPointerIdRef = useRef<number | null>(null);
  const pushToTalkPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pushToTalkCancelArmedRef = useRef(false);
  const pushToTalkDraftIdRef = useRef(0);
  const pushToTalkDraftReviewRequestRef = useRef(0);
  const pushToTalkDraftReviewAbortRef = useRef<AbortController | null>(null);
  const pushToTalkDraftReviewCacheRef = useRef<Map<string, PushToTalkDraftReview>>(new Map());
  const activeTranslationRequestRef = useRef(0);
  const activeTranslationAbortRef = useRef<AbortController | null>(null);
  const activeAiPartnerRequestRef = useRef(0);
  const activeAiPartnerAbortRef = useRef<AbortController | null>(null);
  const consumedIncomingCaptionIdsRef = useRef<Set<string>>(new Set());
  const guestTranslationCacheRef = useRef<Map<string, string>>(new Map());
  const guestTranslationInFlightRef = useRef<Map<string, Promise<string>>>(new Map());
  const phoneticCacheRef = useRef<Map<string, string>>(new Map());
  const phoneticRequestRef = useRef(0);
  const { message: captionIncoming, send: sendCaption } = useDataChannel("bfzoom-captions");
  const { message: translationAccessIncoming, send: sendTranslationAccess } =
    useDataChannel(TRANSLATION_ACCESS_TOPIC);
  const { message: talkieLockIncoming, send: sendTalkieLock } =
    useDataChannel(TALKIE_LOCK_TOPIC);
  const [talkieLockHolderIdentity, setTalkieLockHolderIdentity] = useState("");
  const [talkieLockHolderName, setTalkieLockHolderName] = useState("");
  const talkieLockHolderRef = useRef("");
  const talkieLockExpiresAtRef = useRef(0);
  const talkieLockTimestampRef = useRef(0);
  const talkieLockExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceLanguageOption = useMemo(
    () =>
      SOURCE_LANGUAGE_OPTIONS.find((item) => item.code === sourceLanguage) ??
      SOURCE_LANGUAGE_OPTIONS[0],
    [sourceLanguage]
  );
  const sourceLanguageName = sourceLanguageOption.name;
  const sourceLanguageLocale = sourceLanguageOption.recognitionLocale;
  const [exercisePhoneticEnabled] = useState(true);
  const localReceptionTarget = guestCaptionTarget;
  const localReceptionTargetName = guestCaptionTargetName;
  const captionDisplayTarget = captionPhoneticTarget || localReceptionTarget;
  const captionDisplayTargetName = useMemo(
    () =>
      CAPTION_TARGETS_CONFIG.find((item) => item.code === captionDisplayTarget)?.name ||
      resolveLanguageNameFromCode(captionDisplayTarget) ||
      localReceptionTargetName,
    [captionDisplayTarget, localReceptionTargetName]
  );
  const localReceptionHint = guestTtsEnabled
    ? "Communication: choisis la langue dans laquelle tu recois texte + voix sur ton appareil."
    : "Personnel: langue que tu recois (texte + voix) sur ton appareil.";
  const translationController = isHost || isChatSession;
  const [roomTranslationEnabled, setRoomTranslationEnabled] = useState(
    translationController ? translationEnabled : false
  );
  const [roomTranslationReason, setRoomTranslationReason] = useState(
    translationController
      ? translationLockMessage || TRANSLATION_UNLOCK_HINT
      : TRANSLATION_WAIT_HOST_HINT
  );
  const [roomTranslationRemainingSeconds, setRoomTranslationRemainingSeconds] = useState<
    number | null
  >(
    translationController && typeof translationRemainingSeconds === "number"
      ? Math.max(0, Math.floor(translationRemainingSeconds))
      : null
  );
  useEffect(() => {
    if (!translationController) return;
    setRoomTranslationEnabled(translationEnabled);
    setRoomTranslationReason(translationLockMessage || TRANSLATION_UNLOCK_HINT);
    setRoomTranslationRemainingSeconds(
      typeof translationRemainingSeconds === "number" &&
        Number.isFinite(translationRemainingSeconds)
        ? Math.max(0, Math.floor(translationRemainingSeconds))
        : null
    );
  }, [translationController, translationEnabled, translationLockMessage, translationRemainingSeconds]);
  const effectiveTranslationEnabled = translationController
    ? translationEnabled
    : roomTranslationEnabled;
  const effectiveTranslationLockMessage = effectiveTranslationEnabled
    ? ""
    : translationController
    ? translationLockMessage || TRANSLATION_UNLOCK_HINT
    : roomTranslationReason || TRANSLATION_WAIT_HOST_HINT;
  const effectiveTranslationRemainingSeconds = translationController
    ? typeof translationRemainingSeconds === "number" &&
      Number.isFinite(translationRemainingSeconds)
      ? Math.max(0, Math.floor(translationRemainingSeconds))
      : null
    : roomTranslationRemainingSeconds;
  const translationRemainingLabel = formatTranslationRemaining(
    effectiveTranslationRemainingSeconds
  );
  const translationControlsDisabled = !effectiveTranslationEnabled;
  const translationUnavailableMessage =
    effectiveTranslationLockMessage || TRANSLATION_UNLOCK_HINT;
  const resolveGuestTranslationForTarget = useCallback(
    async (
      translationInput: string,
      translationFromCode: string | undefined,
      translationFromName: string,
      targetCode: CaptionTargetCode,
      targetName: string,
      signal?: AbortSignal
    ) => {
      const normalizedInput = translationInput.trim();
      if (!normalizedInput) return "";
      if (normalizeCaptionTargetCode(translationFromCode) === targetCode) {
        return normalizedInput;
      }
      const translationCacheKey = buildTranslationCacheKey(
        normalizedInput,
        translationFromCode || "",
        targetCode
      );
      const cachedTranslation = guestTranslationCacheRef.current.get(translationCacheKey);
      if (cachedTranslation) return cachedTranslation;

      let inFlightTranslation = guestTranslationInFlightRef.current.get(translationCacheKey);
      if (!inFlightTranslation) {
        inFlightTranslation = translateWithOpenAi(
          normalizedInput,
          translationFromName,
          targetName,
          {
            fromCode: translationFromCode,
            toCode: targetCode,
            guestToken: guestTtsToken,
            signal,
            intent: "translation",
          }
        ).then((result) => result.trim());
        guestTranslationInFlightRef.current.set(translationCacheKey, inFlightTranslation);
      }

      try {
        const translated = await inFlightTranslation;
        if (translated) {
          upsertLruValue(
            guestTranslationCacheRef.current,
            translationCacheKey,
            translated,
            GUEST_TRANSLATION_CACHE_LIMIT
          );
        }
        return translated;
      } finally {
        const currentInFlight = guestTranslationInFlightRef.current.get(translationCacheKey);
        if (currentInFlight === inFlightTranslation) {
          guestTranslationInFlightRef.current.delete(translationCacheKey);
        }
      }
    },
    [guestTtsToken]
  );
  const aiPartnerAvailable =
    AI_PARTNER_TRAINING_ENABLED && isHost && (aiTrainingAutoStart || remoteParticipants.length === 0);
  const [aiPartnerEnabled, setAiPartnerEnabled] = useState(false);
  const [aiPartnerBusy, setAiPartnerBusy] = useState(false);
  const [aiPartnerLastReply, setAiPartnerLastReply] = useState("");
  const [aiPartnerLastTranslatedReply, setAiPartnerLastTranslatedReply] = useState("");
  const [aiPartnerFeedbackSource, setAiPartnerFeedbackSource] = useState("");
  const [aiPartnerFeedbackTranslated, setAiPartnerFeedbackTranslated] = useState("");
  const [aiPartnerFeedbackFrench, setAiPartnerFeedbackFrench] = useState("");
  const [aiPartnerFeedbackFrenchBusy, setAiPartnerFeedbackFrenchBusy] = useState(false);
  const [aiPartnerFeedbackView, setAiPartnerFeedbackView] =
    useState<AiPartnerFeedbackView>("target");
  const [aiPartnerOverlayText, setAiPartnerOverlayText] = useState("");
  const [aiPartnerView, setAiPartnerView] = useState<"translation" | "source">("translation");
  const [aiPartnerScenario, setAiPartnerScenario] = useState<AiPartnerScenario>("auto");
  const [aiPartnerTone, setAiPartnerTone] = useState<AiPartnerTone>("friendly");
  const [aiPartnerAvatarTheme, setAiPartnerAvatarTheme] =
    useState<AiPartnerAvatarTheme>("neutral");
  const [aiPartnerCoachPhoneticText, setAiPartnerCoachPhoneticText] = useState("");
  const [aiPartnerCoachPhoneticBusy, setAiPartnerCoachPhoneticBusy] = useState(false);
  const aiPartnerBusyRef = useRef(false);
  const aiPartnerCameraWasAutoDisabledRef = useRef(false);
  const aiPartnerConversationRef = useRef<AiPartnerConversationMessage[]>([]);
  const aiPracticeLanguageConfigRef = useRef({
    sourceLanguage,
    trainingTarget: localReceptionTarget,
    respondInTrainingLanguage,
  });
  const aiPartnerCoachPhoneticCacheRef = useRef<Map<string, string>>(new Map());
  const aiPartnerCoachPhoneticRequestRef = useRef(0);
  const aiPartnerActive = aiPartnerAvailable && aiPartnerEnabled;
  const pushToTalkDraftReviewMode: PushToTalkDraftReviewMode = aiTrainingAutoStart
    ? "coach"
    : "translation";
  const shouldUsePushToTalkDraftReview = aiTrainingAutoStart
    ? aiPartnerActive
    : captionsEnabled && !isChatSession;
  const activeSpeechLanguageCode =
    respondInTrainingLanguage && aiPartnerActive ? localReceptionTarget : sourceLanguage;
  const activeSpeechLanguageName =
    respondInTrainingLanguage && aiPartnerActive
      ? resolveLanguageNameFromCode(localReceptionTarget) || localReceptionTargetName
      : sourceLanguageName;
  const activeSpeechLanguageLocale =
    respondInTrainingLanguage && aiPartnerActive
      ? resolveSpeechLocaleFromLanguage(localReceptionTarget) || sourceLanguageLocale
      : sourceLanguageLocale;
  const aiPartnerOverlayVisible = aiPartnerActive && Boolean(aiPartnerOverlayText);
  const aiPartnerCanToggleView =
    aiPartnerLastTranslatedReply.trim().length > 0 &&
    aiPartnerLastReply.trim().length > 0 &&
    aiPartnerLastTranslatedReply.trim() !== aiPartnerLastReply.trim();
  const aiPartnerDisplayText = aiPartnerOverlayVisible
    ? aiPartnerOverlayText
    : aiPartnerBusy
    ? "Reponse en cours..."
    : aiPartnerView === "source"
    ? aiPartnerLastReply ||
      aiPartnerLastTranslatedReply ||
      "Connecte. Maintiens pour parler pour t'entrainer."
    : aiPartnerLastTranslatedReply ||
      aiPartnerLastReply ||
      "Connecte. Maintiens pour parler pour t'entrainer.";
  const aiPartnerFeedbackHasTargetVariant =
    aiPartnerFeedbackTranslated.trim().length > 0 &&
    aiPartnerFeedbackTranslated.trim() !== aiPartnerFeedbackSource.trim();
  const aiPartnerFeedbackHasSource = aiPartnerFeedbackSource.trim().length > 0;
  const aiPartnerFeedbackDisplay =
    aiPartnerFeedbackView === "source"
      ? aiPartnerFeedbackSource || aiPartnerFeedbackTranslated
      : aiPartnerFeedbackView === "fr"
      ? aiPartnerFeedbackFrench ||
        (aiPartnerFeedbackFrenchBusy
          ? "Traduction francaise en cours..."
          : aiPartnerFeedbackTranslated || aiPartnerFeedbackSource)
      : aiPartnerFeedbackTranslated || aiPartnerFeedbackSource;
  const aiPartnerDisplayUsesTranslation = aiPartnerOverlayVisible || aiPartnerView !== "source";
  const aiPartnerCoachActionText = aiPartnerDisplayText.trim();
  const aiPartnerCoachActionLanguageCode = aiPartnerDisplayUsesTranslation
    ? localReceptionTarget
    : activeSpeechLanguageCode;
  const aiPartnerCoachActionLanguageName = aiPartnerDisplayUsesTranslation
    ? localReceptionTargetName
    : activeSpeechLanguageName;
  const aiPartnerCoachPlaybackTarget = useMemo<CaptionTarget | undefined>(() => {
    return CAPTION_TARGETS_CONFIG.some(
      (target) => target.code === aiPartnerCoachActionLanguageCode
    )
      ? (aiPartnerCoachActionLanguageCode as CaptionTarget)
      : undefined;
  }, [aiPartnerCoachActionLanguageCode]);
  const showCaptionStack = !aiPartnerActive && Boolean(captionText) && !aiPartnerOverlayVisible;
  const lockControlsToggleInAiMode = aiPartnerActive && !isVerySmallViewport;
  useEffect(() => {
    if (!lockControlsToggleInAiMode) return;
    setControlsHidden(false);
  }, [lockControlsToggleInAiMode]);
  useEffect(() => {
    aiPartnerBusyRef.current = aiPartnerBusy;
  }, [aiPartnerBusy]);
  useEffect(() => {
    if (aiPartnerAvailable) return;
    setAiPartnerEnabled(false);
    setAiPartnerBusy(false);
    aiPartnerConversationRef.current = [];
    setAiPartnerLastReply("");
    setAiPartnerLastTranslatedReply("");
    setAiPartnerFeedbackSource("");
    setAiPartnerFeedbackTranslated("");
    setAiPartnerFeedbackFrench("");
    setAiPartnerFeedbackFrenchBusy(false);
    setAiPartnerFeedbackView("target");
    setAiPartnerOverlayText("");
    setAiPartnerView("translation");
    setAiPartnerCoachPhoneticText("");
    setAiPartnerCoachPhoneticBusy(false);
    if (aiPartnerOverlayTimerRef.current) {
      clearTimeout(aiPartnerOverlayTimerRef.current);
      aiPartnerOverlayTimerRef.current = null;
    }
  }, [aiPartnerAvailable, localReceptionTarget]);
  useEffect(() => {
    if (!aiTrainingAutoStart || isChatSession) return;
    if (!aiPartnerAvailable) return;
    setAiPartnerEnabled(true);
  }, [aiPartnerAvailable, aiTrainingAutoStart, isChatSession]);
  useEffect(() => {
    setAiPartnerCoachPhoneticText("");
  }, [aiPartnerCoachActionText, aiPartnerCoachActionLanguageCode, aiPartnerView]);
  useEffect(() => {
    if (!localParticipant) return;
    let cancelled = false;
    const syncCameraForAiPartner = async () => {
      if (roomIsRecovering) return;
      if (aiPartnerActive) {
        if (!isCameraEnabled) return;
        try {
          await localParticipant.setCameraEnabled(false);
          aiPartnerCameraWasAutoDisabledRef.current = true;
        } catch (err) {
          if (cancelled) return;
          setMediaError(
            err instanceof Error
              ? err.message
              : "Impossible de couper la camera en mode Partenaire IA."
          );
        }
        return;
      }
      if (!aiPartnerCameraWasAutoDisabledRef.current) return;
      if (isCameraEnabled) {
        aiPartnerCameraWasAutoDisabledRef.current = false;
        return;
      }
      try {
        await localParticipant.setCameraEnabled(true);
        aiPartnerCameraWasAutoDisabledRef.current = false;
      } catch (err) {
        if (cancelled) return;
        setMediaError(
          err instanceof Error
            ? err.message
            : "Impossible de reactiver la camera apres le mode Partenaire IA."
        );
      }
    };
    void syncCameraForAiPartner();
    return () => {
      cancelled = true;
    };
  }, [aiPartnerActive, isCameraEnabled, localParticipant, roomIsRecovering]);
  const broadcastRoomTranslationAccess = useCallback(async () => {
    if (!isHost || !sendTranslationAccess) return;
    const payload: TranslationAccessPayload = {
      roomId,
      enabled: translationEnabled,
      reason: translationLockMessage || TRANSLATION_UNLOCK_HINT,
      remainingSeconds:
        typeof translationRemainingSeconds === "number" &&
        Number.isFinite(translationRemainingSeconds)
          ? Math.max(0, Math.floor(translationRemainingSeconds))
          : undefined,
      from: localParticipant?.identity || "host",
      updatedAt: Date.now(),
    };
    const encoder = new TextEncoder();
    try {
      await sendTranslationAccess(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic: TRANSLATION_ACCESS_TOPIC,
      });
    } catch {
      // Keep local host state even if data-channel sync fails.
    }
  }, [
    isHost,
    localParticipant?.identity,
    roomId,
    sendTranslationAccess,
    translationEnabled,
    translationLockMessage,
    translationRemainingSeconds,
  ]);
  useEffect(() => {
    if (!isHost) return;
    void broadcastRoomTranslationAccess();
  }, [broadcastRoomTranslationAccess, isHost, remoteParticipants.length]);
  useEffect(() => {
    if (!isHost || !sendTranslationAccess) return;
    const syncTimer = setInterval(() => {
      void broadcastRoomTranslationAccess();
    }, 1500);
    return () => clearInterval(syncTimer);
  }, [broadcastRoomTranslationAccess, isHost, sendTranslationAccess]);
  useEffect(() => {
    if (isHost) return;
    if (!translationAccessIncoming?.payload) return;
    const decoder = new TextDecoder();
    try {
      const raw = decoder.decode(translationAccessIncoming.payload);
      const payload = JSON.parse(raw) as TranslationAccessPayload;
      if (payload.roomId && payload.roomId !== roomId) return;
      setRoomTranslationEnabled(Boolean(payload.enabled));
      const normalizedReason = String(payload.reason || "").trim();
      setRoomTranslationReason(normalizedReason || TRANSLATION_UNLOCK_HINT);
      if (
        typeof payload.remainingSeconds === "number" &&
        Number.isFinite(payload.remainingSeconds)
      ) {
        setRoomTranslationRemainingSeconds(
          Math.max(0, Math.floor(payload.remainingSeconds))
        );
      } else {
        setRoomTranslationRemainingSeconds(null);
      }
    } catch {
      // Ignore malformed payload.
    }
  }, [isHost, roomId, translationAccessIncoming]);
  const clearTalkieLock = useCallback(() => {
    talkieLockHolderRef.current = "";
    talkieLockExpiresAtRef.current = 0;
    setTalkieLockHolderIdentity("");
    setTalkieLockHolderName("");
    if (talkieLockExpiryTimerRef.current) {
      clearTimeout(talkieLockExpiryTimerRef.current);
      talkieLockExpiryTimerRef.current = null;
    }
  }, []);
  const armTalkieLockExpiry = useCallback(
    (expiresAt: number) => {
      if (talkieLockExpiryTimerRef.current) {
        clearTimeout(talkieLockExpiryTimerRef.current);
        talkieLockExpiryTimerRef.current = null;
      }
      const delay = Math.max(0, expiresAt - Date.now());
      talkieLockExpiryTimerRef.current = setTimeout(() => {
        if (talkieLockExpiresAtRef.current > Date.now()) return;
        clearTalkieLock();
      }, delay + 40);
    },
    [clearTalkieLock]
  );
  const applyTalkieLockPayload = useCallback(
    (payload: TalkieLockPayload) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      const nextTimestamp =
        typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
      if (nextTimestamp < talkieLockTimestampRef.current) return;
      talkieLockTimestampRef.current = nextTimestamp;

      const holder = String(payload.holder || "").trim();
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
      setTalkieLockHolderName(String(payload.holderName || "").trim());
      armTalkieLockExpiry(expiresAt);
    },
    [armTalkieLockExpiry, clearTalkieLock, roomId]
  );
  const publishTalkieLock = useCallback(
    async (action: "claim" | "release" | "heartbeat") => {
      if (!localParticipant) return;
      const expiresAt =
        action === "release" ? Date.now() : Date.now() + TALKIE_LOCK_TIMEOUT_MS;
      const payload: TalkieLockPayload = {
        roomId,
        holder: localParticipant.identity,
        holderName: localParticipant.name || localParticipant.identity || "BFZoom",
        action,
        expiresAt,
        timestamp: Date.now(),
      };
      applyTalkieLockPayload(payload);
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      try {
        if (sendTalkieLock) {
          await sendTalkieLock(encoded, {
            reliable: true,
            topic: TALKIE_LOCK_TOPIC,
          });
        } else {
          await localParticipant.publishData(encoded, {
            reliable: true,
            topic: TALKIE_LOCK_TOPIC,
          });
        }
      } catch {
        // Keep local receiver-side suppression even if the data channel is flaky.
      }
    },
    [applyTalkieLockPayload, localParticipant, roomId, sendTalkieLock]
  );
  useEffect(() => {
    if (!talkieLockIncoming?.payload) return;
    const decoder = new TextDecoder();
    try {
      const raw = decoder.decode(talkieLockIncoming.payload);
      const payload = JSON.parse(raw) as TalkieLockPayload;
      applyTalkieLockPayload(payload);
    } catch {
      // Ignore malformed talkie lock payloads.
    }
  }, [applyTalkieLockPayload, talkieLockIncoming]);
  useEffect(() => {
    if (!pushToTalkActive && !pushToTalkBusy) return;
    const heartbeatId = setInterval(() => {
      void publishTalkieLock("heartbeat");
    }, TALKIE_LOCK_HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeatId);
    };
  }, [publishTalkieLock, pushToTalkActive, pushToTalkBusy]);
  useEffect(() => {
    if (!room) return;
    const applyTalkieRemoteAudioSuppression = () => {
      room.remoteParticipants.forEach((participant) => {
        const shouldSuppress =
          Boolean(talkieLockHolderIdentity) &&
          participant.identity === talkieLockHolderIdentity;
        participant.setVolume(
          shouldSuppress ? TALKIE_REMOTE_AUDIO_MUTED_VOLUME : TALKIE_REMOTE_AUDIO_VOLUME_NORMAL,
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
        participant.setVolume(TALKIE_REMOTE_AUDIO_VOLUME_NORMAL, Track.Source.Microphone);
      });
    };
  }, [room, talkieLockHolderIdentity]);
  useEffect(() => {
    return () => {
      void publishTalkieLock("release");
    };
  }, [publishTalkieLock]);
  const isTalkieLockedByOther = useMemo(() => {
    if (!talkieLockHolderIdentity) return false;
    return talkieLockHolderIdentity !== (localParticipant?.identity || "");
  }, [localParticipant?.identity, talkieLockHolderIdentity]);
  const talkieLockedMessage = isTalkieLockedByOther
    ? ui.talkieBusyBy(talkieLockHolderName || talkieLockHolderIdentity)
    : "";
  const handleLocalReceptionTargetChange = useCallback(
    (target: CaptionTarget) => {
      onChangeGuestCaptionTarget(target);
      if (isHost) onChangeCaptionTarget(target);
    },
    [isHost, onChangeCaptionTarget, onChangeGuestCaptionTarget]
  );
  useEffect(() => {
    const trimmedCaption = captionText.trim();
    if (!trimmedCaption || !exercisePhoneticEnabled || !guestTtsEnabled || !captionsEnabled) {
      setCaptionPhoneticText("");
      return;
    }
    const targetCode = captionPhoneticTarget || localReceptionTarget;
    const cacheKey = `${targetCode}:${trimmedCaption}`;
    const cached = phoneticCacheRef.current.get(cacheKey);
    if (typeof cached === "string") {
      setCaptionPhoneticText(cached);
      return;
    }
    let cancelled = false;
    const requestId = ++phoneticRequestRef.current;
    const targetName =
      CAPTION_TARGETS_CONFIG.find((item) => item.code === targetCode)?.name ||
      resolveLanguageNameFromCode(targetCode) ||
      "Target";
    void (async () => {
      try {
        const phonetic = await phoneticWithOpenAi(trimmedCaption, targetName, {
          targetCode,
          guestToken: guestTtsToken,
        });
        if (cancelled || requestId !== phoneticRequestRef.current) return;
        const cleaned = phonetic.trim();
        const sourceNormalized = trimmedCaption.replace(/\s+/g, " ").trim().toLowerCase();
        const phoneticNormalized = cleaned.replace(/\s+/g, " ").trim().toLowerCase();
        const finalPhonetic =
          cleaned && phoneticNormalized !== sourceNormalized ? cleaned : "";
        phoneticCacheRef.current.set(cacheKey, finalPhonetic);
        setCaptionPhoneticText(finalPhonetic);
      } catch {
        if (cancelled || requestId !== phoneticRequestRef.current) return;
        setCaptionPhoneticText("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    captionPhoneticTarget,
    captionText,
    captionsEnabled,
    exercisePhoneticEnabled,
    guestTtsEnabled,
    guestTtsToken,
    localReceptionTarget,
  ]);
  const speechRecognitionSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const maybeWindow = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    return Boolean(maybeWindow.SpeechRecognition || maybeWindow.webkitSpeechRecognition);
  }, []);
  const mediaRecorderSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);
  const preferRecorderPushToTalk = useMemo(() => {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isMacDesktop = /Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
    return isMacDesktop && mediaRecorderSupported;
  }, [mediaRecorderSupported]);
  const pushToTalkSupported = speechRecognitionSupported || mediaRecorderSupported;
  const schedulePushToTalkWarmStreamRelease = useCallback(() => {
    if (pushToTalkWarmStreamTimerRef.current) {
      clearTimeout(pushToTalkWarmStreamTimerRef.current);
    }
    pushToTalkWarmStreamTimerRef.current = setTimeout(() => {
      const recorder = pushToTalkRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        schedulePushToTalkWarmStreamRelease();
        return;
      }
      pushToTalkWarmStreamTimerRef.current = null;
      const stream = pushToTalkStreamRef.current;
      pushToTalkStreamRef.current = null;
      if (!stream) return;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }, 12000);
  }, []);
  const warmupPushToTalkMicrophone = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    const existingStream = pushToTalkStreamRef.current;
    if (existingStream && existingStream.active) {
      pushToTalkWarmupDoneRef.current = true;
      schedulePushToTalkWarmStreamRelease();
      return;
    }
    if (pushToTalkWarmupInFlightRef.current) {
      await pushToTalkWarmupInFlightRef.current;
      return;
    }
    const warmupTask = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        pushToTalkStreamRef.current = stream;
        pushToTalkWarmupDoneRef.current = true;
        schedulePushToTalkWarmStreamRelease();
      } catch {
        // Keep normal first push-to-talk behavior if warmup fails.
      } finally {
        pushToTalkWarmupInFlightRef.current = null;
      }
    })();
    pushToTalkWarmupInFlightRef.current = warmupTask;
    await warmupTask;
  }, [schedulePushToTalkWarmStreamRelease]);
  useEffect(() => {
    if (!pushToTalkSupported) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    const prime = () => {
      if (cancelled) return;
      void activateRoomAudio();
      if (!pushToTalkWarmupDoneRef.current) {
        void warmupPushToTalkMicrophone();
      }
    };
    const delayedPrime = window.setTimeout(prime, 200);
    const onFirstInteraction = () => {
      prime();
    };
    window.addEventListener("pointerdown", onFirstInteraction, { passive: true, once: true });
    window.addEventListener("touchstart", onFirstInteraction, { passive: true, once: true });
    return () => {
      cancelled = true;
      window.clearTimeout(delayedPrime);
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("touchstart", onFirstInteraction);
    };
  }, [activateRoomAudio, pushToTalkSupported, warmupPushToTalkMicrophone]);
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    {
      onlySubscribed: false,
    }
  );
  const cameraTracks = tracks.filter(
    (track) =>
      track.source === Track.Source.Camera || track.publication?.source === Track.Source.Camera
  );
  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);
  const [focusTrackId, setFocusTrackId] = useState<string | null>(null);
  const manualFocusRef = useRef(false);
  const annotationOverlay = useAnnotationSync({ roomId, isHost });
  const {
    overlayRef,
    drawingEnabled,
    setDrawingEnabled,
    brushColor,
    setBrushColor,
    brushWidth,
    setBrushWidth,
    handleAnnotationStart,
    handleAnnotationMove,
    stopAnnotation,
    undoAnnotation,
    clearAnnotations,
    getLatestStroke,
    sendStroke,
    sendUndo,
    sendClear,
    addTextEntry,
    sendTextEntry,
  } = annotationOverlay;
  const handleAnnotationStop = useCallback(() => {
    const stroke = getLatestStroke();
    if (stroke) {
      sendStroke(stroke);
    }
  }, [getLatestStroke, sendStroke]);
  const handleAnnotationUndo = useCallback(() => {
    sendUndo();
  }, [sendUndo]);
  const handleAnnotationClear = useCallback(() => {
    sendClear();
  }, [sendClear]);
  const handleAnnotationTextMobile = useCallback(
    (entry: AnnotationText) => {
      addTextEntry(entry);
      sendTextEntry(entry);
    },
    [addTextEntry, sendTextEntry]
  );
  const [mobileView, setMobileView] = useState<"focus" | "mosaic">("focus");
  const trackKey = useCallback((track: TrackReferenceOrPlaceholder) => {
    if (isTrackReference(track)) {
      return track.publication.trackSid || `${track.participant.identity}-camera`;
    }
    return `${track.participant.identity}-camera`;
  }, []);
  const { speakCaption: speakGuestCaption, stopCaptionPlayback: stopGuestCaptionPlayback } =
    useGuestCaptionPlayer(realtimeVoice, setCaptionError, guestTtsToken);
  const getRecorderMimeType = useCallback(() => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }, []);
  const releasePushToTalkStream = useCallback(() => {
    if (pushToTalkWarmStreamTimerRef.current) {
      clearTimeout(pushToTalkWarmStreamTimerRef.current);
      pushToTalkWarmStreamTimerRef.current = null;
    }
    const stream = pushToTalkStreamRef.current;
    pushToTalkStreamRef.current = null;
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });
  }, []);
  const transcribePushToTalkBlob = useCallback(async (blob: Blob, mimeType: string) => {
    const fileExt = mimeType.includes("mp4") ? "m4a" : mimeType.includes("mpeg") ? "mp3" : "webm";
    const formData = new FormData();
    formData.append("file", blob, `push-to-talk.${fileExt}`);
    formData.append("roomId", roomId);
    formData.append("language", activeSpeechLanguageCode);
    const authHeader = await getAuthHeader({ forceRefresh: true });
    const headers: Record<string, string> = { ...authHeader };
    const guestToken = guestTtsToken.trim();
    if (!authHeader.Authorization && guestToken) {
      headers["x-bfzoom-guest-tts-token"] = guestToken;
    }
    const transcriptResponse = await fetch("/api/transcribe", {
      method: "POST",
      headers,
      body: formData,
    });
    const transcriptPayload = await transcriptResponse.json().catch(() => ({}));
    if (!transcriptResponse.ok) {
      throw new Error(
        (transcriptPayload as { error?: string })?.error || "Transcription impossible."
      );
    }
    return String((transcriptPayload as { text?: string })?.text || "").trim();
  }, [activeSpeechLanguageCode, guestTtsToken, roomId]);
  const stopPushToTalkRecognition = useCallback(() => {
    pushToTalkPressedRef.current = false;
    pushToTalkPointerIdRef.current = null;
    pushToTalkPointerStartRef.current = null;
    pushToTalkCancelArmedRef.current = false;
    setPushToTalkGestureHint("");
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
      recognitionRef.current = null;
    }
    const recorder = pushToTalkRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
    setPushToTalkActive(false);
  }, []);
  const showPushToTalkInterruptHint = useCallback(() => {
    setPushToTalkInterruptHint("Interrompu: nouvelle capture en cours.");
    if (pushToTalkInterruptTimerRef.current) {
      clearTimeout(pushToTalkInterruptTimerRef.current);
    }
    pushToTalkInterruptTimerRef.current = setTimeout(() => {
      setPushToTalkInterruptHint("");
      pushToTalkInterruptTimerRef.current = null;
    }, 1800);
  }, []);
  const resetPushToTalkDraftReview = useCallback(() => {
    pushToTalkDraftReviewRequestRef.current += 1;
    pushToTalkDraftReviewAbortRef.current?.abort();
    pushToTalkDraftReviewAbortRef.current = null;
    setPushToTalkDraftReview(null);
    setPushToTalkDraftReviewBusy(false);
  }, []);
  const interruptCurrentTurn = useCallback(() => {
    pushToTalkSessionRef.current += 1;
    pushToTalkDraftIdRef.current += 1;
    if (pushToTalkDraftTimerRef.current) {
      clearTimeout(pushToTalkDraftTimerRef.current);
      pushToTalkDraftTimerRef.current = null;
    }
    activeTranslationRequestRef.current += 1;
    activeTranslationAbortRef.current?.abort();
    activeTranslationAbortRef.current = null;
    activeAiPartnerRequestRef.current += 1;
    activeAiPartnerAbortRef.current?.abort();
    activeAiPartnerAbortRef.current = null;
    aiPartnerBusyRef.current = false;
    setPushToTalkBusy(false);
    setPushToTalkDraft(null);
    setPushToTalkDraftText("");
    setPushToTalkDraftEditing(false);
    resetPushToTalkDraftReview();
    setAiPartnerBusy(false);
    setAiPartnerOverlayText("");
    stopPushToTalkRecognition();
    void publishTalkieLock("release");
    stopGuestCaptionPlayback();
  }, [
    publishTalkieLock,
    resetPushToTalkDraftReview,
    stopPushToTalkRecognition,
    stopGuestCaptionPlayback,
  ]);
  const resetAiPartnerConversationState = useCallback(() => {
    interruptCurrentTurn();
    aiPartnerConversationRef.current = [];
    if (captionTimerRef.current) {
      clearTimeout(captionTimerRef.current);
      captionTimerRef.current = null;
    }
    if (aiPartnerOverlayTimerRef.current) {
      clearTimeout(aiPartnerOverlayTimerRef.current);
      aiPartnerOverlayTimerRef.current = null;
    }
    setCaptionError("");
    setSourceText("");
    setCaptionText("");
    setCaptionPhoneticText("");
    setAiPartnerBusy(false);
    setAiPartnerLastReply("");
    setAiPartnerLastTranslatedReply("");
    setAiPartnerFeedbackSource("");
    setAiPartnerFeedbackTranslated("");
    setAiPartnerFeedbackFrench("");
    setAiPartnerFeedbackFrenchBusy(false);
    setAiPartnerFeedbackView("target");
    setAiPartnerOverlayText("");
    setAiPartnerView("translation");
    setAiPartnerCoachPhoneticText("");
    setAiPartnerCoachPhoneticBusy(false);
  }, [interruptCurrentTurn]);
  useEffect(() => {
    const nextConfig = {
      sourceLanguage,
      trainingTarget: localReceptionTarget,
      respondInTrainingLanguage,
    };
    const previousConfig = aiPracticeLanguageConfigRef.current;
    aiPracticeLanguageConfigRef.current = nextConfig;
    if (!aiTrainingAutoStart || isChatSession) return;
    const changed =
      previousConfig.sourceLanguage !== nextConfig.sourceLanguage ||
      previousConfig.trainingTarget !== nextConfig.trainingTarget ||
      previousConfig.respondInTrainingLanguage !== nextConfig.respondInTrainingLanguage;
    if (!changed) return;
    resetAiPartnerConversationState();
  }, [
    aiTrainingAutoStart,
    isChatSession,
    localReceptionTarget,
    resetAiPartnerConversationState,
    respondInTrainingLanguage,
    sourceLanguage,
  ]);
  const requestAiPartnerReply = useCallback(
    async (userInput: string) => {
      if (!aiPartnerActive || aiPartnerBusyRef.current) return;
      const prompt = userInput.trim();
      if (!prompt) return;
      const requestId = ++activeAiPartnerRequestRef.current;
      activeAiPartnerAbortRef.current?.abort();
      const requestController = new AbortController();
      activeAiPartnerAbortRef.current = requestController;

      aiPartnerBusyRef.current = true;
      setAiPartnerBusy(true);
      setAiPartnerFeedbackView("target");
      setAiPartnerFeedbackFrench("");
      setAiPartnerFeedbackFrenchBusy(false);
      setAiPartnerFeedbackSource("");
      setAiPartnerFeedbackTranslated("");
      try {
        const authHeader = await getAuthHeader({ forceRefresh: true });
        if (!authHeader.Authorization) {
          setCaptionError("Partenaire IA: connecte-toi pour activer l'entrainement.");
          return;
        }

        const response = await fetch("/api/openai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            intent: "coach_ai",
            coachMode: "partner",
            coachScenario: aiPartnerScenario,
            coachTone: aiPartnerTone,
            coachLanguage: activeSpeechLanguageName,
            roomId,
            timeoutMs: 18_000,
            maxTokens: 300,
            temperature: 0.4,
            messages: [
              {
                role: "system",
                content: buildAiPartnerSystemPrompt(
                  activeSpeechLanguageName,
                  aiPartnerScenario,
                  aiPartnerTone
                ),
              },
              ...aiPartnerConversationRef.current,
              { role: "user", content: prompt },
            ],
          }),
          signal: requestController.signal,
        });
        if (!response.ok) {
          const reason = await readApiErrorMessage(response);
          throw new Error(reason);
        }
        if (requestId !== activeAiPartnerRequestRef.current) return;

        const payload = (await response.json().catch(() => ({}))) as {
          choices?: { message?: { content?: string } }[];
        };
        const rawReply = String(payload?.choices?.[0]?.message?.content || "").trim();
        if (!rawReply) return;
        const parsedCoachPayload = parseAiPartnerCoachPayload(rawReply);
        const aiReplySource = parsedCoachPayload.reply.replace(/\s+/g, " ").trim();
        if (!aiReplySource) return;
        if (requestId !== activeAiPartnerRequestRef.current) return;
        const nextConversation: AiPartnerConversationMessage[] = [
          ...aiPartnerConversationRef.current,
          { role: "user", content: prompt },
          { role: "assistant", content: aiReplySource },
        ];
        aiPartnerConversationRef.current = nextConversation.slice(-AI_PARTNER_HISTORY_LIMIT);
        setAiPartnerLastReply(aiReplySource);
        let feedbackSource = parsedCoachPayload.feedback.trim();
        const previousFeedbackSnapshot = aiPartnerFeedbackSource.trim();
        if (
          !feedbackSource ||
          (previousFeedbackSnapshot.length > 0 && feedbackSource === previousFeedbackSnapshot)
        ) {
          try {
            const recoveryResponse = await fetch("/api/openai", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify({
                intent: "coach_ai",
                coachMode: "partner_feedback",
                coachLanguage: activeSpeechLanguageName,
                roomId,
                timeoutMs: 12_000,
                maxTokens: 220,
                temperature: 0.2,
                messages: [
                  {
                    role: "system",
                    content: buildAiPartnerFeedbackRecoveryPrompt(activeSpeechLanguageName),
                  },
                  {
                    role: "user",
                    content: [
                      `Learner sentence: ${prompt}`,
                      `Coach reply: ${aiReplySource}`,
                      `Previous feedback: ${
                        previousFeedbackSnapshot || "(none)"
                      }`,
                    ].join("\n"),
                  },
                ],
              }),
              signal: requestController.signal,
            });
            if (recoveryResponse.ok) {
              const recoveryPayload = (await recoveryResponse.json().catch(() => ({}))) as {
                choices?: { message?: { content?: string } }[];
              };
              const recoveryRaw = String(
                recoveryPayload?.choices?.[0]?.message?.content || ""
              ).trim();
              if (recoveryRaw) {
                const recovered = parseAiPartnerCoachPayload(recoveryRaw).feedback.trim();
                if (recovered) {
                  feedbackSource = recovered;
                }
              }
            }
          } catch {
            // Keep previous parsed feedback (possibly empty) if recovery fails.
          }
        }
        if (requestId !== activeAiPartnerRequestRef.current) return;

        let aiReplyForUser = aiReplySource;
        let feedbackForUser = feedbackSource;
        if (activeSpeechLanguageCode !== localReceptionTarget) {
          try {
            const translated = await translateWithOpenAi(
              aiReplySource,
              activeSpeechLanguageName,
              localReceptionTargetName,
              {
                fromCode: activeSpeechLanguageCode,
                toCode: localReceptionTarget,
                guestToken: guestTtsToken,
                intent: "translation",
                signal: requestController.signal,
              }
            );
            if (translated.trim()) {
              aiReplyForUser = translated.trim();
            }
          } catch {
            // Keep source reply if translation fallback fails.
          }
          if (feedbackSource) {
            try {
              const translatedFeedback = await translateWithOpenAi(
                feedbackSource,
                activeSpeechLanguageName,
                localReceptionTargetName,
                {
                  fromCode: activeSpeechLanguageCode,
                  toCode: localReceptionTarget,
                  guestToken: guestTtsToken,
                  intent: "translation",
                  signal: requestController.signal,
                }
              );
              if (translatedFeedback.trim()) {
                feedbackForUser = translatedFeedback.trim();
              }
            } catch {
              // Keep source coaching help if translation fallback fails.
            }
          }
        }
        if (requestId !== activeAiPartnerRequestRef.current) return;

        setAiPartnerFeedbackSource(feedbackSource);
        setAiPartnerFeedbackTranslated(feedbackForUser);
        setAiPartnerFeedbackFrench("");
        setAiPartnerFeedbackFrenchBusy(false);
        setAiPartnerFeedbackView("target");
        setAiPartnerLastTranslatedReply(aiReplyForUser);
        setAiPartnerView("translation");
        setAiPartnerOverlayText(aiReplyForUser);
        if (aiPartnerOverlayTimerRef.current) clearTimeout(aiPartnerOverlayTimerRef.current);
        aiPartnerOverlayTimerRef.current = setTimeout(() => {
          setAiPartnerOverlayText("");
        }, 15000);
        if (guestTtsEnabled) {
          void speakGuestCaption(aiReplyForUser, localReceptionTarget);
        }
        void roomChat.sendMessage(aiReplyForUser, { fromName: AI_PARTNER_NAME });
      } catch (err) {
        if (
          requestController.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : "Reponse IA indisponible.";
        setCaptionError(`Partenaire IA: ${toFriendlyAiError(message)}`);
      } finally {
        if (activeAiPartnerAbortRef.current === requestController) {
          activeAiPartnerAbortRef.current = null;
        }
        if (requestId === activeAiPartnerRequestRef.current) {
          aiPartnerBusyRef.current = false;
          setAiPartnerBusy(false);
        }
      }
    },
    [
      activeAiPartnerAbortRef,
      activeAiPartnerRequestRef,
      aiPartnerActive,
      aiPartnerConversationRef,
      aiPartnerFeedbackSource,
      guestTtsEnabled,
      guestTtsToken,
      aiPartnerScenario,
      aiPartnerTone,
      activeSpeechLanguageCode,
      activeSpeechLanguageName,
      localReceptionTarget,
      localReceptionTargetName,
      roomChat,
      roomId,
      speakGuestCaption,
    ]
  );
  const replayAiPartnerCoach = useCallback((textOverride?: string, targetOverride?: CaptionTarget) => {
    const text = (textOverride ?? aiPartnerCoachActionText).trim();
    if (!text) return;
    void speakGuestCaption(text, targetOverride || aiPartnerCoachPlaybackTarget);
  }, [aiPartnerCoachActionText, aiPartnerCoachPlaybackTarget, speakGuestCaption]);
  const replayAiPartnerUserTranslation = useCallback((overrideText?: string, overrideTarget?: CaptionTarget) => {
    const text = (overrideText ?? captionText).trim();
    if (!text) return;
    void speakGuestCaption(text, overrideTarget || localReceptionTarget);
  }, [captionText, localReceptionTarget, speakGuestCaption]);
  const ensureAiPartnerFeedbackFrench = useCallback(async () => {
    const feedbackTarget = aiPartnerFeedbackTranslated.trim();
    const feedbackSource = aiPartnerFeedbackSource.trim();
    const baseText = (feedbackTarget || feedbackSource).trim();
    if (!baseText) return;
    setAiPartnerFeedbackView("fr");
    if (aiPartnerFeedbackFrench.trim()) return;
    if (aiPartnerFeedbackFrenchBusy) return;

    const fromCode = feedbackTarget ? localReceptionTarget : activeSpeechLanguageCode;
    const fromName = feedbackTarget ? localReceptionTargetName : activeSpeechLanguageName;
    if (fromCode === "fr") {
      setAiPartnerFeedbackFrench(baseText);
      return;
    }

    setAiPartnerFeedbackFrenchBusy(true);
    try {
      const translated = await translateWithOpenAi(baseText, fromName, "Francais", {
        fromCode,
        toCode: "fr",
        guestToken: guestTtsToken,
        intent: "translation",
      });
      const resolved = translated.trim() || baseText;
      setAiPartnerFeedbackFrench(resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Traduction francaise indisponible.";
      setCaptionError(`Aide Coach IA: ${toFriendlyAiError(message)}`);
      setAiPartnerFeedbackFrench(baseText);
    } finally {
      setAiPartnerFeedbackFrenchBusy(false);
    }
  }, [
    aiPartnerFeedbackFrench,
    aiPartnerFeedbackFrenchBusy,
    aiPartnerFeedbackSource,
    aiPartnerFeedbackTranslated,
    guestTtsToken,
    activeSpeechLanguageCode,
    activeSpeechLanguageName,
    localReceptionTarget,
    localReceptionTargetName,
  ]);
  const requestAiPartnerCoachPhonetic = useCallback(async () => {
    const text = aiPartnerCoachActionText.trim();
    if (!text) return;
    const targetCode = aiPartnerCoachActionLanguageCode;
    const cacheKey = `${targetCode}:${text}`;
    const cached = aiPartnerCoachPhoneticCacheRef.current.get(cacheKey);
    if (typeof cached === "string") {
      setAiPartnerCoachPhoneticText(cached);
      return;
    }
    setAiPartnerCoachPhoneticBusy(true);
    const requestId = ++aiPartnerCoachPhoneticRequestRef.current;
    try {
      const phonetic = await phoneticWithOpenAi(text, aiPartnerCoachActionLanguageName, {
        targetCode,
        guestToken: guestTtsToken,
      });
      if (requestId !== aiPartnerCoachPhoneticRequestRef.current) return;
      const cleaned = phonetic.trim();
      const sourceNormalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      const phoneticNormalized = cleaned.replace(/\s+/g, " ").trim().toLowerCase();
      const finalPhonetic =
        cleaned && phoneticNormalized !== sourceNormalized ? cleaned : "";
      aiPartnerCoachPhoneticCacheRef.current.set(cacheKey, finalPhonetic);
      setAiPartnerCoachPhoneticText(finalPhonetic);
    } catch (err) {
      if (requestId !== aiPartnerCoachPhoneticRequestRef.current) return;
      const message = err instanceof Error ? err.message : "Phonetique indisponible.";
      setCaptionError(`Phonetique: ${toFriendlyAiError(message)}`);
      setAiPartnerCoachPhoneticText("");
    } finally {
      if (requestId === aiPartnerCoachPhoneticRequestRef.current) {
        setAiPartnerCoachPhoneticBusy(false);
      }
    }
  }, [
    aiPartnerCoachActionLanguageCode,
    aiPartnerCoachActionLanguageName,
    aiPartnerCoachActionText,
    guestTtsToken,
  ]);
  useEffect(() => {
    if (!aiPartnerActive) return;
    if (!aiPartnerCoachActionText.trim()) return;
    void requestAiPartnerCoachPhonetic();
  }, [
    aiPartnerActive,
    aiPartnerCoachActionText,
    aiPartnerCoachActionLanguageCode,
    aiPartnerView,
    requestAiPartnerCoachPhonetic,
  ]);
  const translateAndBroadcast = useCallback(
    async (
      input: string,
      durationSeconds = 1,
      deliveryGate?: Promise<boolean>
    ) => {
      if (!effectiveTranslationEnabled) {
        setCaptionError(translationUnavailableMessage);
        return;
      }
      const trimmed = input.trim();
      if (!trimmed) return;
      const outgoingTarget = localReceptionTarget;
      const outgoingTargetName = localReceptionTargetName;
      const requestId = ++activeTranslationRequestRef.current;
      activeTranslationAbortRef.current?.abort();
      const requestController = new AbortController();
      activeTranslationAbortRef.current = requestController;
      setPushToTalkBusy(true);
      setCaptionError("");
      setSourceText(trimmed);
      setSourceFromLocal(true);
      try {
        if (aiTrainingAutoStart) {
          const deliveryAllowed = await (deliveryGate ?? Promise.resolve(true)).catch(
            () => false
          );
          if (requestId !== activeTranslationRequestRef.current) return;
          if (!deliveryAllowed) {
            setCaptionError(translationUnavailableMessage);
            return;
          }
        }
        const sameLanguage = activeSpeechLanguageCode === outgoingTarget;
        let finalText = trimmed;
        let translationWarning = "";
        if (!sameLanguage) {
          try {
            const translated = await resolveGuestTranslationForTarget(
              trimmed,
              activeSpeechLanguageCode,
              activeSpeechLanguageName,
              outgoingTarget,
              outgoingTargetName,
              requestController.signal
            );
            if (requestId !== activeTranslationRequestRef.current) return;
            if (translated.trim()) {
              finalText = translated.trim();
            }
          } catch (err) {
            if (
              requestController.signal.aborted ||
              (err instanceof Error && err.name === "AbortError")
            ) {
              throw err;
            }
            const message = err instanceof Error ? err.message : "Erreur de traduction.";
            translationWarning = toFriendlyAiError(message);
          }
        }
        if (!finalText) return;
        if (requestId !== activeTranslationRequestRef.current) return;
        if (!aiTrainingAutoStart) {
          const deliveryAllowed = await (deliveryGate ?? Promise.resolve(true)).catch(
            () => false
          );
          if (requestId !== activeTranslationRequestRef.current) return;
          if (!deliveryAllowed) {
            setCaptionError(translationUnavailableMessage);
            return;
          }
        }
        setCaptionText(finalText);
        setCaptionPhoneticTarget(outgoingTarget);
        if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
        if (!aiPartnerActive) {
          captionTimerRef.current = setTimeout(() => {
            setCaptionText("");
            setCaptionPhoneticText("");
          }, 15000);
        }
        if (guestTtsEnabled) {
          void speakGuestCaption(finalText, outgoingTarget);
        }
        const payload: CaptionPayload = {
          id: safeRandomId(),
          text: finalText,
          target: outgoingTarget,
          sourceText: trimmed,
          sourceLang: activeSpeechLanguageCode,
          sourceLangName: activeSpeechLanguageName,
          durationSeconds: Math.max(1, Math.floor(durationSeconds || 1)),
          from: localParticipant?.identity || "host",
          timestamp: Date.now(),
          roomId,
        };
        const encoder = new TextEncoder();
        await sendCaption(encoder.encode(JSON.stringify(payload)), {
          reliable: true,
          topic: "bfzoom-captions",
        });
        if (requestId !== activeTranslationRequestRef.current) return;
        if (sameLanguage) {
          setCaptionError("Info: langue source et reception identiques, texte conserve.");
        } else if (translationWarning) {
          setCaptionError(
            `Traduction indisponible temporairement: affichage source conserve (${translationWarning})`
          );
        }
        if (aiPartnerActive) {
          void requestAiPartnerReply(trimmed);
        }
      } catch (err) {
        if (
          requestController.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : "Erreur de traduction.";
        setCaptionError(message);
      } finally {
        if (activeTranslationAbortRef.current === requestController) {
          activeTranslationAbortRef.current = null;
        }
        if (requestId === activeTranslationRequestRef.current) {
          setPushToTalkBusy(false);
        }
      }
    },
    [
      activeTranslationAbortRef,
      activeTranslationRequestRef,
      aiTrainingAutoStart,
      localParticipant?.identity,
      localReceptionTarget,
      localReceptionTargetName,
      roomId,
      sendCaption,
      guestTtsEnabled,
      resolveGuestTranslationForTarget,
      speakGuestCaption,
      activeSpeechLanguageCode,
      activeSpeechLanguageName,
      aiPartnerActive,
      requestAiPartnerReply,
      effectiveTranslationEnabled,
      translationUnavailableMessage,
    ]
  );
  const clearPushToTalkDraftTimer = useCallback(() => {
    if (pushToTalkDraftTimerRef.current) {
      clearTimeout(pushToTalkDraftTimerRef.current);
      pushToTalkDraftTimerRef.current = null;
    }
  }, []);
  const requestPushToTalkDraftReview = useCallback(
    async (
      draftId: number,
      transcript: string,
      captureSource: PushToTalkDraftCaptureSource = "speech"
    ) => {
      if (!shouldUsePushToTalkDraftReview) return;
      const normalizedTranscript = normalizeComparableText(transcript);
      if (!normalizedTranscript) return;
      const cacheKey = `${activeSpeechLanguageCode}:${captureSource}:${normalizedTranscript}`;
      const cached = pushToTalkDraftReviewCacheRef.current.get(cacheKey);
      if (cached) {
        if (pushToTalkDraftIdRef.current !== draftId) return;
        setPushToTalkDraftReview(cached);
        setPushToTalkDraftReviewBusy(false);
        return;
      }

      pushToTalkDraftReviewAbortRef.current?.abort();
      const requestController = new AbortController();
      pushToTalkDraftReviewAbortRef.current = requestController;
      const requestId = ++pushToTalkDraftReviewRequestRef.current;
      setPushToTalkDraftReview(null);
      setPushToTalkDraftReviewBusy(true);
      try {
        const review = await reviewPushToTalkDraftWithOpenAi(transcript, activeSpeechLanguageName, {
          signal: requestController.signal,
          targetCode: activeSpeechLanguageCode,
          guestToken: guestTtsToken,
          mode: pushToTalkDraftReviewMode,
          captureSource,
        });
        if (
          requestId !== pushToTalkDraftReviewRequestRef.current ||
          pushToTalkDraftIdRef.current !== draftId
        ) {
          return;
        }
        pushToTalkDraftReviewCacheRef.current.set(cacheKey, review);
        setPushToTalkDraftReview(review);
      } catch (err) {
        if (
          requestController.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        if (
          requestId !== pushToTalkDraftReviewRequestRef.current ||
          pushToTalkDraftIdRef.current !== draftId
        ) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Analyse avant envoi indisponible.";
        setCaptionError(
          `${pushToTalkDraftReviewMode === "translation" ? "Verification avant traduction" : "Verification avant envoi"}: ${toFriendlyAiError(message)}`
        );
        setPushToTalkDraftReview({
          status: "review",
          message: "Analyse indisponible. Corrige manuellement ou envoie tel quel.",
          correctedText: "",
          naturalText: "",
          familiarText: "",
          reviewedText: transcript,
        });
      } finally {
        if (pushToTalkDraftReviewAbortRef.current === requestController) {
          pushToTalkDraftReviewAbortRef.current = null;
        }
        if (
          requestId === pushToTalkDraftReviewRequestRef.current &&
          pushToTalkDraftIdRef.current === draftId
        ) {
          setPushToTalkDraftReviewBusy(false);
        }
      }
    },
    [
      activeSpeechLanguageCode,
      activeSpeechLanguageName,
      guestTtsToken,
      pushToTalkDraftReviewMode,
      shouldUsePushToTalkDraftReview,
    ]
  );
  const openPushToTalkManualDraft = useCallback(
    (message: string, elapsedSeconds: number, initialText = "") => {
      const transcript = initialText.trim();
      clearPushToTalkDraftTimer();
      const draftId = pushToTalkDraftIdRef.current + 1;
      pushToTalkDraftIdRef.current = draftId;
      setPushToTalkDraft({
        id: draftId,
        transcript,
        elapsedSeconds: Math.max(1, Math.floor(elapsedSeconds || 1)),
        captureSource: transcript ? "recording" : "manual",
        requiresExplicitConfirmation: true,
      });
      setPushToTalkDraftText(transcript);
      resetPushToTalkDraftReview();
      setPushToTalkDraftReview(buildManualPushToTalkDraftReview(message, transcript));
      setPushToTalkDraftEditing(true);
      setCaptionError(message);
    },
    [clearPushToTalkDraftTimer, resetPushToTalkDraftReview]
  );
  const submitPushToTalkDraft = useCallback(
    async (overrideText?: string) => {
      const draft = pushToTalkDraft;
      if (!draft) return;
      const finalTranscript = (overrideText ?? pushToTalkDraftText).trim();
      if (!finalTranscript) {
        setCaptionError("Corrige la phrase avant de l'envoyer.");
        return;
      }
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      pushToTalkDraftIdRef.current += 1;
      setPushToTalkDraft(null);
      setPushToTalkDraftEditing(false);
      setPushToTalkDraftText("");
      setPushToTalkGestureHint("");
      const deliveryGate = translationController
        ? onConsumeTranslationSeconds(draft.elapsedSeconds, "local")
        : undefined;
      try {
        await publishTalkieLock("claim");
        await translateAndBroadcast(finalTranscript, draft.elapsedSeconds, deliveryGate);
      } finally {
        void publishTalkieLock("release");
      }
    },
    [
      clearPushToTalkDraftTimer,
      onConsumeTranslationSeconds,
      publishTalkieLock,
      pushToTalkDraft,
      pushToTalkDraftText,
      resetPushToTalkDraftReview,
      translationController,
      translateAndBroadcast,
    ]
  );
  const queuePushToTalkDraft = useCallback(
    (
      rawTranscript: string,
      elapsedSeconds: number,
      options: QueuePushToTalkDraftOptions = {}
    ) => {
      const transcript = rawTranscript.trim();
      if (!transcript && !options.forceEditing) {
        void publishTalkieLock("release");
        setCaptionError(ui.noVoiceDetected);
        return;
      }
      clearPushToTalkDraftTimer();
      void publishTalkieLock("release");
      const draftId = pushToTalkDraftIdRef.current + 1;
      pushToTalkDraftIdRef.current = draftId;
      const draft: PushToTalkDraft = {
        id: draftId,
        transcript,
        elapsedSeconds: Math.max(1, Math.floor(elapsedSeconds || 1)),
        captureSource: options.captureSource || "speech",
        requiresExplicitConfirmation: Boolean(options.requiresExplicitConfirmation),
      };
      setPushToTalkDraft(draft);
      setPushToTalkDraftText(transcript);
      resetPushToTalkDraftReview();
      if (options.reviewOverride) {
        setPushToTalkDraftReview(options.reviewOverride);
      }
      const requireCorrection = transcript ? shouldForcePushToTalkCorrection(transcript) : true;
      const shouldStartEditing = Boolean(options.forceEditing) || requireCorrection;
      setPushToTalkDraftEditing(shouldStartEditing);
      if (shouldStartEditing) {
        setCaptionError(options.reviewOverride?.message || ui.incompleteDetection);
        return;
      }
      if (shouldUsePushToTalkDraftReview) {
        void requestPushToTalkDraftReview(draftId, transcript, draft.captureSource);
      }
    },
    [
      clearPushToTalkDraftTimer,
      publishTalkieLock,
      requestPushToTalkDraftReview,
      resetPushToTalkDraftReview,
      shouldUsePushToTalkDraftReview,
      ui.incompleteDetection,
      ui.noVoiceDetected,
    ]
  );
  const cancelPushToTalkDraft = useCallback(
    (message = "Capture annulee.") => {
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      void publishTalkieLock("release");
      pushToTalkDraftIdRef.current += 1;
      setPushToTalkDraft(null);
      setPushToTalkDraftText("");
      setPushToTalkDraftEditing(false);
      setPushToTalkGestureHint("");
      setCaptionError(message);
    },
    [clearPushToTalkDraftTimer, publishTalkieLock, resetPushToTalkDraftReview]
  );
  const cancelPushToTalkCapture = useCallback(
    (message = "Capture annulee.") => {
      pushToTalkSessionRef.current += 1;
      pushToTalkPressedRef.current = false;
      pushToTalkStartedAtRef.current = null;
      pushToTalkPointerIdRef.current = null;
      pushToTalkPointerStartRef.current = null;
      pushToTalkCancelArmedRef.current = false;
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      recognitionRef.current = null;
      const recorder = pushToTalkRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
      pushToTalkRecorderRef.current = null;
      pushToTalkChunksRef.current = [];
      releasePushToTalkStream();
      void publishTalkieLock("release");
      setPushToTalkActive(false);
      setPushToTalkBusy(false);
      cancelPushToTalkDraft(message);
      if (pushToTalkInterruptTimerRef.current) {
        clearTimeout(pushToTalkInterruptTimerRef.current);
      }
      setPushToTalkInterruptHint("Interrompu: nouvelle capture en cours.");
      pushToTalkInterruptTimerRef.current = setTimeout(() => {
        setPushToTalkInterruptHint("");
        pushToTalkInterruptTimerRef.current = null;
      }, 1800);
      stopGuestCaptionPlayback();
    },
    [cancelPushToTalkDraft, publishTalkieLock, releasePushToTalkStream, stopGuestCaptionPlayback]
  );
  const setPushToTalkDraftEditMode = useCallback(() => {
    clearPushToTalkDraftTimer();
    setPushToTalkDraftEditing(true);
  }, [clearPushToTalkDraftTimer]);
  const handlePushToTalkDraftTextChange = useCallback(
    (nextValue: string) => {
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      setPushToTalkDraftEditing(true);
      setPushToTalkDraftText(nextValue);
    },
    [clearPushToTalkDraftTimer, resetPushToTalkDraftReview]
  );
  const applyPushToTalkDraftSuggestion = useCallback(
    (nextValue: string) => {
      clearPushToTalkDraftTimer();
      resetPushToTalkDraftReview();
      setPushToTalkDraftText(nextValue);
      setPushToTalkDraftEditing(true);
    },
    [clearPushToTalkDraftTimer, resetPushToTalkDraftReview]
  );
  const pushToTalkDraftReviewCurrent = isPushToTalkDraftReviewCurrent(
    pushToTalkDraftReview,
    pushToTalkDraftText
  );
  const pushToTalkDraftAutoSendEnabled =
    Boolean(pushToTalkDraft) &&
    !pushToTalkDraftEditing &&
    !pushToTalkDraft?.requiresExplicitConfirmation &&
    !shouldForcePushToTalkCorrection(pushToTalkDraftText) &&
    (!shouldUsePushToTalkDraftReview ||
      (!pushToTalkDraftReviewBusy &&
        pushToTalkDraftReviewCurrent &&
        pushToTalkDraftReview?.status === "ok"));
  useEffect(() => {
    clearPushToTalkDraftTimer();
    if (!pushToTalkDraft || !pushToTalkDraftAutoSendEnabled) return;
    const draftId = pushToTalkDraft.id;
    pushToTalkDraftTimerRef.current = setTimeout(() => {
      if (pushToTalkDraftIdRef.current !== draftId) return;
      void submitPushToTalkDraft();
    }, PUSH_TO_TALK_AUTO_SEND_MS);
    return clearPushToTalkDraftTimer;
  }, [
    clearPushToTalkDraftTimer,
    pushToTalkDraft,
    pushToTalkDraftAutoSendEnabled,
    submitPushToTalkDraft,
  ]);
  const startPushToTalkRecognition = useCallback(() => {
    if (!effectiveTranslationEnabled) {
      setCaptionError(translationUnavailableMessage);
      return;
    }
    if (!captionsEnabled) return;
    if (isTalkieLockedByOther) {
      setCaptionError(talkieLockedMessage);
      return;
    }
    if (pushToTalkPressedRef.current) return;
    if (pushToTalkBusy || aiPartnerBusyRef.current) {
      interruptCurrentTurn();
      showPushToTalkInterruptHint();
    }
    if (pushToTalkActive) return;
    if (realtimeEnabled) {
      setCaptionError(ui.disableRealtimeForPushToTalk);
      return;
    }
    if (!pushToTalkSupported || typeof window === "undefined") {
      setCaptionError("Push-to-talk indisponible sur cet iPhone.");
      return;
    }
    if (recognitionRef.current || pushToTalkRecorderRef.current) return;
    stopGuestCaptionPlayback();
    setAiPartnerOverlayText("");
    const sessionId = pushToTalkSessionRef.current + 1;
    pushToTalkSessionRef.current = sessionId;
    pushToTalkPressedRef.current = true;
    pushToTalkStartedAtRef.current = Date.now();
    setCaptionError("");
    setPushToTalkActive(true);
    void publishTalkieLock("claim");

    if (speechRecognitionSupported && !preferRecorderPushToTalk) {
      const maybeWindow = window as unknown as {
        SpeechRecognition?: new () => any;
        webkitSpeechRecognition?: new () => any;
      };
      const SpeechCtor = maybeWindow.SpeechRecognition || maybeWindow.webkitSpeechRecognition;
      if (SpeechCtor) {
        let finalTranscript = "";
        const recognition = new SpeechCtor();
        recognitionRef.current = recognition;
        recognition.lang = activeSpeechLanguageLocale || "fr-FR";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event: any) => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          let interim = "";
          let finalChunk = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const item = event.results[index];
            const transcript = String(item?.[0]?.transcript || "").trim();
            if (!transcript) continue;
            if (item.isFinal) {
              finalChunk += ` ${transcript}`;
            } else {
              interim += ` ${transcript}`;
            }
          }
          if (finalChunk.trim()) {
            finalTranscript = `${finalTranscript} ${finalChunk}`.trim();
          }
        };
        recognition.onerror = (event: any) => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          const reason = String(event?.error || "Erreur micro");
          if (reason === "aborted") return;
          void publishTalkieLock("release");
          if (reason === "no-speech") {
            setCaptionError(ui.noVoiceDetected);
            return;
          }
          setCaptionError(`Micro: ${toFriendlyAiError(reason)}`);
        };
        recognition.onend = () => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          recognitionRef.current = null;
          setPushToTalkActive(false);
          const transcript = finalTranscript.trim();
          const elapsedSeconds = Math.max(
            1,
            Math.round(
              ((Date.now() - (pushToTalkStartedAtRef.current ?? Date.now())) / 1000) || 1
            )
          );
          pushToTalkStartedAtRef.current = null;
          if (!transcript) {
            void publishTalkieLock("release");
            if (!pushToTalkBusy) {
              setCaptionError(ui.noVoiceDetected);
            }
            return;
          }
          void publishTalkieLock("release");
          queuePushToTalkDraft(transcript, elapsedSeconds, {
            captureSource: "speech",
          });
        };
        try {
          recognition.start();
          return;
        } catch {
          recognitionRef.current = null;
        }
      }
    }

    if (!mediaRecorderSupported || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPushToTalkActive(false);
      void publishTalkieLock("release");
      setCaptionError("Push-to-talk indisponible sur cet iPhone.");
      return;
    }

    void (async () => {
      try {
        const warmedStream = pushToTalkStreamRef.current;
        const stream =
          warmedStream && warmedStream.active
            ? warmedStream
            : await navigator.mediaDevices.getUserMedia({ audio: true });
        pushToTalkStreamRef.current = stream;
        if (pushToTalkWarmStreamTimerRef.current) {
          clearTimeout(pushToTalkWarmStreamTimerRef.current);
          pushToTalkWarmStreamTimerRef.current = null;
        }
        pushToTalkChunksRef.current = [];
        const mimeType = getRecorderMimeType();
        pushToTalkMimeTypeRef.current = mimeType || "audio/webm";
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        pushToTalkRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          if (!event.data || event.data.size === 0) return;
          pushToTalkChunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          void publishTalkieLock("release");
          setCaptionError("Enregistrement audio interrompu.");
          setPushToTalkBusy(false);
          setPushToTalkActive(false);
          pushToTalkRecorderRef.current = null;
          pushToTalkChunksRef.current = [];
          releasePushToTalkStream();
        };
        recorder.onstop = () => {
          if (sessionId !== pushToTalkSessionRef.current) return;
          const chunks = [...pushToTalkChunksRef.current];
          pushToTalkChunksRef.current = [];
          pushToTalkRecorderRef.current = null;
          releasePushToTalkStream();
          if (chunks.length === 0) {
            pushToTalkStartedAtRef.current = null;
            void publishTalkieLock("release");
            setPushToTalkBusy(false);
            return;
          }
          const mimeTypeValue = pushToTalkMimeTypeRef.current || "audio/webm";
          const blob = new Blob(chunks, { type: mimeTypeValue });
          if (blob.size < 1400) {
            pushToTalkStartedAtRef.current = null;
            void publishTalkieLock("release");
            setCaptionError("Audio trop court. Maintiens le bouton un peu plus longtemps.");
            setPushToTalkBusy(false);
            return;
          }
          void (async () => {
            const elapsedSeconds = Math.max(
              1,
              Math.round(
                ((Date.now() - (pushToTalkStartedAtRef.current ?? Date.now())) / 1000) || 1
              )
            );
            pushToTalkStartedAtRef.current = null;
            try {
              if (sessionId !== pushToTalkSessionRef.current) return;
              setPushToTalkBusy(true);
              const transcript = await transcribePushToTalkBlob(blob, mimeTypeValue);
              if (sessionId !== pushToTalkSessionRef.current) return;
              if (!transcript) {
                void publishTalkieLock("release");
                if (aiTrainingAutoStart) {
                  openPushToTalkManualDraft(
                    ui.mobileTranscriptionUnclear,
                    elapsedSeconds
                  );
                  return;
                }
                setCaptionError(ui.noVoiceDetected);
                return;
              }
              void publishTalkieLock("release");
              queuePushToTalkDraft(transcript, elapsedSeconds, {
                captureSource: "recording",
                requiresExplicitConfirmation: aiTrainingAutoStart,
              });
            } catch (err) {
              if (sessionId !== pushToTalkSessionRef.current) return;
              void publishTalkieLock("release");
              const message = err instanceof Error ? err.message : "Transcription impossible.";
              if (aiTrainingAutoStart) {
                openPushToTalkManualDraft(
                  `${ui.mobileTranscriptionFailed} (${toFriendlyAiError(message)})`,
                  elapsedSeconds
                );
                return;
              }
              setCaptionError(`Traduction: ${toFriendlyAiError(message)}`);
            } finally {
              if (sessionId !== pushToTalkSessionRef.current) return;
              setPushToTalkBusy(false);
            }
          })();
        };
        recorder.start();
        if (!pushToTalkPressedRef.current && recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (err) {
        if (sessionId !== pushToTalkSessionRef.current) return;
        pushToTalkStartedAtRef.current = null;
        setPushToTalkActive(false);
        setPushToTalkBusy(false);
        void publishTalkieLock("release");
        const message = err instanceof Error ? err.message : "Acces micro refuse.";
        setCaptionError(`Micro: ${toFriendlyAiError(message)}`);
        pushToTalkRecorderRef.current = null;
        pushToTalkChunksRef.current = [];
        releasePushToTalkStream();
      }
    })();
  }, [
    captionsEnabled,
    getRecorderMimeType,
    mediaRecorderSupported,
    preferRecorderPushToTalk,
    pushToTalkActive,
    pushToTalkBusy,
    pushToTalkSupported,
    realtimeEnabled,
    releasePushToTalkStream,
    activeSpeechLanguageLocale,
    speechRecognitionSupported,
    interruptCurrentTurn,
    publishTalkieLock,
    showPushToTalkInterruptHint,
    stopGuestCaptionPlayback,
    aiTrainingAutoStart,
    openPushToTalkManualDraft,
    effectiveTranslationEnabled,
    isTalkieLockedByOther,
    translationUnavailableMessage,
    talkieLockedMessage,
    transcribePushToTalkBlob,
    queuePushToTalkDraft,
    ui.disableRealtimeForPushToTalk,
    ui.mobileTranscriptionFailed,
    ui.mobileTranscriptionUnclear,
    ui.noVoiceDetected,
  ]);
  const handlePushToTalkPointerDown = useCallback(
    (event: any) => {
      event.preventDefault();
      if (typeof event.pointerId === "number" && event.currentTarget?.setPointerCapture) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
      }
      pushToTalkPointerIdRef.current =
        typeof event.pointerId === "number" ? event.pointerId : null;
      pushToTalkPointerStartRef.current = {
        x: Number(event.clientX ?? 0),
        y: Number(event.clientY ?? 0),
      };
      pushToTalkCancelArmedRef.current = false;
      setPushToTalkGestureHint("Glisse a gauche pour annuler.");
      startPushToTalkRecognition();
    },
    [startPushToTalkRecognition]
  );
  const handlePushToTalkPointerMove = useCallback((event: any) => {
    if (!pushToTalkPressedRef.current) return;
    const activePointerId = pushToTalkPointerIdRef.current;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    const origin = pushToTalkPointerStartRef.current;
    if (!origin) return;
    const deltaX = Number(event.clientX ?? origin.x) - origin.x;
    if (deltaX <= -PUSH_TO_TALK_CANCEL_DISTANCE_PX) {
      if (!pushToTalkCancelArmedRef.current) {
        pushToTalkCancelArmedRef.current = true;
        setPushToTalkGestureHint("Relache pour annuler.");
      }
    } else if (pushToTalkCancelArmedRef.current) {
      pushToTalkCancelArmedRef.current = false;
      setPushToTalkGestureHint("Glisse a gauche pour annuler.");
    }
  }, []);
  const handlePushToTalkPointerEnd = useCallback(
    (event?: any, forcedCancel = false) => {
      if (event) {
        event.preventDefault();
        const activePointerId = pushToTalkPointerIdRef.current;
        if (
          typeof event.pointerId === "number" &&
          activePointerId !== null &&
          activePointerId !== event.pointerId
        ) {
          return;
        }
      }
      if (!pushToTalkPressedRef.current) {
        setPushToTalkGestureHint("");
        return;
      }
      const shouldCancel = forcedCancel || pushToTalkCancelArmedRef.current;
      pushToTalkPointerIdRef.current = null;
      pushToTalkPointerStartRef.current = null;
      pushToTalkCancelArmedRef.current = false;
      setPushToTalkGestureHint("");
      if (shouldCancel) {
        cancelPushToTalkCapture("Capture annulee: relance une nouvelle prise.");
        return;
      }
      stopPushToTalkRecognition();
    },
    [cancelPushToTalkCapture, stopPushToTalkRecognition]
  );
  const resolvedFocusTrack = useMemo(() => {
    if (!focusTrackId) return null;
    return tracks.find((track) => trackKey(track) === focusTrackId) || null;
  }, [tracks, focusTrackId, trackKey]);
  const canMosaic = cameraTracks.length >= 3;

  const handleToggleScreenShare = useCallback(async () => {
    if (!localParticipant) return;
    if (isIPhone) {
      setScreenShareError("Partage d'écran indisponible sur iPhone.");
      return;
    }
    try {
      setScreenShareError("");
      await localParticipant.setScreenShareEnabled(!isScreenSharing);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de partager l'écran.";
      setScreenShareError(message);
    }
  }, [isIPhone, isScreenSharing, localParticipant]);

  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    if (isTogglingCamera) return;
    if (roomIsRecovering) return;
    setIsTogglingCamera(true);
    setMediaError("");

    const nextEnabled = !isCameraEnabled;
    try {
      if (
        nextEnabled &&
        typeof navigator !== "undefined" &&
        navigator.mediaDevices?.getUserMedia
      ) {
        const warmup = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        warmup.getTracks().forEach((track) => track.stop());
      }

      await localParticipant.setCameraEnabled(nextEnabled);
      if (nextEnabled) {
        const publication = localParticipant.getTrackPublication(Track.Source.Camera);
        if (!publication?.track) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await localParticipant.setCameraEnabled(true);
        }
      }
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : "Impossible d'activer la camera."
      );
    } finally {
      setIsTogglingCamera(false);
    }
  }, [isCameraEnabled, isTogglingCamera, localParticipant, roomIsRecovering]);
  const flipCamera = useCallback(async () => {
    if (!localParticipant || isFlippingCamera) return;
    setIsFlippingCamera(true);
    try {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const track = publication?.track as
        | {
            getDeviceId: (normalize?: boolean) => Promise<string | undefined>;
            setDeviceId: (id: string) => Promise<boolean>;
          }
        | undefined;
      if (!track) {
        setMediaError("Camera non active.");
        return;
      }
      const devices = await Room.getLocalDevices("videoinput");
      if (devices.length < 2) return;
      const currentId = await track.getDeviceId();
      let currentIndex = devices.findIndex((device) => device.deviceId === currentId);
      if (currentIndex < 0) currentIndex = 0;
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      await track.setDeviceId(nextDevice.deviceId);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "Impossible de changer de camera.");
    } finally {
      setIsFlippingCamera(false);
    }
  }, [isFlippingCamera, localParticipant]);

  useEffect(() => {
    const pub = localParticipant?.getTrackPublication(Track.Source.ScreenShare);
    setIsScreenSharing(Boolean(pub?.track));
  }, [localParticipant, screenShareTracks]);

  useEffect(() => {
    if (!screenShareTracks.length) return;
    const target = screenShareTracks[0];
    if (!target) return;
    setFocusTrackId(trackKey(target));
    setMobileView("focus");
  }, [screenShareTracks, trackKey]);

  useEffect(() => {
    if (!captionIncoming?.payload) return;
    let cancelled = false;
    const decoder = new TextDecoder();
    const processPayload = async () => {
      try {
        const text = decoder.decode(captionIncoming.payload);
        const payload = JSON.parse(text) as CaptionPayload;
        if (!payload.text) return;
        if (payload.roomId && payload.roomId !== roomId) return;
        if (payload.from && payload.from === localParticipant?.identity) return;
        if (isHost && payload.from === "host") return;
        const payloadId =
          typeof payload.id === "string" ? payload.id.trim() : "";
        if (isHost && payload.from && payload.from !== localParticipant?.identity) {
          const alreadyConsumed =
            payloadId && consumedIncomingCaptionIdsRef.current.has(payloadId);
          if (!alreadyConsumed) {
            if (payloadId) {
              consumedIncomingCaptionIdsRef.current.add(payloadId);
              if (consumedIncomingCaptionIdsRef.current.size > 300) {
                const first = consumedIncomingCaptionIdsRef.current.values().next().value;
                if (first) consumedIncomingCaptionIdsRef.current.delete(first);
              }
            }
            const remoteSeconds =
              typeof payload.durationSeconds === "number" &&
              Number.isFinite(payload.durationSeconds)
                ? Math.max(1, Math.min(300, Math.floor(payload.durationSeconds)))
                : 1;
            const consumed = await onConsumeTranslationSeconds(
              remoteSeconds,
              "remote"
            );
            if (!consumed) {
              setCaptionError(translationUnavailableMessage);
              return;
            }
          }
        }

        const incomingSourceText = (payload.sourceText || payload.text || "").trim();
        setSourceText(incomingSourceText);
        setSourceFromLocal(false);

        let localText = payload.text;
        let localTarget = normalizeCaptionTargetCode(payload.target);
        let fallbackMessage = "";
        if (
          localReceptionTarget &&
          localReceptionTargetName &&
          (payload.sourceText || payload.text) &&
          payload.target !== localReceptionTarget
        ) {
          const sourceText = (payload.sourceText || "").trim();
          const translationInput = (sourceText || payload.text || "").trim();
          const translationFromCode =
            sourceText.length > 0 ? payload.sourceLang : payload.target || payload.sourceLang;
          const translationFromName =
            sourceText.length > 0
              ? payload.sourceLangName || resolveLanguageNameFromCode(payload.sourceLang) || "Source"
              : resolveLanguageNameFromCode(payload.target) ||
                payload.sourceLangName ||
                resolveLanguageNameFromCode(payload.sourceLang) ||
                "Source";
          if (translationInput) {
            try {
              const guestTranslation = await resolveGuestTranslationForTarget(
                translationInput,
                translationFromCode,
                translationFromName,
                localReceptionTarget,
                localReceptionTargetName
              );
              if (guestTranslation.trim()) {
                localText = guestTranslation.trim();
                localTarget = localReceptionTarget;
              } else {
                fallbackMessage = buildCaptionFallbackMessage(
                  localReceptionTargetName,
                  localTarget ?? payload.target
                );
              }
            } catch (err) {
              console.warn("Guest translation failed", err);
              fallbackMessage = buildCaptionFallbackMessage(
                localReceptionTargetName,
                localTarget ?? payload.target
              );
            }
          }
        }
        const resolvedCaptionTarget = resolveCaptionDisplayTarget(
          localTarget ?? payload.target,
          localReceptionTarget
        );
        const captionMatchesReception =
          !localReceptionTarget || resolvedCaptionTarget === localReceptionTarget;
        const captionErrorMessage = captionMatchesReception
          ? ""
          : fallbackMessage ||
            buildCaptionFallbackMessage(localReceptionTargetName, resolvedCaptionTarget);
        if (cancelled) return;
        setCaptionText(localText);
        setCaptionPhoneticTarget(resolvedCaptionTarget);
        setCaptionError(captionErrorMessage);
        const remotePublishedAudioHandlesPlayback = Boolean(
          payload.audioTrackPublished &&
            hasRemotePublishedTranslationAudioTrack &&
            captionMatchesReception
        );
        if (guestTtsEnabled && !remotePublishedAudioHandlesPlayback && captionMatchesReception) {
          void speakGuestCaption(localText ?? payload.text, resolvedCaptionTarget);
        }
        if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
        if (!aiPartnerActive) {
          captionTimerRef.current = setTimeout(() => {
            setCaptionText("");
            setCaptionPhoneticText("");
          }, 15000);
        }
      } catch (err) {
        console.warn("Caption payload invalide", err);
      }
    };
    void processPayload();
    return () => {
      cancelled = true;
    };
  }, [
    aiPartnerActive,
    captionIncoming,
    guestTtsToken,
    guestTtsEnabled,
    hasRemotePublishedTranslationAudioTrack,
    isHost,
    localParticipant?.identity,
    localReceptionTarget,
    localReceptionTargetName,
    onConsumeTranslationSeconds,
    resolveGuestTranslationForTarget,
    roomId,
    speakGuestCaption,
    translationUnavailableMessage,
  ]);

  useEffect(() => {
    return () => {
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      if (pushToTalkInterruptTimerRef.current) {
        clearTimeout(pushToTalkInterruptTimerRef.current);
        pushToTalkInterruptTimerRef.current = null;
      }
      if (pushToTalkDraftTimerRef.current) {
        clearTimeout(pushToTalkDraftTimerRef.current);
        pushToTalkDraftTimerRef.current = null;
      }
      if (aiPartnerOverlayTimerRef.current) clearTimeout(aiPartnerOverlayTimerRef.current);
      stopPushToTalkRecognition();
      const recorder = pushToTalkRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
      pushToTalkRecorderRef.current = null;
      pushToTalkChunksRef.current = [];
      releasePushToTalkStream();
      activeTranslationAbortRef.current?.abort();
      activeTranslationAbortRef.current = null;
      activeAiPartnerAbortRef.current?.abort();
      activeAiPartnerAbortRef.current = null;
      pushToTalkDraftReviewRequestRef.current += 1;
      pushToTalkDraftReviewAbortRef.current?.abort();
      pushToTalkDraftReviewAbortRef.current = null;
      stopGuestCaptionPlayback();
    };
  }, [
    releasePushToTalkStream,
    stopGuestCaptionPlayback,
    stopPushToTalkRecognition,
  ]);

  useEffect(() => {
    if (!captionsEnabled || realtimeEnabled || !effectiveTranslationEnabled) {
      stopPushToTalkRecognition();
      void publishTalkieLock("release");
      setPushToTalkActive(false);
      setPushToTalkBusy(false);
      clearPushToTalkDraftTimer();
      setPushToTalkDraft(null);
      setPushToTalkDraftText("");
      setPushToTalkDraftEditing(false);
      resetPushToTalkDraftReview();
      setPushToTalkGestureHint("");
    }
  }, [
    captionsEnabled,
    realtimeEnabled,
    publishTalkieLock,
    stopPushToTalkRecognition,
    effectiveTranslationEnabled,
    clearPushToTalkDraftTimer,
    resetPushToTalkDraftReview,
  ]);

  useEffect(() => {
    if (!showMobileBadge) return;
    const timer = setTimeout(() => setShowMobileBadge(false), 2000);
    return () => clearTimeout(timer);
  }, [showMobileBadge]);

  useEffect(() => {
    const nextError =
      lastMicrophoneError?.message || lastCameraError?.message || "";
    setMediaError(nextError);
  }, [lastCameraError?.message, lastMicrophoneError?.message]);

  useEffect(() => {
    if (cameraTracks.length === 0) return;
    if (canMosaic && mobileView === "mosaic") {
      if (focusTrackId) setFocusTrackId(null);
      manualFocusRef.current = false;
      return;
    }
    const remoteFirst = cameraTracks.find(
      (track) => track.participant && track.participant.identity !== localParticipant?.identity
    );
    const focusMissing =
      !focusTrackId || !cameraTracks.some((track) => trackKey(track) === focusTrackId);
    if (focusMissing) {
      const nextTrack = remoteFirst || cameraTracks[0];
      setFocusTrackId(nextTrack ? trackKey(nextTrack) : null);
      manualFocusRef.current = false;
      return;
    }
    const focusIsLocal =
      resolvedFocusTrack?.participant &&
      resolvedFocusTrack.participant.identity === localParticipant?.identity;
    if (!manualFocusRef.current && focusIsLocal && remoteFirst) {
      setFocusTrackId(trackKey(remoteFirst));
    }
  }, [
    cameraTracks,
    focusTrackId,
    localParticipant?.identity,
    resolvedFocusTrack,
    trackKey,
    canMosaic,
    mobileView,
  ]);

  useEffect(() => {
    if (!canMosaic) {
      setMobileView("focus");
      return;
    }
    if (!manualFocusRef.current && !focusTrackId) {
      setMobileView("mosaic");
    }
  }, [canMosaic, focusTrackId]);

  const ensureShareInviteId = useCallback(async () => {
    if (!isHost || !roomId) return "";
    if (shareInviteId) return shareInviteId;
    const inviteId = await createLivekitRoomInviteId(roomId);
    setShareInviteId((current) => current || inviteId);
    return inviteId;
  }, [isHost, roomId, shareInviteId]);
  useEffect(() => {
    setShareInviteId("");
  }, [roomId]);
  useEffect(() => {
    if (!isHost || !roomId) return;
    void ensureShareInviteId().catch(() => {});
  }, [ensureShareInviteId, isHost, roomId]);

  const inviteLinks = shareInviteId ? buildInviteLinks(shareInviteId) : { smart: "" };

  const copyInvite = async (kind: InviteLinkKind) => {
    const activeInviteId = await ensureShareInviteId().catch(() => "");
    const link = activeInviteId ? buildInviteLinks(activeInviteId)[kind] : inviteLinks[kind];
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(kind);
      setTimeout(() => setInviteCopied(null), 1500);
    } catch {
      setInviteCopied(null);
    }
  };
  const shareInvite = async () => {
    const activeInviteId = await ensureShareInviteId().catch(() => "");
    const link = activeInviteId ? buildInviteLinks(activeInviteId).smart : inviteLinks.smart;
    if (!link) return;
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      setInviteCopied(null);
      return;
    }
    const shareTitle = ui.inviteEmailSubject;
    const shareText = ui.inviteEmailBody;
    void navigator
      .share({
        title: shareTitle,
        text: shareText,
        url: link,
      })
      .then(() => {
        setInviteCopied("shared");
        setTimeout(() => setInviteCopied(null), 1500);
      })
      .catch(() => {
        setInviteCopied(null);
      });
  };
  const pushToTalkDisabled =
    translationControlsDisabled ||
    !pushToTalkSupported ||
    realtimeEnabled ||
    isTalkieLockedByOther;
  const pushToTalkTitle = translationControlsDisabled
    ? translationUnavailableMessage
    : isTalkieLockedByOther
    ? talkieLockedMessage
    : realtimeEnabled
    ? "Desactive Realtime pour utiliser ce mode."
    : "Maintiens le bouton pendant que tu parles.";
  const pushToTalkBottomOffset =
    useCompactPhoneControls && !aiTrainingAutoStart
      ? moreActionsOpen
        ? "calc(env(safe-area-inset-bottom, 0px) + 13rem)"
        : "calc(env(safe-area-inset-bottom, 0px) + 9.25rem)"
      : "1.5rem";
  const pushToTalkOverlay =
    captionsEnabled && !aiPartnerActive && !(useCompactPhoneControls && moreActionsOpen) ? (
      <div
        className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4"
        style={{ bottom: pushToTalkBottomOffset }}
      >
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={handlePushToTalkPointerDown}
          onPointerMove={handlePushToTalkPointerMove}
          onPointerUp={handlePushToTalkPointerEnd}
          onPointerCancel={(event) => handlePushToTalkPointerEnd(event, true)}
          onTouchStart={(event) => {
            event.preventDefault();
            startPushToTalkRecognition();
          }}
          onTouchEnd={(event) => {
            event.preventDefault();
            handlePushToTalkPointerEnd();
          }}
          onTouchCancel={(event) => {
            event.preventDefault();
            handlePushToTalkPointerEnd(undefined, true);
          }}
          onMouseDown={startPushToTalkRecognition}
          onMouseUp={() => handlePushToTalkPointerEnd()}
          onMouseLeave={() => {
            if (!pushToTalkPressedRef.current) return;
            handlePushToTalkPointerEnd(undefined, true);
          }}
          disabled={pushToTalkDisabled}
          className={`pointer-events-auto inline-flex min-h-11 w-full max-w-88 items-center justify-center gap-2 rounded-full border px-5 py-3 text-[13px] font-semibold shadow-2xl ring-1 ring-black/40 ${
            pushToTalkActive
              ? "border-rose-200! bg-rose-600! text-white!"
              : pushToTalkBusy
              ? "border-sky-200! bg-sky-600! text-white!"
              : "border-emerald-200! bg-emerald-700! text-white! hover:bg-emerald-600!"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title={pushToTalkTitle}
          aria-label={ui.holdToTalk}
          style={{
            backgroundColor: pushToTalkActive
              ? "rgba(225, 29, 72, 0.95)"
              : pushToTalkBusy
              ? "rgba(2, 132, 199, 0.95)"
              : "rgba(4, 120, 87, 0.95)",
            color: "#ffffff",
            borderColor: "rgba(226, 232, 240, 0.95)",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        >
          <Mic className="h-4 w-4" />
          <span>
            {pushToTalkActive
              ? ui.releaseToTranslate
              : pushToTalkBusy
              ? ui.translating
              : ui.holdToTalk}
          </span>
        </button>
      </div>
    ) : null;
  const translationLanguageControls = (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-slate-100">{ui.spokenLanguage}</span>
        <select
          value={sourceLanguage}
          onChange={(event) =>
            onChangeSourceLanguage(event.target.value as SourceLanguageOption["code"])
          }
          disabled={translationControlsDisabled}
          className="rounded-md border border-slate-500 bg-slate-900 px-2 py-2 text-[11px] text-slate-100"
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            color: "#f8fafc",
            borderColor: "rgba(100, 116, 139, 0.85)",
          }}
        >
          {SOURCE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {`${option.name} (${option.label})`}
            </option>
          ))}
        </select>
      </label>
      {!isChatSession && !aiTrainingAutoStart && (
        <button
          type="button"
          onClick={onToggleGuestTts}
          disabled={translationControlsDisabled}
          className={`inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-full border px-3 py-2 text-[12px] font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-55 ${
            guestTtsEnabled
              ? "border-sky-300/80 bg-sky-600/90 text-white"
              : "border-slate-500/70 bg-slate-800/80 text-slate-100"
          }`}
          title="Active la voix traduite locale pour s'exercer."
          style={{
            backgroundColor: guestTtsEnabled
              ? "rgba(2, 132, 199, 0.95)"
              : "rgba(15, 23, 42, 0.95)",
            color: "#ffffff",
            borderColor: guestTtsEnabled
              ? "rgba(125, 211, 252, 0.95)"
              : "rgba(148, 163, 184, 0.85)",
          }}
        >
          <Volume2 className="h-4 w-4" />
          <span>
            {ui.localPlayback}:{" "}
            {translationControlsDisabled ? ui.blocked : guestTtsEnabled ? "ON" : "OFF"}
          </span>
        </button>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-slate-100">
          {guestTtsEnabled ? ui.communicationLanguage : ui.personalReceptionLanguage}
        </span>
        <select
          value={localReceptionTarget}
          onChange={(event) =>
            handleLocalReceptionTargetChange(event.target.value as CaptionTarget)
          }
          disabled={translationControlsDisabled}
          className="rounded-md border border-slate-500 bg-slate-900 px-2 py-2 text-[11px] text-slate-100"
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            color: "#f8fafc",
            borderColor: "rgba(100, 116, 139, 0.85)",
          }}
        >
          {CAPTION_TARGETS_CONFIG.map((target) => (
            <option key={target.code} value={target.code}>
              {`${target.name} (${target.label})`}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-flex items-center gap-1">
        <span className="text-[10px] text-slate-300">{ui.info}</span>
        <InfoBubble text={localReceptionHint} label={ui.receptionInfoLabel} align="right" />
      </div>
    </div>
  );
  const compactFooterRoleLabel = isHost ? ui.hostSection : locale === "fr" ? "Invite" : "Guest";
  const compactFooterName = (
    localParticipant?.name ||
    localParticipant?.identity ||
    compactFooterRoleLabel
  ).trim();
  const compactConnectionQuality =
    localParticipant?.connectionQuality || ConnectionQuality.Unknown;
  const compactConnectionActiveBars =
    compactConnectionQuality === ConnectionQuality.Excellent
      ? 3
      : compactConnectionQuality === ConnectionQuality.Good
      ? 2
      : compactConnectionQuality === ConnectionQuality.Poor
      ? 1
      : 0;
  const compactConnectionLabel = locale === "fr" ? "Connexion" : "Connection";
  const languageOverlay =
    !aiPartnerActive && !useCompactPhoneControls ? (
      <div className="pointer-events-none absolute left-3 top-3 z-30 w-[min(18rem,calc(100%-1.5rem))]">
        <details
          onClick={(event) => event.stopPropagation()}
          className="pointer-events-auto rounded-2xl border px-3 py-2 text-[11px] text-slate-100 shadow-xl backdrop-blur"
          style={{
            backgroundColor: "rgba(2, 6, 23, 0.9)",
            color: "#f8fafc",
            borderColor: "rgba(100, 116, 139, 0.8)",
          }}
        >
          <summary className="cursor-pointer select-none font-semibold text-slate-100">
            {ui.translationLanguages}
          </summary>
          <div className="mt-3">{translationLanguageControls}</div>
        </details>
      </div>
    ) : null;
  const compactPhoneActionMenu =
    useCompactPhoneControls && !aiPartnerActive && !aiTrainingAutoStart ? (
      <div className="pointer-events-none absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col items-start gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setMoreActionsOpen((value) => !value);
          }}
          className="pointer-events-auto inline-flex min-h-11 items-center justify-center rounded-full border border-slate-600/80 bg-slate-950/90 px-3 py-2 text-slate-100 shadow-xl backdrop-blur"
          aria-label={ui.moreActionsAria}
        >
          <Menu className="h-5 w-5" />
        </button>
        {moreActionsOpen && (
          <div
            className="pointer-events-auto w-full rounded-2xl border border-slate-700/80 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                {ui.more}
              </p>
              <button
                type="button"
                onClick={() => setMoreActionsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-100"
                aria-label={ui.close}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-2xl border border-sky-500/35 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-50 shadow-sm">
              <div className="font-semibold text-sky-100">
                {isChatSession ? ui.translationRemaining : ui.translationRemainingHost}
                {translationRemainingLabel}
              </div>
              {!effectiveTranslationEnabled && (
                <div className="mt-2">
                  {translationController ? (
                    <button
                      type="button"
                      onClick={openCreditsTopUpFromCall}
                      className="inline-flex items-center rounded-full border border-amber-200/70 bg-amber-100/12 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-50 transition hover:bg-amber-100/20"
                    >
                      {ui.topUpNow}
                    </button>
                  ) : (
                    <div className="text-[10px] font-semibold text-amber-100/90">
                      {ui.askHostToTopUp}
                    </div>
                  )}
                </div>
              )}
            </div>
            <details className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2">
              <summary className="cursor-pointer list-none text-[12px] font-semibold text-slate-100">
                {ui.translationLanguages}
              </summary>
              <div className="mt-3">{translationLanguageControls}</div>
            </details>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <TrackToggle
                source={Track.Source.Microphone}
                showIcon={false}
                disabled={isHost && !shareMicToGuests}
              >
                {isMicrophoneEnabled ? (
                  <Mic className="h-4 w-4 text-slate-100" />
                ) : (
                  <MicOff className="h-4 w-4 text-red-300" />
                )}
                <span className="text-slate-100">{ui.microphone}</span>
              </TrackToggle>
              <button
                type="button"
                onClick={toggleCamera}
                disabled={isTogglingCamera}
                className="lk-button"
                aria-label={isCameraEnabled ? ui.disableCameraAria : ui.enableCameraAria}
              >
                {isCameraEnabled ? (
                  <Camera className="h-4 w-4 text-slate-100" />
                ) : (
                  <CameraOff className="h-4 w-4 text-red-300" />
                )}
                <span className="text-slate-100">
                  {isTogglingCamera ? ui.cameraBusy : ui.camera}
                </span>
              </button>
              <button
                type="button"
                onClick={handleLeaveRoom}
                className="lk-disconnect-button bg-rose-600/90! text-white! hover:bg-rose-600!"
              >
                <LogOut className="h-4 w-4" />
                <span>{ui.leave}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleScreenShare}
                className={`lk-button ${isScreenSharing ? "bg-sky-600" : ""}`}
              >
                <ScreenShare className="h-4 w-4 text-slate-100" />
                <span className="text-slate-100">{ui.screen}</span>
              </button>
              <button
                type="button"
                onClick={flipCamera}
                disabled={!isCameraEnabled || isFlippingCamera}
                className="lk-button"
              >
                <SwitchCamera className="h-4 w-4 text-slate-100" />
                <span className="text-slate-100">{ui.flip}</span>
              </button>
              {isHost ? (
                <button
                  type="button"
                  onClick={() => {
                    setInviteOpen(true);
                    setMoreActionsOpen(false);
                  }}
                  className="lk-button"
                >
                  <Share2 className="h-4 w-4" />
                  <span>{ui.share}</span>
                </button>
              ) : (
                <div />
              )}
              {isHost && (
                <button
                  type="button"
                  onClick={() => {
                    void handleEndRoomForAll();
                    setMoreActionsOpen(false);
                  }}
                  disabled={endingRoomForAll}
                  className="lk-button"
                >
                  <Power className="h-4 w-4" />
                  <span>{endingRoomForAll ? ui.ending : ui.endShort}</span>
                </button>
              )}
            </div>
            {(inviteCopied || endRoomError) && (
              <div className="mt-3 space-y-2">
                {inviteCopied ? (
                  <div className="rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-semibold text-emerald-100">
                    {getInviteCopiedLabel(inviteCopied, locale)}
                  </div>
                ) : null}
                {endRoomError ? (
                  <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-[11px] font-semibold text-rose-100">
                    {endRoomError}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div
      className="lk-video-conference"
      data-auto-frame={autoFrame ? "true" : "false"}
      data-video-fit={videoFit}
      data-unmirror-local-preview={backgroundMode === "ai" ? "true" : "false"}
    >
      <div
        className="lk-video-conference-inner"
        onClick={() => {
          if (lockControlsToggleInAiMode) return;
          setControlsHidden((value) => !value);
        }}
      >
        <AnnotationLayer
          overlayRef={overlayRef}
          drawingEnabled={drawingEnabled}
          setDrawingEnabled={setDrawingEnabled}
          brushColor={brushColor}
          setBrushColor={setBrushColor}
          brushWidth={brushWidth}
          setBrushWidth={setBrushWidth}
          handleAnnotationStart={handleAnnotationStart}
          handleAnnotationMove={handleAnnotationMove}
          stopAnnotation={stopAnnotation}
          undoAnnotation={undoAnnotation}
          clearAnnotations={clearAnnotations}
          onAnnotationStop={handleAnnotationStop}
          onAnnotationUndo={handleAnnotationUndo}
            onAnnotationClear={handleAnnotationClear}
            onAnnotationText={handleAnnotationTextMobile}
            isHost={isHost}
            drawerOpen={isSettingsOpen}
          />
        <TimerOverlay timerState={timerState} />
        {audioUnlockRequired && (
          <div className="absolute right-3 top-3 z-40">
            <button
              type="button"
              onClick={() => {
                void activateRoomAudio();
              }}
              className="rounded-full border border-amber-300/80 bg-amber-500/95 px-3 py-1 text-[11px] font-semibold text-slate-950 shadow-lg"
            >
              Activer audio
            </button>
          </div>
        )}
        {compactPhoneActionMenu}
        {showMobileBadge && (
          <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-sky-400/60 bg-sky-500/20 px-3 py-1 text-[11px] text-sky-100">
            Mobile layout ON
          </div>
        )}
        {!widgetState.showChat && roomChat.toastMessage && (
          <div className="absolute left-1/2 top-11 z-30 -translate-x-1/2 rounded-full border border-sky-300/70 bg-slate-900/95 px-3 py-1 text-[11px] text-sky-100 shadow-lg">
            {roomChat.toastMessage}
          </div>
        )}
        {showCaptionStack && (
          <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-20 flex justify-center px-4">
            <div
              className={`max-w-3xl rounded-xl border border-sky-300/70 bg-slate-950/90 px-4 py-2 text-center text-slate-50 shadow-lg backdrop-blur ${
                captionSize === "lg"
                  ? "text-[16px]"
                  : captionSize === "md"
                  ? "text-[14px]"
                  : "text-[12px]"
              }`}
            >
              <p>{captionText}</p>
              {exercisePhoneticEnabled && captionPhoneticText && (
                <p className="mt-1 text-[11px] italic text-violet-100/95">
                  Phonetique: {captionPhoneticText}
                </p>
              )}
            </div>
          </div>
        )}
        {aiPartnerActive ? (
          <AiPartnerAvatarStage
            roomId={roomId}
            sourceLanguageCode={sourceLanguage}
            sourceLanguageName={sourceLanguageName}
            spokenLanguageCode={activeSpeechLanguageCode}
            spokenLanguageName={activeSpeechLanguageName}
            targetLanguageName={captionDisplayTargetName}
            sourceText={sourceText}
            userTranslatedText={captionText}
            userPhoneticText={captionPhoneticText}
            coachText={aiPartnerDisplayText}
            coachSourceText={aiPartnerLastReply}
            coachTranslatedText={aiPartnerLastTranslatedReply}
            coachFeedbackSourceText={aiPartnerFeedbackSource}
            coachFeedbackFrenchText={aiPartnerFeedbackFrench}
            coachFeedback={aiPartnerFeedbackDisplay}
            coachHelpView={aiPartnerFeedbackView}
            coachHelpFrenchBusy={aiPartnerFeedbackFrenchBusy}
            canShowCoachHelpTarget={aiPartnerFeedbackHasTargetVariant}
            canShowCoachHelpSource={aiPartnerFeedbackHasSource}
            coachBusy={aiPartnerBusy}
            canToggleView={aiPartnerCanToggleView}
            view={aiPartnerView}
            avatarTheme={aiPartnerAvatarTheme}
            coachPhoneticText={aiPartnerCoachPhoneticText}
            coachPhoneticBusy={aiPartnerCoachPhoneticBusy}
            realtimeVoice={realtimeVoice}
            pushToTalkActive={pushToTalkActive}
            pushToTalkBusy={pushToTalkBusy}
            pushToTalkDisabled={
              translationControlsDisabled || !pushToTalkSupported || realtimeEnabled || isTalkieLockedByOther
            }
            pushToTalkDraftVisible={Boolean(pushToTalkDraft)}
            onReplayUserTranslation={replayAiPartnerUserTranslation}
            onReplayCoach={replayAiPartnerCoach}
            onPushToTalkPointerDown={handlePushToTalkPointerDown}
            onPushToTalkPointerMove={handlePushToTalkPointerMove}
            onPushToTalkPointerEnd={handlePushToTalkPointerEnd}
            onPushToTalkStart={startPushToTalkRecognition}
            onChangeSourceLanguage={onChangeSourceLanguage}
            respondInTrainingLanguage={respondInTrainingLanguage}
            onChangeRespondInTrainingLanguage={onChangeRespondInTrainingLanguage}
            trainingTarget={localReceptionTarget}
            onChangeTrainingTarget={handleLocalReceptionTargetChange}
            onSetCoachHelpView={setAiPartnerFeedbackView}
            onEnsureCoachHelpFrench={ensureAiPartnerFeedbackFrench}
            onToggleView={setAiPartnerView}
          />
        ) : (
          <div className="lk-focus-layout-wrapper">
            {mobileView === "mosaic" ? (
              <div className="bf-iphone-mosaic relative" onClick={(event) => event.stopPropagation()}>
                {languageOverlay}
                {cameraTracks.map((track) => (
                  <button
                    key={trackKey(track)}
                    type="button"
                    className="bf-iphone-mosaic-tile"
                    onClick={(event) => {
                      event.stopPropagation();
                      manualFocusRef.current = true;
                      setFocusTrackId(trackKey(track));
                      setMobileView("focus");
                    }}
                  >
                    <ParticipantTile trackRef={track} />
                  </button>
                ))}
                {pushToTalkOverlay}
              </div>
            ) : (
              <div className="bf-iphone-layout relative" onClick={(event) => event.stopPropagation()}>
                {languageOverlay}
                <div
                  className="bf-iphone-focus"
                  onClick={() => {
                    if (!canMosaic) return;
                    manualFocusRef.current = false;
                    setFocusTrackId(null);
                    setMobileView("mosaic");
                  }}
                >
                  {resolvedFocusTrack && <ParticipantTile trackRef={resolvedFocusTrack} />}
                </div>
                <div className="bf-iphone-strip">
                  {cameraTracks
                    .filter((track) =>
                      resolvedFocusTrack ? trackKey(track) !== trackKey(resolvedFocusTrack) : true
                    )
                    .map((track) => (
                      <button
                        key={trackKey(track)}
                        type="button"
                        className="bf-iphone-thumb"
                        onClick={(event) => {
                          event.stopPropagation();
                          manualFocusRef.current = true;
                          setFocusTrackId(trackKey(track));
                          setMobileView("focus");
                        }}
                      >
                        <ParticipantTile trackRef={track} />
                      </button>
                    ))}
                </div>
                {pushToTalkOverlay}
              </div>
            )}
          </div>
        )}
        <div
          className={
            controlsHidden
              ? "hidden"
              : useCompactPhoneControls
              ? "relative z-20 px-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
              : "relative z-20 px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
          }
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className={`bf-mobile-controls-shell overflow-y-auto border border-slate-700/80 bg-slate-950/90 shadow-xl backdrop-blur ${
              useCompactPhoneControls
                ? "max-h-[28dvh] rounded-[1.35rem] p-2"
                : "max-h-[52dvh] rounded-2xl p-2.5"
            }`}
          >
            <div className="bf-mobile-controls flex border-0! bg-transparent! p-0! flex-col gap-2">
              {useCompactPhoneControls && (
                <div className="flex items-center justify-between gap-3 rounded-[1.05rem] border border-slate-700/80 bg-slate-900/75 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      {compactFooterRoleLabel}
                    </p>
                    <p className="truncate text-[12px] font-semibold text-slate-100">
                      {compactFooterName}
                    </p>
                  </div>
                  <div
                    className="flex items-end gap-1"
                    aria-label={`${compactConnectionLabel}: ${compactConnectionQuality}`}
                  >
                    {[0, 1, 2].map((barIndex) => (
                      <span
                        key={barIndex}
                        className={`w-1.5 rounded-full ${
                          barIndex < compactConnectionActiveBars
                            ? compactConnectionQuality === ConnectionQuality.Excellent
                              ? "bg-emerald-400"
                              : compactConnectionQuality === ConnectionQuality.Good
                              ? "bg-amber-400"
                              : "bg-rose-400"
                            : "bg-slate-700"
                        }`}
                        style={{ height: `${0.55 + barIndex * 0.28}rem` }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!aiTrainingAutoStart && !useCompactPhoneControls && (
                <>
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isHost && (
                        <button
                          onClick={() => setInviteOpen(true)}
                          className="lk-button"
                          aria-label={ui.shareAria}
                        >
                          <Share2 className="h-4 w-4" />
                          <span className="hidden sm:inline">{ui.share}</span>
                        </button>
                      )}
                      {isHost && inviteCopied && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                          {getInviteCopiedLabel(inviteCopied, locale)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isHost && (
                        <button
                          type="button"
                          onClick={handleEndRoomForAll}
                          disabled={endingRoomForAll}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold shadow-md transition disabled:cursor-not-allowed disabled:opacity-60"
                          style={{
                            backgroundColor: "rgba(190, 24, 93, 0.95)",
                            color: "#ffffff",
                            borderColor: "rgba(253, 164, 175, 0.95)",
                          }}
                        >
                          <Power className="h-4 w-4" />
                          <span className="text-[10px] sm:text-xs">
                            {endingRoomForAll ? ui.ending : ui.endShort}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleLeaveRoom}
                        className="lk-disconnect-button bg-rose-600/90! text-white! hover:bg-rose-600!"
                      >
                        <LogOut className="h-4 w-4" />
                        <span className="hidden sm:inline">{ui.leave}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex w-full flex-wrap items-center justify-center gap-1 sm:gap-2">
                    <TrackToggle
                      source={Track.Source.Microphone}
                      showIcon={false}
                      disabled={isHost && !shareMicToGuests}
                    >
                      {isMicrophoneEnabled ? (
                        <Mic className="h-4 w-4 text-slate-100" />
                      ) : (
                        <MicOff className="h-4 w-4 text-red-300" />
                      )}
                      <span className="hidden text-slate-100 sm:inline">{ui.microphone}</span>
                    </TrackToggle>
                    <button
                      type="button"
                      onClick={toggleCamera}
                      disabled={isTogglingCamera}
                      className="lk-button"
                      aria-label={isCameraEnabled ? ui.disableCameraAria : ui.enableCameraAria}
                    >
                      {isCameraEnabled ? (
                        <Camera className="h-4 w-4 text-slate-100" />
                      ) : (
                        <CameraOff className="h-4 w-4 text-red-300" />
                      )}
                      <span className="hidden text-slate-100 sm:inline">
                        {isTogglingCamera ? ui.cameraBusy : ui.camera}
                      </span>
                    </button>
                    <button
                      onClick={handleToggleScreenShare}
                      className={`lk-button ${isScreenSharing ? "bg-sky-600" : ""}`}
                    >
                      <ScreenShare className="h-4 w-4 text-slate-100" />
                      <span className="hidden text-slate-100 sm:inline">{ui.screen}</span>
                    </button>
                    <button
                      onClick={() =>
                        onWidgetChange({ ...widgetState, showChat: !widgetState.showChat })
                      }
                      className="lk-button"
                    >
                      <MessageCircle className="h-4 w-4 text-slate-100" />
                      <span className="hidden text-slate-100 sm:inline">{ui.chat}</span>
                    </button>
                    <button onClick={onOpenSettings} className="lk-button">
                      <Settings className="h-4 w-4 text-slate-100" />
                      <span className="hidden text-slate-100 sm:inline">{ui.settings}</span>
                    </button>
                  </div>
                </>
              )}

              {captionsEnabled && (
                <>
                  {pushToTalkGestureHint && pushToTalkActive && (
                    <div
                      className="w-full rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                      style={{
                        backgroundColor: "rgba(67, 20, 7, 0.96)",
                        color: "#ffedd5",
                        borderColor: "rgba(251, 146, 60, 0.9)",
                      }}
                    >
                      {pushToTalkGestureHint}
                    </div>
                  )}
                  {isTalkieLockedByOther && !pushToTalkActive && !pushToTalkBusy && captionsEnabled && (
                    <div
                      className="w-full rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                      style={{
                        backgroundColor: "rgba(51, 65, 85, 0.96)",
                        color: "#e2e8f0",
                        borderColor: "rgba(148, 163, 184, 0.85)",
                      }}
                    >
                      {talkieLockedMessage}
                    </div>
                  )}
                  {pushToTalkInterruptHint && captionsEnabled && (
                    <div
                      className="w-full rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                      style={{
                        backgroundColor: "rgba(7, 89, 133, 0.96)",
                        color: "#e0f2fe",
                        borderColor: "rgba(56, 189, 248, 0.85)",
                      }}
                    >
                      {pushToTalkInterruptHint}
                    </div>
                  )}
                  {pushToTalkDraft && (
                    <PushToTalkDraftModal
                      draftText={pushToTalkDraftText}
                      editing={pushToTalkDraftEditing}
                      review={pushToTalkDraftReview}
                      reviewBusy={pushToTalkDraftReviewBusy}
                      reviewMode={pushToTalkDraftReviewMode}
                      showAutoSendHint={pushToTalkDraftAutoSendEnabled}
                      notebookEnabled={aiPartnerActive && activeSpeechLanguageCode === localReceptionTarget}
                  notebookBaseText={pushToTalkDraftReview?.reviewedText || pushToTalkDraftText}
                  notebookRoomId={roomId}
                  notebookTargetLanguageCode={activeSpeechLanguageCode}
                  notebookTargetLanguageName={activeSpeechLanguageName}
                  notebookVoice={realtimeVoice}
                  onChangeText={handlePushToTalkDraftTextChange}
                  onSubmit={() => void submitPushToTalkDraft()}
                  onEdit={setPushToTalkDraftEditMode}
                      onCancel={() => cancelPushToTalkDraft("Capture annulee.")}
                      onApplySuggestion={applyPushToTalkDraftSuggestion}
                    />
                  )}
                  {sourceFromLocal && sourceText.trim() && (
                    <div
                      className="w-full rounded-lg border px-3 py-2 text-[11px] shadow-sm"
                      style={{
                        backgroundColor: "rgba(15, 23, 42, 0.96)",
                        color: "#f8fafc",
                        borderColor: "rgba(100, 116, 139, 0.8)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100">{ui.sourceCaptured}</span>
                        <span className="rounded-full border border-emerald-300/70 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                          {ui.directSpeech}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">{sourceText}</p>
                    </div>
                  )}
                  {!aiTrainingAutoStart && !useCompactPhoneControls && (
                    <div className="mt-2 inline-flex items-center">
                      <InfoBubble
                        text={ui.talkieInfo}
                        label="Info talkie mobile"
                        align="left"
                      />
                    </div>
                  )}
                  {!aiTrainingAutoStart && !useCompactPhoneControls && (
                    <div
                      className="w-full rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                      style={{
                        backgroundColor: "rgba(15, 23, 42, 0.96)",
                        color: "#f8fafc",
                        borderColor: "rgba(56, 189, 248, 0.85)",
                      }}
                    >
                      {isChatSession
                        ? ui.translationRemaining
                        : ui.translationRemainingHost}
                      {translationRemainingLabel}
                    </div>
                  )}
                </>
              )}
              {!effectiveTranslationEnabled && captionsEnabled && (
                <div
                  className="w-full rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-sm"
                  style={{
                    backgroundColor: "rgba(120, 53, 15, 0.96)",
                    color: "#fef3c7",
                    borderColor: "rgba(251, 191, 36, 0.9)",
                  }}
                >
                  <div>{translationUnavailableMessage}</div>
                  {translationController ? (
                    <button
                      type="button"
                      onClick={openCreditsTopUpFromCall}
                      className="mt-2 inline-flex items-center rounded-full border border-amber-200/70 bg-amber-100/12 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-50 transition hover:bg-amber-100/20"
                    >
                      {ui.topUpNow}
                    </button>
                  ) : (
                    <div className="mt-2 text-[10px] font-semibold text-amber-100/90">
                      {ui.askHostToTopUp}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
          {endRoomError && (
            <div className="mt-2 rounded-lg border border-rose-400/70 bg-rose-950/80 px-3 py-2 text-[11px] font-medium text-rose-100 shadow-sm">
              Fin de reunion: {endRoomError}
            </div>
          )}
          {mediaError && (
            <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              <div className="flex items-center justify-between gap-2">
                <span>Micro/camera: {mediaError}</span>
                <button
                  onClick={toggleCamera}
                  disabled={isTogglingCamera}
                  className="rounded-md border border-rose-400/60 px-2 py-1 text-[11px] text-rose-100 disabled:opacity-60"
                >
                  {isTogglingCamera ? "Camera..." : "Debloquer camera"}
                </button>
              </div>
            </div>
          )}
          {screenShareError && (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              Ecran: {screenShareError}
            </div>
          )}
          {captionError && captionsEnabled && (
            <div
              className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-medium shadow-sm"
              style={{
                backgroundColor: "rgba(120, 53, 15, 0.96)",
                color: "#fef3c7",
                borderColor: "rgba(251, 191, 36, 0.85)",
              }}
            >
              Traduction: {captionError}
            </div>
          )}
        </div>
      </div>
      <ChatDrawer
        roomId={roomId}
        isOpen={widgetState.showChat}
        onClose={() => onWidgetChange({ ...widgetState, showChat: false })}
        unreadCount={roomChat.unreadCount}
        messages={roomChat.messages}
        onSendMessage={roomChat.sendMessage}
        isSending={roomChat.isSending}
        translationEnabled={effectiveTranslationEnabled}
        translationLockMessage={effectiveTranslationLockMessage}
        onConsumeTranslationSeconds={onConsumeTranslationSeconds}
        onUnreadChange={(count) => roomChat.setUnreadCount(count)}
      />
      {!aiTrainingAutoStart && (
        <InviteDrawer
          isOpen={inviteOpen}
          onClose={() => setInviteOpen(false)}
          inviteLinks={inviteLinks}
          onShare={shareInvite}
          onCopy={copyInvite}
          copied={inviteCopied}
        />
      )}
      <ConnectionStateToast />
    </div>
  );
}

function ClickableParticipantTile({
  onSelect,
}: {
  onSelect: (trackRef: TrackReferenceOrPlaceholder) => void;
}) {
  const trackRef = useEnsureTrackRef();
  const lastTouchRef = useRef(0);

  const handleSelect = useCallback(
    (event: { type: string; stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      if (event.type === "touchend") {
        lastTouchRef.current = Date.now();
        onSelect(trackRef);
        return;
      }
      if (Date.now() - lastTouchRef.current < 500) return;
      onSelect(trackRef);
    },
    [onSelect, trackRef]
  );

  return (
    <ParticipantTile
      onClick={handleSelect}
      onTouchEnd={handleSelect}
    />
  );
}

function ChatDrawer({
  roomId,
  isOpen,
  onClose,
  unreadCount,
  onUnreadChange,
  messages,
  onSendMessage,
  isSending,
  translationEnabled,
  translationLockMessage,
  onConsumeTranslationSeconds,
}: {
  roomId: string;
  isOpen: boolean;
  onClose: () => void;
  unreadCount: number;
  onUnreadChange: (count: number) => void;
  messages: ChatMessage[];
  onSendMessage: (
    input:
      | string
      | {
          text: string;
          originalText?: string;
          translatedText?: string;
          sourceLang?: string;
          targetLang?: string;
        },
    opts?: { fromName?: string }
  ) => Promise<void>;
  isSending: boolean;
  translationEnabled: boolean;
  translationLockMessage: string;
  onConsumeTranslationSeconds: (
    seconds: number,
    origin: "local" | "remote"
  ) => Promise<boolean>;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const { localParticipant } = useLocalParticipant();
  const [draft, setDraft] = useState("");
  const [sourceLang, setSourceLang] = useState("Français");
  const [targetLang, setTargetLang] = useState("Russe");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    text: string;
    source: string;
    target: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [speakError, setSpeakError] = useState<string | null>(null);
  const speakingMessageIdRef = useRef<string | null>(null);

  const languageOptions = [
    "Arabe",
    "Anglais",
    "Chinois",
    "Espagnol",
    "Japonais",
    "Persan (Farsi)",
    "Hebreu",
    "Italien",
    "Russe",
    "Français",
  ];

  const localId = localParticipant?.identity || "";
  const localName = localParticipant?.name || "Moi";
  const isCompactChat = useIsMobileViewport(640);
  const translationBlockedMessage = translationLockMessage || TRANSLATION_UNLOCK_HINT;

  useEffect(() => {
    if (isOpen && unreadCount > 0) onUnreadChange(0);
  }, [isOpen, unreadCount, onUnreadChange]);

  useEffect(() => {
    if (!draft.trim()) {
      setPreview(null);
      setPreviewMeta(null);
      setPreviewError(null);
      return;
    }
    if (
      previewMeta &&
      (previewMeta.text !== draft.trim() ||
        previewMeta.source !== sourceLang ||
        previewMeta.target !== targetLang)
    ) {
      setPreview(null);
      setPreviewMeta(null);
    }
  }, [draft, sourceLang, targetLang, previewMeta]);

  useEffect(() => {
    speakingMessageIdRef.current = speakingMessageId;
  }, [speakingMessageId]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
    };
  }, []);

  const buildTranslatePrompt = (text: string) => {
    return [
      "Tu es un traducteur.",
      `Langue source: ${sourceLang}.`,
      `Langue cible: ${targetLang}.`,
      "Retourne un JSON strict avec la clé translated.",
      `Texte: ${text}`,
    ].join(" ");
  };

  const getAuthToken = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("Utilisateur non connecté");
    }
    return getIdToken(currentUser, true);
  };

  const translateDraft = async (text: string) => {
    if (sourceLang === targetLang) return text;
    const token = await getAuthToken();
    const messages = [
      { role: "system", content: buildTranslatePrompt(text) },
      { role: "user", content: text },
    ];
    const res = await fetch("/api/openai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Erreur traduction");
    }
    const content = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = String(content).replace(/```json|```/gi, "").trim();
    try {
      const parsed = JSON.parse(cleaned) as { translated?: string };
      return parsed.translated?.trim() || cleaned;
    } catch {
      return cleaned;
    }
  };

  const handlePreview = async () => {
    const text = draft.trim();
    if (!text) return;
    if (sourceLang !== targetLang && !translationEnabled) {
      setPreviewError(translationBlockedMessage);
      return;
    }
    try {
      setPreviewLoading(true);
      setPreviewError(null);
      const translated = await translateDraft(text);
      setPreview(translated);
      setPreviewMeta({ text, source: sourceLang, target: targetLang });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur traduction";
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    const requiresTranslation = sourceLang !== targetLang;
    if (requiresTranslation) {
      if (!translationEnabled) {
        setPreviewError(translationBlockedMessage);
        return;
      }
      const consumed = await onConsumeTranslationSeconds(
        estimateChatTranslationSeconds(text),
        "local"
      );
      if (!consumed) {
        setPreviewError(translationBlockedMessage);
        return;
      }
    }
    let translated = preview;
    const previewOk =
      preview &&
      previewMeta &&
      previewMeta.text === text &&
      previewMeta.source === sourceLang &&
      previewMeta.target === targetLang;
    if (!previewOk) {
      try {
        translated = await translateDraft(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur traduction";
        setPreviewError(message);
        return;
      }
    }
    await onSendMessage(
      {
        text,
        originalText: text,
        translatedText: translated ?? text,
        sourceLang,
        targetLang,
      },
      { fromName: localName }
    );
    setDraft("");
    setPreview(null);
    setPreviewMeta(null);
  };

  const handlePlayTranslation = useCallback((message: ChatMessage, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      setSpeakError("Lecture audio indisponible sur ce navigateur.");
      return;
    }
    const speech = window.speechSynthesis;
    if (speakingMessageIdRef.current === message.id) {
      speech.cancel();
      speakingMessageIdRef.current = null;
      setSpeakingMessageId(null);
      return;
    }

    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(trimmed);
    const locale = resolveSpeechLocaleFromLanguage(
      message.targetLang || message.sourceLang
    );
    if (locale) {
      utterance.lang = locale;
    }

    const voices = speech.getVoices();
    if (locale && voices.length > 0) {
      const localeLower = locale.toLowerCase();
      const localePrefix = localeLower.split("-")[0];
      const matchedVoice =
        voices.find((item) => item.lang?.toLowerCase() === localeLower) ||
        voices.find((item) => item.lang?.toLowerCase().startsWith(localePrefix));
      if (matchedVoice) {
        utterance.voice = matchedVoice;
        utterance.lang = matchedVoice.lang || utterance.lang;
      }
    }

    speakingMessageIdRef.current = message.id;
    setSpeakingMessageId(message.id);
    setSpeakError(null);
    utterance.onend = () => {
      if (speakingMessageIdRef.current !== message.id) return;
      speakingMessageIdRef.current = null;
      setSpeakingMessageId(null);
    };
    utterance.onerror = () => {
      if (speakingMessageIdRef.current !== message.id) return;
      speakingMessageIdRef.current = null;
      setSpeakingMessageId(null);
      setSpeakError("Lecture audio indisponible temporairement. Reessaie.");
    };
    speech.speak(utterance);
  }, []);

  const visibleMessages = messages.filter((msg) => msg.to === "all");

  return (
    <div
      className={`fixed inset-0 z-40 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-96 flex flex-col bg-slate-950 text-slate-100 shadow-2xl border-t border-slate-800 sm:border-l sm:border-t-0 transition-transform ${
          isOpen
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-x-full"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{ui.chat}</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] text-white">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            {isCompactChat ? ui.returnLabel : ui.close}
          </button>
        </div>

        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-slate-400">
            {ui.messagesVisible}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            <span>{ui.writeIn}</span>
            <select
              value={sourceLang}
              onChange={(event) => setSourceLang(event.target.value)}
              className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              {languageOptions.map((option) => (
                <option key={`src-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span>→</span>
            <select
              value={targetLang}
              onChange={(event) => setTargetLang(event.target.value)}
              className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
            >
              {languageOptions.map((option) => (
                <option key={`dst-${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {visibleMessages.length === 0 ? (
            <p className="text-xs text-slate-500">{ui.noMessages}</p>
          ) : (
            <div className="space-y-3">
              {visibleMessages.map((msg) => {
                const isLocal = msg.from === localId;
                const mainText = isLocal
                  ? msg.originalText || msg.text
                  : msg.translatedText || msg.text;
                const subText = isLocal
                  ? msg.translatedText
                  : msg.originalText;
                const speechText = (msg.translatedText || mainText || "").trim();
                const isSpeaking = speakingMessageId === msg.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isLocal ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                        isLocal
                          ? "bg-sky-500 text-white"
                          : "bg-slate-800 text-slate-100"
                      }`}
                    >
                      {!isLocal && (
                        <p className="mb-1 text-[10px] text-slate-300">
                          {msg.fromName || msg.from}
                        </p>
                      )}
                      <p>{mainText}</p>
                      {subText && subText !== mainText && (
                        <p className="mt-1 text-[10px] text-slate-300/80">
                          {subText}
                        </p>
                      )}
                      {speechText && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handlePlayTranslation(msg, speechText)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
                              isLocal
                                ? "border-white/50 bg-white/15 text-white hover:bg-white/25"
                                : "border-slate-600 bg-slate-700/70 text-slate-100 hover:bg-slate-700"
                            }`}
                          >
                            <Volume2 className="h-3 w-3" />
                            {isSpeaking ? ui.stop : ui.listen}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 bg-slate-950 p-3">
          {preview && (
            <div className="mb-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-200">
              <span className="text-slate-400">{ui.sentTranslation}</span> {preview}
            </div>
          )}
          {previewError && (
            <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {previewError}
            </div>
          )}
          {speakError && (
            <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {speakError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={ui.writeMessagePlaceholder}
              className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
            />
            <button
              onClick={handlePreview}
              disabled={previewLoading || !draft.trim()}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-50"
            >
              {previewLoading ? "..." : ui.preview}
            </button>
            <button
              onClick={handleSend}
              disabled={isSending || !draft.trim()}
              className="rounded-lg bg-sky-500 px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              {ui.send}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InviteDrawer({
  isOpen,
  onClose,
  inviteLinks,
  onShare,
  onCopy,
  copied,
}: {
  isOpen: boolean;
  onClose: () => void;
  inviteLinks: InviteLinks;
  onShare: () => void;
  onCopy: (kind: InviteLinkKind) => void;
  copied: InviteCopyFeedback | null;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const shareBody = `${ui.inviteEmailBody}\n\n${inviteLinks.smart}`;
  const mailHref = buildMailtoHref(ui.inviteEmailSubject, shareBody);
  const smsHref = buildSmsHref(shareBody);
  const canUseNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div
      className={`fixed inset-0 z-40 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-slate-950 text-slate-100 shadow-2xl border-t border-slate-800 transition-transform ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <p className="text-sm font-semibold">{ui.shareRoom}</p>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            {ui.close}
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            {ui.smartHint}
          </p>
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-xs font-semibold text-slate-100">{ui.smartLink}</p>
            <p className="text-[11px] text-slate-400">
              {ui.smartHint}
            </p>
            <input
              value={inviteLinks.smart}
              readOnly
              onFocus={(event) => event.target.select()}
              className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
            />
            <p className="text-[11px] text-slate-400">{ui.shareOptionsHint}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {canUseNativeShare && (
                <button
                  onClick={onShare}
                  className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/25"
                >
                  {copied === "shared" ? ui.inviteShareSent : ui.shareViaDevice}
                </button>
              )}
              <a
                href={mailHref}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-center text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25"
              >
                {ui.sendEmail}
              </a>
              <a
                href={smsHref}
                className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-center text-xs font-semibold text-amber-100 hover:bg-amber-500/25"
              >
                {ui.sendSms}
              </a>
              <button
                onClick={() => onCopy("smart")}
                className="rounded-md bg-sky-500 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-400"
              >
                {copied === "smart" ? ui.linkCopied : ui.copyLink}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsDrawer({
  roomId,
  isHost,
  isOpen,
  onClose,
  autoFrame,
  onToggleAutoFrame,
  captionsEnabled,
  captionsSupported,
  onToggleCaptions,
  captionTarget,
  onChangeCaptionTarget,
  sourceLanguage,
  onChangeSourceLanguage,
  ttsEnabled,
  onToggleTts,
  realtimeEnabled,
  realtimeAvailable,
  realtimeVoice,
  onChangeRealtimeVoice,
  onToggleRealtime,
  realtimeStatus,
  realtimeError,
  hostLocalTtsEnabled,
  onToggleHostLocalTts,
  shareMicToGuests,
  onToggleShareMicToGuests,
  guestCaptionTarget,
  guestTtsEnabled,
  guestTtsDisabled,
  onToggleGuestTts,
  ttsError,
  captionSize,
  onChangeCaptionSize,
  videoFit,
  onChangeVideoFit,
  backgroundMode,
  onChangeBackground,
  backgroundDisabled,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiBackgroundUrl,
  onAiImageGenerated,
  onSaveAiBackground,
  onAiBackgroundClear,
  aiGallery,
  onAiGallerySelect,
  onRefreshTranslationEntitlement,
}: {
  roomId: string;
  isHost: boolean;
  isOpen: boolean;
  onClose: () => void;
  autoFrame: boolean;
  onToggleAutoFrame: () => void;
  captionsEnabled: boolean;
  captionsSupported: boolean;
  onToggleCaptions: () => void;
  captionTarget: CaptionTarget;
  onChangeCaptionTarget: (target: CaptionTarget) => void;
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  realtimeEnabled: boolean;
  realtimeAvailable: boolean;
  realtimeVoice: string;
  onChangeRealtimeVoice: (voice: string) => void;
  onToggleRealtime: () => void;
  realtimeStatus: RealtimeStatus;
  realtimeError: string;
  hostLocalTtsEnabled: boolean;
  onToggleHostLocalTts: () => void;
  shareMicToGuests: boolean;
  onToggleShareMicToGuests: () => void;
  guestCaptionTarget: CaptionTarget;
  guestTtsEnabled: boolean;
  guestTtsDisabled: boolean;
  onToggleGuestTts: () => void;
  ttsError: string;
  captionSize: "sm" | "md" | "lg";
  onChangeCaptionSize: (size: "sm" | "md" | "lg") => void;
  videoFit: "cover" | "contain";
  onChangeVideoFit: (fit: "cover" | "contain") => void;
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  backgroundDisabled: boolean;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  onAiBackgroundClear: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  onRefreshTranslationEntitlement: () => Promise<void> | void;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
  const [isMobile, setIsMobile] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(true);
  const [mobileSection, setMobileSection] = useState<"camera" | "host">("camera");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  const mobileSections = [
    { id: "camera", label: ui.cameraSection },
    { id: "host", label: ui.hostSection },
  ] as const;

  return (
    <div
      className={`fixed inset-0 z-30 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 sm:top-0 sm:left-auto sm:right-0 sm:h-full sm:w-80 bg-slate-950 text-slate-100 shadow-2xl border-t border-slate-800 sm:border-l sm:border-t-0 transition-transform ${
          isOpen
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <p className="text-sm font-semibold">{ui.settingsTitle}</p>
            <p className="text-[10px] text-slate-400">BFZoom v{appVersion}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            {ui.close}
          </button>
        </div>

        <div className="px-4 py-3 space-y-4 overflow-y-auto max-h-[70vh] sm:max-h-full">
          {isMobile && isHost ? (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {mobileSections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setMobileSection(section.id)}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                      mobileSection === section.id
                        ? "bg-sky-500 text-white"
                        : "border border-slate-700 text-slate-200"
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
              {mobileSection === "camera" && (
                <CameraSection
                  autoFrame={autoFrame}
                  onToggleAutoFrame={onToggleAutoFrame}
                  isHost={isHost}
                  captionsEnabled={captionsEnabled}
                  captionsSupported={captionsSupported}
                  onToggleCaptions={onToggleCaptions}
                  captionTarget={captionTarget}
                  onChangeCaptionTarget={onChangeCaptionTarget}
                  sourceLanguage={sourceLanguage}
                  onChangeSourceLanguage={onChangeSourceLanguage}
                  ttsEnabled={ttsEnabled}
                  onToggleTts={onToggleTts}
                  realtimeEnabled={realtimeEnabled}
                  realtimeAvailable={realtimeAvailable}
                  realtimeVoice={realtimeVoice}
                  onChangeRealtimeVoice={onChangeRealtimeVoice}
                  onToggleRealtime={onToggleRealtime}
                  realtimeStatus={realtimeStatus}
                  realtimeError={realtimeError}
                  hostLocalTtsEnabled={hostLocalTtsEnabled}
                  onToggleHostLocalTts={onToggleHostLocalTts}
                  shareMicToGuests={shareMicToGuests}
                  onToggleShareMicToGuests={onToggleShareMicToGuests}
                  ttsError={ttsError}
                  captionSize={captionSize}
                  onChangeCaptionSize={onChangeCaptionSize}
                  videoFit={videoFit}
                  onChangeVideoFit={onChangeVideoFit}
                  backgroundMode={backgroundMode}
                  onChangeBackground={onChangeBackground}
                  backgroundDisabled={backgroundDisabled}
                  customBackgrounds={customBackgrounds}
                  onAddCustomBackground={onAddCustomBackground}
                  onRemoveCustomBackground={onRemoveCustomBackground}
                  aiBackgroundUrl={aiBackgroundUrl}
                  onAiImageGenerated={onAiImageGenerated}
                  onSaveAiBackground={onSaveAiBackground}
                  onAiBackgroundClear={onAiBackgroundClear}
                  aiGallery={aiGallery}
                  onAiGallerySelect={onAiGallerySelect}
                  onRefreshTranslationEntitlement={onRefreshTranslationEntitlement}
                />
              )}
              {mobileSection === "host" && <LiveKitHostSection roomId={roomId} />}
            </>
          ) : (
            <>
              <SectionHeader
                title={ui.cameraSection}
                isOpen={cameraOpen}
                onToggle={() => setCameraOpen((value) => !value)}
              />
              {cameraOpen && (
                <CameraSection
                  autoFrame={autoFrame}
                  onToggleAutoFrame={onToggleAutoFrame}
                  isHost={isHost}
                  captionsEnabled={captionsEnabled}
                  captionsSupported={captionsSupported}
                  onToggleCaptions={onToggleCaptions}
                  captionTarget={captionTarget}
                  onChangeCaptionTarget={onChangeCaptionTarget}
                  sourceLanguage={sourceLanguage}
                  onChangeSourceLanguage={onChangeSourceLanguage}
                  ttsEnabled={ttsEnabled}
                  onToggleTts={onToggleTts}
                  realtimeEnabled={realtimeEnabled}
                  realtimeAvailable={realtimeAvailable}
                  realtimeVoice={realtimeVoice}
                  onChangeRealtimeVoice={onChangeRealtimeVoice}
                  onToggleRealtime={onToggleRealtime}
                  realtimeStatus={realtimeStatus}
                  realtimeError={realtimeError}
                  hostLocalTtsEnabled={hostLocalTtsEnabled}
                  onToggleHostLocalTts={onToggleHostLocalTts}
                  shareMicToGuests={shareMicToGuests}
                  onToggleShareMicToGuests={onToggleShareMicToGuests}
                  ttsError={ttsError}
                  captionSize={captionSize}
                  onChangeCaptionSize={onChangeCaptionSize}
                  videoFit={videoFit}
                  onChangeVideoFit={onChangeVideoFit}
                  backgroundMode={backgroundMode}
                  onChangeBackground={onChangeBackground}
                  backgroundDisabled={backgroundDisabled}
                  customBackgrounds={customBackgrounds}
                  onAddCustomBackground={onAddCustomBackground}
                  onRemoveCustomBackground={onRemoveCustomBackground}
                  aiBackgroundUrl={aiBackgroundUrl}
                  onAiImageGenerated={onAiImageGenerated}
                  onSaveAiBackground={onSaveAiBackground}
                  onAiBackgroundClear={onAiBackgroundClear}
                  aiGallery={aiGallery}
                  onAiGallerySelect={onAiGallerySelect}
                  onRefreshTranslationEntitlement={onRefreshTranslationEntitlement}
                />
              )}

              {!isHost && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
                  <p className="font-semibold text-slate-100">{ui.hostOptions}</p>
                  <p className="mt-1 text-slate-300">
                    {ui.hostReserved}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-400">
                    {ui.hostLinkHint}
                  </p>
                </div>
              )}

              {isHost && (
                <>
                  <SectionHeader
                    title={ui.hostSection}
                    isOpen={hostOpen}
                    onToggle={() => setHostOpen((value) => !value)}
                  />
                  {hostOpen && <LiveKitHostSection roomId={roomId} />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  isOpen,
  onToggle,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</p>
      <button
        onClick={onToggle}
        className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
      >
        {isOpen ? ui.collapse : ui.open}
      </button>
    </div>
  );
}

function BackgroundSection({
  isHost,
  backgroundMode,
  onChangeBackground,
  disabled,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiBackgroundUrl,
  onAiImageGenerated,
  onSaveAiBackground,
  onAiBackgroundClear,
  aiGallery,
  onAiGallerySelect,
  onRefreshTranslationEntitlement,
}: {
  isHost: boolean;
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  disabled: boolean;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  onAiBackgroundClear: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  onRefreshTranslationEntitlement: () => Promise<void> | void;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPromptText, setAiPromptText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [latestAiImage, setLatestAiImage] = useState<string | null>(null);
  const [latestAiPrompt, setLatestAiPrompt] = useState("");
  const [brokenAiImageUrls, setBrokenAiImageUrls] = useState<Set<string>>(new Set());
  const [aiStatus, setAiStatus] = useState<"idle" | "pending" | "processing" | "complete" | "error">(
    "idle"
  );
  const aiControllerRef = useRef<AbortController | null>(null);
  const aiPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifiedAiImageUrlsRef = useRef<Set<string>>(new Set());

  const rememberBrokenAiImageUrl = useCallback((url: string | null | undefined) => {
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return;
    setBrokenAiImageUrls((prev) => {
      if (prev.has(trimmed)) return prev;
      const next = new Set(prev);
      next.add(trimmed);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(BROKEN_AI_IMAGE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const next = new Set(
        parsed
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      );
      if (next.size > 0) {
        setBrokenAiImageUrls(next);
      }
    } catch {
      // ignore corrupt persisted cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (brokenAiImageUrls.size === 0) {
        window.localStorage.removeItem(BROKEN_AI_IMAGE_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(
        BROKEN_AI_IMAGE_STORAGE_KEY,
        JSON.stringify(Array.from(brokenAiImageUrls))
      );
    } catch {
      // ignore storage write failures
    }
  }, [brokenAiImageUrls]);

  const prunePersistedBrokenAiImage = useCallback((url: string) => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(AI_GALLERY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AiGalleryItem[];
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter((entry) => entry?.image !== url);
      if (filtered.length === parsed.length) return;
      if (filtered.length === 0) {
        window.localStorage.removeItem(AI_GALLERY_STORAGE_KEY);
      } else {
        window.localStorage.setItem(AI_GALLERY_STORAGE_KEY, JSON.stringify(filtered));
      }
    } catch {
      // ignore corrupt gallery cache
    }
  }, []);

  const handleAiImageLoadError = useCallback(
    (url: string | null | undefined) => {
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (!trimmed) return;
      rememberBrokenAiImageUrl(trimmed);
      prunePersistedBrokenAiImage(trimmed);
      if (latestAiImage === trimmed) {
        setLatestAiImage(null);
      }
      if (aiBackgroundUrl === trimmed) {
        onAiBackgroundClear();
      }
      setAiError("Le fond IA n'est plus disponible. Regénère-le ou supprime-le.");
    },
    [
      aiBackgroundUrl,
      latestAiImage,
      onAiBackgroundClear,
      prunePersistedBrokenAiImage,
      rememberBrokenAiImageUrl,
      ]
  );

  const extractAiJobIdFromUrl = useCallback((url: string | null | undefined) => {
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return "";
    try {
      const parsed = new URL(trimmed, "https://bfzoom.local");
      if (!parsed.pathname.endsWith("/api/dalle/image")) return "";
      return parsed.searchParams.get("jobId")?.trim() || "";
    } catch {
      return "";
    }
  }, []);

  const isBrokenAiImageUrl = useCallback(
    (url: string | null | undefined) => {
      const trimmed = typeof url === "string" ? url.trim() : "";
      return trimmed ? brokenAiImageUrls.has(trimmed) : false;
    },
    [brokenAiImageUrls]
  );

  useEffect(() => {
    const candidates = [aiBackgroundUrl, ...aiGallery.map((item) => item.image)]
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);

    for (const url of candidates) {
      if (isBrokenAiImageUrl(url)) continue;
      if (verifiedAiImageUrlsRef.current.has(url)) continue;
      const jobId = extractAiJobIdFromUrl(url);
      if (!jobId) continue;

      verifiedAiImageUrlsRef.current.add(url);
      void fetch(`/api/dalle?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) {
            handleAiImageLoadError(url);
            return;
          }
          const data = (await response.json().catch(() => ({}))) as {
            status?: "pending" | "processing" | "complete" | "error";
            imageUrl?: string;
          };
          if (data.status === "error" || !data.imageUrl) {
            handleAiImageLoadError(url);
          }
        })
        .catch(() => {
          verifiedAiImageUrlsRef.current.delete(url);
        });
    }
  }, [aiBackgroundUrl, aiGallery, extractAiJobIdFromUrl, handleAiImageLoadError, isBrokenAiImageUrl]);

  const clearAiPolling = useCallback(() => {
    if (aiPollingRef.current) {
      clearInterval(aiPollingRef.current);
      aiPollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      aiControllerRef.current?.abort();
      aiControllerRef.current = null;
      clearAiPolling();
    };
  }, [clearAiPolling]);

  const refreshEntitlementAfterDalle = useCallback(() => {
    if (!isHost) return;
    try {
      const maybePromise = onRefreshTranslationEntitlement();
      if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
        void (maybePromise as Promise<void>).catch(() => {});
      }
    } catch {
      // Keep DALL-E UX responsive even if entitlement refresh fails.
    }
  }, [isHost, onRefreshTranslationEntitlement]);

  const buildAiPrompt = useCallback((basePrompt: string, textOverlay: string | null) => {
    const trimmedBase = basePrompt.trim();
    const overlay = textOverlay?.trim();
    const overlayInstruction = overlay
      ? `Ajoute le texte « ${overlay.replace(/"/g, "'")} » au centre, en lettres contrastees, lisibles, alignees de gauche a droite et sans effet miroir.`
      : "";
    return [trimmedBase, overlayInstruction].filter(Boolean).join(" ").trim();
  }, []);

  const extractApiErrorMessage = useCallback(
    (raw: string, status: number, fallback: string) => {
      if (!raw.trim()) return fallback;
      try {
        const parsed = JSON.parse(raw) as { error?: string; message?: string };
        const fromPayload = (parsed.error || parsed.message || "").trim();
        if (fromPayload) return fromPayload;
      } catch {}
      const compact = raw.trim().replace(/\s+/g, " ");
      const display = compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
      return display || `${fallback} (HTTP ${status})`;
    },
    []
  );

  const pollAiJobStatus = useCallback(
    async (jobId: string, prompt: string) => {
      try {
        const response = await fetch(`/api/dalle?jobId=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const message = await readApiErrorMessage(response);
          throw new Error(message || "Impossible de verifier le job.");
        }
        const data = (await response.json()) as {
          status?: "pending" | "processing" | "complete" | "error";
          imageUrl?: string;
          errorMessage?: string;
          prompt?: string;
        };
        const nextStatus = data.status || "pending";
        setAiStatus(nextStatus);
        if (nextStatus === "complete" && data.imageUrl) {
          clearAiPolling();
          const proxiedImage = `/api/dalle/image?jobId=${encodeURIComponent(jobId)}`;
          setBrokenAiImageUrls((prev) => {
            if (!prev.has(proxiedImage)) return prev;
            const next = new Set(prev);
            next.delete(proxiedImage);
            return next;
          });
          setLatestAiImage(proxiedImage);
          setLatestAiPrompt(data.prompt || prompt);
          onAiImageGenerated(proxiedImage);
          setAiLoading(false);
          setAiError("");
        } else if (nextStatus === "error") {
          clearAiPolling();
          setAiLoading(false);
          setAiError(toFriendlyAiError(data.errorMessage || "Erreur lors de la generation."));
        }
      } catch (err) {
        clearAiPolling();
        setAiLoading(false);
        setAiStatus("error");
        setLatestAiImage(null);
        setLatestAiPrompt("");
        const message = err instanceof Error ? err.message : "Erreur reseau.";
        setAiError(toFriendlyAiError(message));
      }
    },
    [clearAiPolling, onAiImageGenerated]
  );

  const startAiPolling = useCallback(
    (jobId: string, prompt: string) => {
      clearAiPolling();
      setAiStatus("pending");
      const check = () => {
        void pollAiJobStatus(jobId, prompt);
      };
      check();
      aiPollingRef.current = setInterval(check, 1500);
    },
    [clearAiPolling, pollAiJobStatus]
  );

  const handleGenerateAi = useCallback(async () => {
    if (!isHost) {
      setAiError("Generation IA reservee a l'hote.");
      return;
    }
    if (disabled) {
      setAiError("Effet indisponible sur cet appareil.");
      return;
    }
    const trimmed = aiPrompt.trim();
    if (!trimmed) {
      setAiError("Decris l'ambiance a generer.");
      return;
    }
    const fullPrompt = buildAiPrompt(trimmed, aiPromptText);
    aiControllerRef.current?.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;
    clearAiPolling();
    setAiError("");
    setLatestAiImage(null);
    setLatestAiPrompt(fullPrompt);
    setAiLoading(true);
    setAiStatus("pending");

    try {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) {
        throw new Error("Session non prete. Reconnecte-toi puis reessaie.");
      }

      const response = await fetch("/api/dalle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({ prompt: fullPrompt }),
        signal: controller.signal,
      });
      const rawPayload = await response.text();
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(
            rawPayload,
            response.status,
            `Impossible de creer la demande (HTTP ${response.status}).`
          )
        );
      }
      const payload = rawPayload ? (JSON.parse(rawPayload) as Record<string, unknown>) : {};
      if (payload.status === "error") {
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "La generation IA a echoue."
        );
      }
      if (!payload.jobId) {
        throw new Error("Aucun job id recu.");
      }
      startAiPolling(String(payload.jobId), fullPrompt);
    } catch (err) {
      if (controller.signal.aborted) return;
      setLatestAiImage(null);
      setLatestAiPrompt("");
      setAiStatus("error");
      const message = err instanceof Error ? err.message : "Erreur de generation.";
      setAiError(toFriendlyAiError(message));
      setAiLoading(false);
    } finally {
      refreshEntitlementAfterDalle();
      if (aiControllerRef.current === controller) {
        aiControllerRef.current = null;
      }
    }
  }, [
    aiPrompt,
    aiPromptText,
    buildAiPrompt,
    clearAiPolling,
    disabled,
    extractApiErrorMessage,
    isHost,
    refreshEntitlementAfterDalle,
    startAiPolling,
  ]);

  const handleSaveAiToGallery = useCallback(() => {
    if (!latestAiImage || !latestAiPrompt) return;
    onSaveAiBackground(latestAiPrompt, latestAiImage);
    setAiError("Fond enregistre dans la galerie.");
  }, [latestAiImage, latestAiPrompt, onSaveAiBackground]);

  const handleCustomFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0] ?? null;
    onAddCustomBackground(file);
    event.target.value = "";
  };
  return (
    <div className="flex flex-col gap-2">
      {isHost && (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">DALL·E</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder={ui.dallePromptPlaceholder}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleGenerateAi}
              disabled={aiLoading}
              className="rounded-lg bg-sky-500 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-60"
            >
              {aiLoading ? ui.generating : ui.generate}
            </button>
            <button
              type="button"
              onClick={handleSaveAiToGallery}
              disabled={!latestAiImage || !latestAiPrompt || aiLoading}
              className="rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-100 disabled:border-slate-800 disabled:text-slate-500"
            >
              {ui.save}
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-slate-400">{ui.overlayTextOptional}</label>
            <input
              type="text"
              value={aiPromptText}
              onChange={(event) => setAiPromptText(event.target.value)}
              placeholder={ui.overlayTextPlaceholder}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
            <p className="text-[10px] text-slate-400">
              {ui.overlayTextHint}
            </p>
          </div>
          <p className="text-[11px] text-slate-300">
            {aiError ||
              (aiStatus === "pending" || aiStatus === "processing"
                ? ui.aiGeneratingStatus
                : aiBackgroundUrl
                ? ui.aiBackgroundActiveStatus
                : ui.generateThenActivate)}
          </p>
        </div>
      )}
      {!isHost && (
        <p className="text-[11px] text-slate-400">{ui.aiGenerationHostOnly}</p>
      )}
      {disabled && (
        <p className="text-[11px] text-amber-200">
          Effets indisponibles sur iPhone/iPad dans le navigateur (WebKit). Utilise l'app iOS
          BFZoom ou un desktop compatible.
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
            {BACKGROUND_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => onChangeBackground(opt.id)}
                disabled={disabled && opt.id !== "none"}
                className={`relative overflow-hidden rounded-xl border text-[11px] px-2 py-1 ${
                  backgroundMode === opt.id
                    ? "border-sky-500 text-sky-200 bg-sky-900/40"
                    : "border-slate-700 text-slate-200 bg-slate-900/40"
                } ${disabled && opt.id !== "none" ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {opt.mode === "image" && opt.imagePath ? (
                  <span className="flex items-center gap-2">
                    {isBrokenAiImageUrl(opt.imagePath) ? (
                      <span className="flex h-6 w-10 items-center justify-center rounded-md bg-slate-800 text-[9px] text-slate-400">
                        indispo
                      </span>
                    ) : (
                      <Image
                        src={opt.imagePath}
                        alt=""
                        className="h-6 w-10 rounded-md object-cover"
                        width={160}
                        height={96}
                        unoptimized
                        onError={() => handleAiImageLoadError(opt.imagePath)}
                      />
                    )}
                    {getLocalizedBackgroundOptionLabel(opt.id, ui)}
                  </span>
                ) : (
              getLocalizedBackgroundOptionLabel(opt.id, ui)
            )}
            </button>
          ))}
        </div>
        {aiBackgroundUrl && !isBrokenAiImageUrl(aiBackgroundUrl) && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div className="relative h-12 w-12 overflow-hidden rounded-lg">
              <Image
                src={aiBackgroundUrl}
                alt=""
                className="h-12 w-12 rounded-lg object-contain"
                width={192}
                height={192}
                unoptimized
                onError={() => handleAiImageLoadError(aiBackgroundUrl)}
              />
            </div>
            <div className="flex-1 text-[11px] text-slate-200">
              {ui.aiBackgroundActiveCard}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChangeBackground("ai")}
                disabled={disabled}
                className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-white disabled:border-slate-600 disabled:text-slate-500 hover:border-slate-500"
              >
                {ui.activate}
              </button>
              <button
                type="button"
                onClick={onAiBackgroundClear}
                disabled={disabled}
                className="rounded-full border border-rose-500 px-3 py-1 text-[11px] text-rose-300 disabled:border-rose-400 disabled:text-rose-500 hover:border-rose-400"
              >
                {ui.remove}
              </button>
            </div>
          </div>
        )}
        {aiGallery.length > 0 && (
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{ui.aiGalleryTitle}</p>
            <div className="grid grid-cols-2 gap-2">
              {aiGallery.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onAiGallerySelect(item)}
                  disabled={disabled}
                  className="group flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-2 text-left transition hover:border-sky-400"
                >
                  <div className="relative h-16 w-full overflow-hidden rounded-md bg-slate-900/60">
                    {isBrokenAiImageUrl(item.image) ? (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                        image indisponible
                      </div>
                    ) : (
                      <Image
                        src={item.image}
                        alt={item.prompt}
                        className="h-16 w-full rounded-md object-contain"
                        width={256}
                        height={160}
                        unoptimized
                        onError={() => handleAiImageLoadError(item.image)}
                      />
                    )}
                  </div>
                  <p className="truncate text-[11px] text-white group-disabled:text-slate-500">
                    {item.prompt}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <label
          className={`lk-button flex items-center gap-2 ${
            disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
          }`}
        >
          <input
            type="file"
            accept="image/*"
            onChange={handleCustomFileChange}
            className="hidden"
            disabled={disabled}
          />
          <span className="text-xs">{ui.importImage}</span>
        </label>
      </div>
      {customBackgrounds.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            {ui.importedBackgrounds}
          </p>
          <div className="flex flex-wrap gap-2">
            {customBackgrounds.map((item) => (
              <div
                key={item.id}
                className="flex h-24 w-full items-stretch gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-2 sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.66rem)]"
              >
                <button
                  onClick={() => onChangeBackground(item.id)}
                  className={`flex flex-1 items-center gap-2 rounded-xl border px-2 text-xs text-left transition ${
                    backgroundMode === item.id
                      ? "border-sky-500 bg-sky-900/40 text-sky-200"
                      : "border-slate-800 bg-slate-900/30 text-slate-200"
                  }`}
                >
                  {item.imagePath && (
                    <Image
                      src={item.imagePath}
                      alt={item.label}
                      className="h-12 w-12 rounded-md object-cover"
                      width={192}
                      height={144}
                      unoptimized
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                </button>
                <button
                  onClick={() => onRemoveCustomBackground(item.id)}
                  className="rounded-full border border-rose-500/60 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
                >
                  {ui.delete}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CameraSection({
  autoFrame,
  onToggleAutoFrame,
  isHost,
  captionsEnabled,
  captionsSupported,
  onToggleCaptions,
  captionTarget,
  onChangeCaptionTarget,
  sourceLanguage,
  onChangeSourceLanguage,
  ttsEnabled,
  onToggleTts,
  realtimeEnabled,
  realtimeAvailable,
  realtimeVoice,
  onChangeRealtimeVoice,
  onToggleRealtime,
  realtimeStatus,
  realtimeError,
  hostLocalTtsEnabled,
  onToggleHostLocalTts,
  shareMicToGuests,
  onToggleShareMicToGuests,
  ttsError,
  captionSize,
  onChangeCaptionSize,
  videoFit,
  onChangeVideoFit,
  backgroundMode,
  onChangeBackground,
  backgroundDisabled,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiBackgroundUrl,
  onAiImageGenerated,
  onSaveAiBackground,
  onAiBackgroundClear,
  aiGallery,
  onAiGallerySelect,
  onRefreshTranslationEntitlement,
}: {
  autoFrame: boolean;
  onToggleAutoFrame: () => void;
  isHost: boolean;
  captionsEnabled: boolean;
  captionsSupported: boolean;
  onToggleCaptions: () => void;
  captionTarget: CaptionTarget;
  onChangeCaptionTarget: (target: CaptionTarget) => void;
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  realtimeEnabled: boolean;
  realtimeAvailable: boolean;
  realtimeVoice: string;
  onChangeRealtimeVoice: (voice: string) => void;
  onToggleRealtime: () => void;
  realtimeStatus: RealtimeStatus;
  realtimeError: string;
  hostLocalTtsEnabled: boolean;
  onToggleHostLocalTts: () => void;
  shareMicToGuests: boolean;
  onToggleShareMicToGuests: () => void;
  ttsError: string;
  captionSize: "sm" | "md" | "lg";
  onChangeCaptionSize: (size: "sm" | "md" | "lg") => void;
  videoFit: "cover" | "contain";
  onChangeVideoFit: (fit: "cover" | "contain") => void;
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  backgroundDisabled: boolean;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  onAiBackgroundClear: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  onRefreshTranslationEntitlement: () => Promise<void> | void;
}) {
  const { locale } = useUiLocale();
  const ui = LIVEKIT_UI_COPY[locale];
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const [error, setError] = useState("");
  const [isFlipping, setIsFlipping] = useState(false);
  const [recommendedMode, setRecommendedMode] = useState<"realtime" | "vocal" | "unknown">("unknown");
  const [recommendationLocked, setRecommendationLocked] = useState(false);
  const [showRecommendationToast, setShowRecommendationToast] = useState(false);
  const realtimeVoiceLocked = realtimeEnabled;
  const realtimeStatusLabel = {
    idle: "idle",
    connecting: "connexion...",
    open: "connecte",
    closed: "ferme",
    error: "erreur",
  } satisfies Record<RealtimeStatus, string>;
  const realtimeStatusTone = {
    idle: "text-slate-400",
    connecting: "text-amber-200",
    open: "text-emerald-200",
    closed: "text-slate-400",
    error: "text-amber-200",
  } satisfies Record<RealtimeStatus, string>;
  const activeLanguage = useMemo(
    () =>
      CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget) ??
      CAPTION_TARGETS_CONFIG[0],
    [captionTarget]
  );
  const activeLanguageName = activeLanguage?.name || "English";
  const activeLanguageLabel = activeLanguage?.label || "EN";
  const sourceLanguageName = useMemo(
    () =>
      SOURCE_LANGUAGE_OPTIONS.find((item) => item.code === sourceLanguage)?.name ||
      SOURCE_LANGUAGE_OPTIONS[0].name,
    [sourceLanguage]
  );
  const advancedVoiceControlsEnabled =
    REALTIME_TRANSLATION_ENABLED || VOICE_TRANSLATION_ENABLED;
  const hostLocalActive = Boolean(hostLocalTtsEnabled);
  const translationStatusMessage = advancedVoiceControlsEnabled
    ? realtimeEnabled
      ? `Realtime actif (${sourceLanguageName} → ${activeLanguageName}). La synthèse OpenAI en ${activeLanguageName} remplace ta voix pour les invités.`
      : shareMicToGuests
      ? `Les invités entendent ta voix (${sourceLanguageName}) pendant que les sous-titres et la synthèse restent en ${activeLanguageName}.`
      : `Mode traduction exclusive (${sourceLanguageName} → ${activeLanguageName}) activé : seuls les sous-titres et la synthèse OpenAI sont diffusés en ${activeLanguageName}.`
    : `Mode talkie-walkie (${sourceLanguageName} → ${activeLanguageName}) : maintiens "Maintenir pour parler", puis relâche pour partager les sous-titres.`;
  const handleFlip = async () => {
    if (isFlipping) return;
    setIsFlipping(true);
    setError("");
    try {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const track = publication?.track as unknown as
        | {
            getDeviceId: (normalize?: boolean) => Promise<string | undefined>;
            setDeviceId: (id: string) => Promise<boolean>;
          }
        | undefined;
      if (!track) {
        setError("Camera non active.");
        return;
      }
      const devices = await Room.getLocalDevices("videoinput");
      if (devices.length < 2) return;
      const currentId = await track.getDeviceId();
      let currentIndex = devices.findIndex((device) => device.deviceId === currentId);
      if (currentIndex < 0) currentIndex = 0;
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      await track.setDeviceId(nextDevice.deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de changer de camera.");
    } finally {
      setIsFlipping(false);
    }
  };

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!advancedVoiceControlsEnabled) {
      setRecommendedMode("unknown");
      return;
    }
    if (recommendationLocked) return;
    const connection =
      (navigator as { connection?: any; mozConnection?: any; webkitConnection?: any }).connection ||
      (navigator as { mozConnection?: any }).mozConnection ||
      (navigator as { webkitConnection?: any }).webkitConnection;
    if (!connection) {
      setRecommendedMode("unknown");
      return;
    }
    const update = () => {
      const effectiveType = String(connection.effectiveType || "");
      const downlink = typeof connection.downlink === "number" ? connection.downlink : undefined;
      const rtt = typeof connection.rtt === "number" ? connection.rtt : undefined;
      if (effectiveType === "slow-2g" || effectiveType === "2g") {
        setRecommendedMode("vocal");
        return;
      }
      if ((downlink !== undefined && downlink < 1) || (rtt !== undefined && rtt > 400)) {
        setRecommendedMode("vocal");
        return;
      }
      setRecommendedMode("realtime");
    };
    update();
    if (connection.addEventListener) {
      connection.addEventListener("change", update);
      return () => connection.removeEventListener("change", update);
    }
    if (connection.onchange !== undefined) {
      connection.onchange = update;
      return () => {
        if (connection.onchange === update) {
          connection.onchange = null;
        }
      };
    }
  }, [advancedVoiceControlsEnabled, recommendationLocked]);

  useEffect(() => {
    if (!showRecommendationToast) return;
    const timer = setTimeout(() => setShowRecommendationToast(false), 2000);
    return () => clearTimeout(timer);
  }, [showRecommendationToast]);

  const markManualMode = useCallback(() => {
    setRecommendationLocked(true);
  }, []);

  const applyRecommendedMode = useCallback(() => {
    if (!advancedVoiceControlsEnabled) return;
    if (recommendedMode === "unknown") return;
    markManualMode();
    if (recommendedMode === "realtime") {
      if (ttsEnabled) onToggleTts();
      if (realtimeEnabled) return;
      onToggleRealtime();
      setShowRecommendationToast(true);
      return;
    }
    if (!captionsEnabled) onToggleCaptions();
    if (realtimeEnabled) onToggleRealtime();
    if (!ttsEnabled) onToggleTts();
    setShowRecommendationToast(true);
  }, [
    advancedVoiceControlsEnabled,
    captionsEnabled,
    markManualMode,
    onToggleCaptions,
    onToggleRealtime,
    onToggleTts,
    recommendedMode,
    realtimeEnabled,
    ttsEnabled,
  ]);

  const handleToggleCaptions = useCallback(() => {
    markManualMode();
    onToggleCaptions();
  }, [markManualMode, onToggleCaptions]);

  const handleToggleRealtime = useCallback(() => {
    markManualMode();
    onToggleRealtime();
  }, [markManualMode, onToggleRealtime]);

  const handleToggleTts = useCallback(() => {
    markManualMode();
    onToggleTts();
  }, [markManualMode, onToggleTts]);

  const handleToggleHostLocalTts = useCallback(() => {
    if (!onToggleHostLocalTts) return;
    markManualMode();
    onToggleHostLocalTts();
  }, [markManualMode, onToggleHostLocalTts]);

  return (
    <div className="flex flex-col gap-2">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3 text-xs text-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[12px] uppercase tracking-wide text-slate-400">{ui.cameraAndCaptionsTitle}</span>
          <span
            title={ui.cameraAndCaptionsInfo}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
          >
            <Info className="h-3 w-3" />
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          {ui.cameraAndCaptionsHint}
        </p>
        <div className="grid gap-2">
          <button
            onClick={onToggleAutoFrame}
            className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200"
          >
            <span className="flex items-center gap-2">
              {ui.autoFrame}
              <span
                title={ui.autoFrameInfo}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
              >
                <Info className="h-3 w-3" />
              </span>
            </span>
            <span className={autoFrame ? "text-sky-200" : "text-slate-400"}>
              {autoFrame ? ui.active : ui.inactive}
            </span>
          </button>
          {isHost ? (
            CAPTIONS_ALWAYS_ON ? null : (
              <button
                onClick={handleToggleCaptions}
                disabled={!captionsSupported}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  Sous-titres
                  <span
                    title="Transcrit la voix de l'hote en texte."
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                  >
                    <Info className="h-3 w-3" />
                  </span>
                </span>
                <span className={captionsEnabled ? "text-sky-200" : "text-slate-400"}>
                  {captionsEnabled ? "Actif" : "Inactif"}
                </span>
              </button>
            )
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
              Les sous-titres sont controles par l'hote.
            </div>
          )}
        </div>
      </section>
      {isHost && advancedVoiceControlsEnabled && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3 text-xs text-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Traduction & voix</span>
              <div className="flex items-center gap-2">
                {advancedVoiceControlsEnabled && recommendedMode !== "unknown" && (
                  <button
                    type="button"
                    onClick={applyRecommendedMode}
                    className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100"
                    title={
                      recommendationLocked
                        ? "Recommandation figee (mode manuel)"
                        : "Appliquer la recommandation"
                    }
                  >
                    Recommande: {recommendedMode === "realtime" ? "Realtime" : "Traduction vocale"}
                  </button>
                )}
                <span
                  title={
                    advancedVoiceControlsEnabled
                      ? "Choisis la langue et le mode audio. Realtime = streaming, Traduction vocale = texte puis voix."
                      : "Choisis la langue source et la langue cible des sous-titres."
                  }
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                >
                  <Info className="h-3 w-3" />
                </span>
              </div>
            </div>
            {advancedVoiceControlsEnabled && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    Voix Realtime
                    <span
                      title="Nom exact de la voix OpenAI (ex: alloy)."
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                    >
                      <Info className="h-3 w-3" />
                    </span>
                  </span>
                  <select
                    value={realtimeVoice}
                    onChange={(event) => onChangeRealtimeVoice(event.target.value)}
                    disabled={realtimeVoiceLocked}
                    className="w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                  >
                    {REALTIME_VOICE_OPTIONS.map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                  </select>
                </div>
                {realtimeVoiceLocked && (
                  <p className="text-[11px] text-slate-400">
                    Voix verrouillee apres demarrage Realtime.
                  </p>
                )}
              </>
            )}
            <div className="grid gap-3">
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">
                    Langue source (ex : Français, Darija, Persan, Arabe…)
                  </span>
                  <span className="text-slate-500">{sourceLanguageName}</span>
                </div>
                <select
                  value={sourceLanguage}
                  onChange={(event) =>
                    onChangeSourceLanguage(event.target.value as SourceLanguageOption["code"])
                  }
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
                  disabled={!isHost}
                  title="Sélectionne la langue que tu es en train de parler pour améliorer la reconnaissance vocale."
                >
                  {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {`${option.name} (${option.label})`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Choisis ta langue parlée (Français, Darija, Persan, Arabe, etc.) : toutes les options du sélecteur sont reconnues par OpenAI et l’accent est détecté automatiquement.
                </p>
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">Langue cible</span>
                  <span className="text-slate-500">{activeLanguageName}</span>
                </div>
                <select
                  value={captionTarget}
                  onChange={(event) => onChangeCaptionTarget(event.target.value as CaptionTarget)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
                  disabled={!isHost}
                  title="Choisis la langue dans laquelle tu veux diffuser les sous-titres et la voix."
                >
                  {CAPTION_TARGETS_CONFIG.map((target) => (
                    <option key={target.code} value={target.code}>
                      {`${target.name} (${target.label})`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Sous-titres, synthèse et streaming realtime sont diffusés en {activeLanguageName}.
                </p>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">{translationStatusMessage}</p>
          </section>

          {advancedVoiceControlsEnabled && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-slate-400">
                  Résumé de la traduction
                </p>
                <p className="text-[12px] font-semibold text-white">
                  {`${sourceLanguageName} → ${activeLanguageName}`}
                </p>
              </div>
              <span className="text-[11px] text-slate-500">{activeLanguageLabel}</span>
            </div>
            <p className="text-[11px] text-slate-500">{activeLanguage?.description}</p>
            {advancedVoiceControlsEnabled ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                {TRANSLATION_MODE_HELP.map((mode) => {
                  const isActive =
                    mode.id === "realtime"
                      ? realtimeEnabled
                      : mode.id === "tts"
                      ? ttsEnabled
                      : mode.id === "local"
                      ? hostLocalActive
                      : false;
                  return (
                    <div
                      key={mode.id}
                      className={`rounded-xl border px-2 py-1 transition ${
                        isActive
                          ? "border-sky-500/60 bg-sky-500/10"
                          : "border-slate-700 bg-slate-900/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold ${isActive ? "text-white" : "text-slate-400"}`}>
                          {mode.label}
                        </span>
                        <span className="text-[10px] text-slate-400">{isActive ? "Actif" : "Inactif"}</span>
                      </div>
                      <p className="mt-1 text-[9px] text-slate-500">{mode.detail}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                <p>Mode simplifie actif: talkie-walkie + sous-titres continus, sans demarrage Realtime.</p>
                <p>Comme sur mobile: maintiens "Maintenir pour parler", puis relache.</p>
              </div>
            )}
            </section>
          )}

          {advancedVoiceControlsEnabled && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Modes et voix
                </span>
                <span className="text-[11px] text-slate-500">Realtime · Vocale · Lecture</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Active un mode pour partager ta voix, lancer la traduction en direct ou écouter une synthèse OpenAI.
              </p>
              <div className="grid grid-cols-2 gap-2">
                  {typeof shareMicToGuests === "boolean" && (
                    <button
                      onClick={onToggleShareMicToGuests}
                      title={`Envoie ta voix originale (${sourceLanguageName}) aux invités.`}
                      className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200"
                    >
                    <span className="flex items-center gap-2">
                      Partager ma voix
                      <span
                        title="Transmets ta voix brute pendant que la traduction parle pour les invités."
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                      >
                        <Info className="h-3 w-3" />
                      </span>
                    </span>
                      <span className={getBadgeClass(shareMicToGuests)}>
                        {shareMicToGuests ? "Actif" : "Inactif"}
                      </span>
                    </button>
                  )}
                  {shareMicToGuests && (
                    <p className="text-[10px] text-slate-500">
                      Mode “Partager ma voix” activé → les autres modes vocaux sont verrouillés pour éviter les doublons audio.
                    </p>
                  )}
                <button
                  onClick={handleToggleRealtime}
                  disabled={!realtimeAvailable}
                  title={`Traduction audio en streaming (${sourceLanguageName} → ${activeLanguageName}).`}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    Traduction Realtime
                    <span
                      title={`Flux ${sourceLanguageName} → ${activeLanguageName} (latence réduite).`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                    >
                      <Info className="h-3 w-3" />
                    </span>
                  </span>
                  <span className={getBadgeClass(realtimeEnabled)}>
                    {realtimeEnabled ? "Actif" : realtimeAvailable ? "Inactif" : "Indispo"}
                  </span>
                </button>
                  <button
                    onClick={handleToggleTts}
                    disabled={!captionsEnabled || shareMicToGuests}
                    title={`Traduction ${sourceLanguageName} → ${activeLanguageName} via texte puis synthèse vocale.`}
                    className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
                  >
                  <span className="flex items-center gap-2">
                    Traduction vocale
                    <span
                      title={`Traduction texte + synthèse en ${activeLanguageName}.`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                    >
                      <Info className="h-3 w-3" />
                    </span>
                  </span>
                  <span className={getBadgeClass(ttsEnabled)}>
                    {ttsEnabled ? "Actif" : "Inactif"}
                  </span>
                </button>
                  {typeof hostLocalTtsEnabled === "boolean" && (
                    <button
                      onClick={handleToggleHostLocalTts}
                      disabled={!captionsEnabled || shareMicToGuests}
                      title={`Lecture locale OpenAI (${activeLanguageName}) sur ton poste.`}
                      className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
                    >
                    <span className="flex items-center gap-2">
                      Lecture locale (rapide)
                      <span
                        title={`Écoute la synthèse OpenAI en ${activeLanguageName} sans partager de nouveau flux.`}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                      >
                        <Info className="h-3 w-3" />
                      </span>
                    </span>
                    <span className={getBadgeClass(hostLocalTtsEnabled)}>
                      {hostLocalTtsEnabled ? "Actif" : "Inactif"}
                    </span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Hôte : active “Lecture locale” pour entendre la synthèse OpenAI en {activeLanguageName} (par exemple farsi, russe, chinois) même sans interlocuteur.
              </p>
            </section>
          )}
          {advancedVoiceControlsEnabled && showRecommendationToast && (
            <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
              Mode recommande applique.
            </div>
          )}
        </div>
      )}
      {isHost && advancedVoiceControlsEnabled && ttsError && (
        <p className="text-[11px] text-amber-200">{ttsError}</p>
      )}
      {isHost && advancedVoiceControlsEnabled && realtimeError && (
        <p className="text-[11px] text-amber-200">{realtimeError}</p>
      )}
      {isHost && advancedVoiceControlsEnabled && realtimeAvailable && (
        <p className={`text-[11px] ${realtimeStatusTone[realtimeStatus]}`}>
          Realtime WS: {realtimeStatusLabel[realtimeStatus]}
        </p>
      )}
      {isHost && (
        <div className="flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {ui.captionSize}
              <span
                title={ui.captionSizeInfo}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
              >
                <Info className="h-3 w-3" />
              </span>
            </span>
            <div className="flex items-center gap-1">
              {(["sm", "md", "lg"] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => onChangeCaptionSize(size)}
                  className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                    captionSize === size
                      ? "bg-sky-500 text-white"
                      : "border border-slate-700 text-slate-200"
                  }`}
                >
                  {size.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {!captionsSupported && isHost && (
        <p className="text-[11px] text-amber-200">
          Sous-titres indisponibles sur ce navigateur.
        </p>
      )}
        <div className="flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {ui.videoFit}
            <span
              title={ui.videoFitInfo}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
            >
              <Info className="h-3 w-3" />
            </span>
          </span>
          <div className="flex items-center gap-1">
            {(["cover", "contain"] as const).map((fit) => (
              <button
                key={fit}
                onClick={() => onChangeVideoFit(fit)}
                className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                  videoFit === fit
                    ? "bg-sky-500 text-white"
                    : "border border-slate-700 text-slate-200"
                }`}
              >
                {fit === "cover" ? ui.fill : ui.fit}
              </button>
            ))}
          </div>
        </div>
        {videoFit !== "contain" && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onChangeVideoFit("contain")}
              className="rounded-full border border-slate-700 bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200"
            >
              {ui.forceFit}
            </button>
            <p className="text-[11px] text-slate-400">
              {ui.forceFitHint}
            </p>
          </div>
        )}
          </div>
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3 text-xs text-slate-200 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[12px] uppercase tracking-wide text-slate-400">
            {ui.backgroundTitle}
          </span>
          <span
            title={ui.backgroundInfo}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
          >
            <Info className="h-3 w-3" />
          </span>
        </div>
        <BackgroundSection
          isHost={isHost}
          backgroundMode={backgroundMode}
          onChangeBackground={onChangeBackground}
          disabled={backgroundDisabled}
          customBackgrounds={customBackgrounds}
          onAddCustomBackground={onAddCustomBackground}
          onRemoveCustomBackground={onRemoveCustomBackground}
          aiBackgroundUrl={aiBackgroundUrl}
          onAiImageGenerated={onAiImageGenerated}
          onSaveAiBackground={onSaveAiBackground}
          onAiBackgroundClear={onAiBackgroundClear}
          aiGallery={aiGallery}
          onAiGallerySelect={onAiGallerySelect}
          onRefreshTranslationEntitlement={onRefreshTranslationEntitlement}
        />
      </section>
      <button
        onClick={handleFlip}
        disabled={!isCameraEnabled || isFlipping}
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
      >
        <SwitchCamera className="h-4 w-4" />
        {ui.flipCamera}
      </button>
      {error && <p className="text-[11px] text-rose-200">{error}</p>}
    </div>
  );
}

function TimerPanel({
  timerState,
  timerActions,
}: {
  timerState: RoomTimerState;
  timerActions: RoomTimerActions;
}) {
  const [minutes, setMinutes] = useState("2");
  const [seconds, setSeconds] = useState("0");

  const applyDuration = () => {
    const mins = Math.max(0, Number(minutes) || 0);
    const secs = Math.max(0, Number(seconds) || 0);
    const totalMs = (mins * 60 + secs) * 1000;
    timerActions.setDuration(totalMs);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          inputMode="numeric"
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
          placeholder="Minutes"
        />
        <input
          value={seconds}
          onChange={(event) => setSeconds(event.target.value)}
          inputMode="numeric"
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
          placeholder="Secondes"
        />
      </div>
      <button
        onClick={applyDuration}
        className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
      >
        Definir la duree
      </button>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={timerActions.start}
          className="rounded-lg bg-sky-500 px-2 py-2 text-xs text-white"
        >
          Demarrer
        </button>
        <button
          onClick={timerActions.pause}
          className="rounded-lg border border-slate-700 px-2 py-2 text-xs text-slate-200 hover:bg-slate-800"
        >
          Pause
        </button>
        <button
          onClick={timerActions.reset}
          className="rounded-lg border border-slate-700 px-2 py-2 text-xs text-slate-200 hover:bg-slate-800"
        >
          Reset
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Temps restant: {formatDuration(timerState.remainingMs)}
      </p>
    </div>
  );
}

function TimerOverlay({ timerState }: { timerState: RoomTimerState }) {
  if (timerState.durationMs <= 0) return null;
  return (
    <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-md">
      {formatDuration(timerState.remainingMs)}
    </div>
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function LiveKitHostSection({ roomId }: { roomId: string }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const remoteParticipants = participants.filter(
    (participant) => participant.identity !== localParticipant?.identity
  );

  const handleModeration = async (identity: string, action: "mute" | "kick") => {
    setBusy(`${action}:${identity}`);
    setMessage("");
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/livekit/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          room: roomId,
          identity,
          action,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Erreur (${res.status})`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      setMessage(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{remoteParticipants.length} invites</span>
      </div>

      {message && <p className="mt-2 text-xs text-red-300">{message}</p>}

      {remoteParticipants.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Aucun participant a gerer.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {remoteParticipants.map((participant) => (
            <div
              key={participant.identity}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm text-slate-100">
                  {participant.name || participant.identity}
                </span>
                <span className="text-[10px] text-slate-500">{participant.identity}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleModeration(participant.identity, "mute")}
                  disabled={busy !== null}
                  className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  Couper
                </button>
                <button
                  onClick={() => handleModeration(participant.identity, "kick")}
                  disabled={busy !== null}
                  className="rounded-md bg-red-600 px-2 py-1 text-[11px] text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Exclure
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
