"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getIdToken, onAuthStateChanged, type User } from "firebase/auth";
import { AlertCircle, Loader2, Mic, MicOff, Play, Square, Volume2 } from "lucide-react";
import { auth } from "@/lib/firebaseConfig";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";
import { dispatchTranslationEntitlementUpdatedEvent } from "@/lib/translationEntitlementEvents";

type RealtimeStatus =
  | "idle"
  | "authorizing"
  | "connecting"
  | "connected"
  | "stopping"
  | "error"
  | "unsupported";

type TranscriptRole = "user" | "assistant" | "system";

type TranscriptEntry = {
  id: string;
  role: TranscriptRole;
  text: string;
  final: boolean;
  updatedAtMs: number;
};

type RealtimeStartPayload = {
  language?: string;
  targetLanguage?: string;
  voice?: string;
  instructions?: string;
  transcriptionLanguage?: string;
  transcriptionPrompt?: string;
  conversationFocus?: string;
};

type OpenAiRealtimeSessionResponse = {
  id?: string;
  model?: string;
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
  error?: string;
};

type CachedRealtimeSession = {
  key: string;
  payload: OpenAiRealtimeSessionResponse;
  expiresAtMs: number;
};

type RealtimeEvent = {
  type?: string;
  session?: { id?: string; model?: string };
  item_id?: string;
  response_id?: string;
  transcript?: string;
  text?: string;
  delta?: string;
  error?: { message?: string };
  message?: string;
};

type TranslationConsumePayload = {
  enabled?: boolean;
  error?: string;
  lockReason?: string;
  isAdmin?: boolean;
  isPremium?: boolean;
  totalSecondsRemaining?: number;
  freeSecondsRemaining?: number;
  paidSecondsRemaining?: number;
};

type RealtimePresence = "ready" | "listening" | "thinking" | "speaking" | "reconnecting";

type RealtimeDiagnostics = {
  connectMs: number | null;
  firstReplyMs: number | null;
  lastReplyMs: number | null;
  reconnectCount: number;
  audioResumeAttempts: number;
};

type AiPracticeRealtimeWebRtcProps = {
  roomId?: string;
  sessionEndpoint?: string;
  language?: string;
  targetLanguage?: string;
  voice?: string;
  instructions?: string;
  transcriptionLanguage?: string;
  transcriptionPrompt?: string;
  disabled?: boolean;
  className?: string;
  onEntitlementConsumed?: (detail: {
    sessionId?: string;
    model?: string;
  }) => void;
  onFallbackRequested?: (reason: string) => void;
};

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime";
const DEFAULT_REALTIME_MODEL = "gpt-4o-mini-realtime-preview";
const MAX_TRANSCRIPTS = 18;
const BILLING_CHUNK_SECONDS = 15;

const STATUS_LABELS: Record<UiLocale, Record<RealtimeStatus, string>> = {
  fr: {
    idle: "En veille",
    authorizing: "Autorisation",
    connecting: "Connexion",
    connected: "Connecte",
    stopping: "Arret",
    error: "Erreur",
    unsupported: "Non pris en charge",
  },
  en: {
    idle: "Idle",
    authorizing: "Authorizing",
    connecting: "Connecting",
    connected: "Connected",
    stopping: "Stopping",
    error: "Error",
    unsupported: "Unsupported",
  },
};

const STATUS_TONES: Record<RealtimeStatus, string> = {
  idle: "border-slate-700 bg-slate-950/70 text-slate-300",
  authorizing: "border-sky-500/30 bg-sky-500/10 text-sky-100",
  connecting: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  connected: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  stopping: "border-slate-700 bg-slate-950/70 text-slate-300",
  error: "border-rose-500/30 bg-rose-500/10 text-rose-100",
  unsupported: "border-rose-500/30 bg-rose-500/10 text-rose-100",
};

const PRESENCE_COPY: Record<
  UiLocale,
  Record<RealtimePresence, { label: string; tone: string }>
> = {
  fr: {
    ready: {
      label: "Pret a ecouter",
      tone: "border-slate-700 bg-slate-950/70 text-slate-300",
    },
    listening: {
      label: "Le coach t'ecoute",
      tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    },
    thinking: {
      label: "Le coach reflechit",
      tone: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    },
    speaking: {
      label: "Le coach parle",
      tone: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
    },
    reconnecting: {
      label: "Reconnexion rapide",
      tone: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-100",
    },
  },
  en: {
    ready: {
      label: "Ready to listen",
      tone: "border-slate-700 bg-slate-950/70 text-slate-300",
    },
    listening: {
      label: "Coach is listening",
      tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    },
    thinking: {
      label: "Coach is thinking",
      tone: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    },
    speaking: {
      label: "Coach is speaking",
      tone: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
    },
    reconnecting: {
      label: "Quick reconnect",
      tone: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-100",
    },
  },
};

const REALTIME_COPY: Record<
  UiLocale,
  {
    title: string;
    subtitle: string;
    noActiveSession: string;
    applyingCoach: string;
    start: string;
    stop: string;
    enableAudio: string;
    unsupported: string;
    locked: string;
    billingHint: string;
    userTranscript: string;
    assistantTranscript: string;
    waitingForUser: string;
    waitingForAssistant: string;
    metricsTitle: string;
    connectMetric: string;
    firstReplyMetric: string;
    lastReplyMetric: string;
    reconnectMetric: string;
    audioResumeMetric: string;
    topicTitle: string;
    topicHint: string;
    topicFallback: string;
    final: string;
    live: string;
    noMetric: string;
  }
> = {
  fr: {
    title: "AI Practice Realtime",
    subtitle: "Session navigateur",
    noActiveSession: "Aucune session active",
    applyingCoach: "Application des nouveaux reglages du coach...",
    start: "Demarrer",
    stop: "Arreter",
    enableAudio: "Activer l'audio",
    unsupported: "WebRTC ou le micro n'est pas disponible dans ce navigateur.",
    locked: "Des minutes actives sont requises pour garder AI Practice ouvert.",
    billingHint: "Les minutes sont decomptees tant que cette session realtime reste ouverte.",
    userTranscript: "Transcription utilisateur",
    assistantTranscript: "Transcription IA",
    waitingForUser: "En attente de ta voix",
    waitingForAssistant: "En attente de la reponse du coach",
    metricsTitle: "Mesures de session",
    connectMetric: "Connexion",
    firstReplyMetric: "1re reponse",
    lastReplyMetric: "Derniere reponse",
    reconnectMetric: "Reconnexions",
    audioResumeMetric: "Reprises audio",
    topicTitle: "Fil courant",
    topicHint: "BFZoom preserve ce fil lors des reconnexions et reappliques du coach.",
    topicFallback: "Le sujet apparaitra apres les premiers tours de parole.",
    final: "final",
    live: "live",
    noMetric: "—",
  },
  en: {
    title: "AI Practice Realtime",
    subtitle: "Browser session",
    noActiveSession: "No active session",
    applyingCoach: "Applying updated coach settings...",
    start: "Start",
    stop: "Stop",
    enableAudio: "Enable audio",
    unsupported: "WebRTC or microphone access is unavailable in this browser.",
    locked: "Active minutes are required to keep AI Practice open.",
    billingHint: "Minutes are billed while this realtime session stays open.",
    userTranscript: "User transcript",
    assistantTranscript: "AI transcript",
    waitingForUser: "Waiting for your speech",
    waitingForAssistant: "Waiting for the coach reply",
    metricsTitle: "Session metrics",
    connectMetric: "Connect",
    firstReplyMetric: "1st reply",
    lastReplyMetric: "Last reply",
    reconnectMetric: "Reconnects",
    audioResumeMetric: "Audio resumes",
    topicTitle: "Current thread",
    topicHint: "BFZoom preserves this thread across reconnects and coach updates.",
    topicFallback: "The topic will appear after the first few turns.",
    final: "final",
    live: "live",
    noMetric: "—",
  },
};

const INITIAL_DIAGNOSTICS: RealtimeDiagnostics = {
  connectMs: null,
  firstReplyMs: null,
  lastReplyMs: null,
  reconnectCount: 0,
  audioResumeAttempts: 0,
};

const normalizeText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

const normalizeVoice = (value: unknown) =>
  normalizeText(value, 32)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "") || "ash";

const isWebRtcSupported = () =>
  typeof window !== "undefined" &&
  typeof RTCPeerConnection !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

const appendTranscript = (
  current: TranscriptEntry[],
  next: TranscriptEntry,
  limit = MAX_TRANSCRIPTS
) => {
  const index = current.findIndex((entry) => entry.id === next.id);
  const updated = index >= 0 ? [...current] : [...current, next];
  if (index >= 0) {
    updated[index] = next;
  }
  return updated
    .sort((left, right) => left.updatedAtMs - right.updatedAtMs)
    .slice(-limit);
};

const keyForUserTranscript = (itemId?: string) => `user:${itemId || "pending"}`;
const keyForAssistantTranscript = (responseId?: string, itemId?: string) =>
  `assistant:${responseId || itemId || "pending"}`;

const normalizeEntitlementPayload = (payload: TranslationConsumePayload) => ({
  enabled: Boolean(payload.enabled),
  isAdmin: Boolean(payload.isAdmin),
  isPremium: Boolean(payload.isPremium),
  totalSecondsRemaining: Math.max(0, Math.floor(payload.totalSecondsRemaining || 0)),
  freeSecondsRemaining: Math.max(0, Math.floor(payload.freeSecondsRemaining || 0)),
  paidSecondsRemaining: Math.max(0, Math.floor(payload.paidSecondsRemaining || 0)),
});

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const formatMetricValue = (value: number | null, fallback: string) => {
  if (value === null || !Number.isFinite(value)) return fallback;
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.round(value)}ms`;
};

const buildConversationAnchor = (userText: string, assistantText: string) => {
  const parts: string[] = [];
  if (assistantText) {
    parts.push(`Coach recently said: "${assistantText}"`);
  }
  if (userText) {
    parts.push(`Learner recently replied: "${userText}"`);
  }
  if (!parts.length) {
    return "";
  }
  parts.push(
    "Continue this exact thread immediately after reconnecting unless the learner clearly changes topic."
  );
  return normalizeText(parts.join(" "), 420);
};

export default function AiPracticeRealtimeWebRtc({
  roomId = "",
  sessionEndpoint = "/api/ai-practice/realtime/session",
  language = "",
  targetLanguage = "",
  voice = "ash",
  instructions = "",
  transcriptionLanguage = "",
  transcriptionPrompt = "",
  disabled = false,
  className = "",
  onEntitlementConsumed,
  onFallbackRequested,
}: AiPracticeRealtimeWebRtcProps) {
  const { locale } = useUiLocale();
  const copy = REALTIME_COPY[locale];
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionModel, setSessionModel] = useState(DEFAULT_REALTIME_MODEL);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [presence, setPresence] = useState<RealtimePresence>("ready");
  const [isAutoRestarting, setIsAutoRestarting] = useState(false);
  const [conversationTopic, setConversationTopic] = useState("");
  const [diagnostics, setDiagnostics] = useState<RealtimeDiagnostics>(INITIAL_DIAGNOSTICS);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startNonceRef = useRef(0);
  const sessionOpenedRef = useRef(false);
  const unsupportedNotifiedRef = useRef(false);
  const billingStartedAtRef = useRef(0);
  const billedSecondsRef = useRef(0);
  const billingIntervalRef = useRef<number | null>(null);
  const consumeQueueRef = useRef(Promise.resolve());
  const prefetchedSessionRef = useRef<CachedRealtimeSession | null>(null);
  const prefetchPromiseRef = useRef<Promise<OpenAiRealtimeSessionResponse> | null>(null);
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const activeSessionConfigKeyRef = useRef("");
  const autoRestartRef = useRef(false);
  const statusRef = useRef<RealtimeStatus>("idle");
  const preserveConversationOnRestartRef = useRef(false);
  const conversationAnchorRef = useRef("");
  const lastFinalUserTextRef = useRef("");
  const lastFinalAssistantTextRef = useRef("");
  const connectStartedAtRef = useRef(0);
  const waitingForAssistantAtRef = useRef(0);

  const supported = useMemo(isWebRtcSupported, [authReady]);
  const statusLabel = STATUS_LABELS[locale][status];
  const statusTone = STATUS_TONES[status];
  const presenceTone = PRESENCE_COPY[locale][presence].tone;
  const presenceLabel = PRESENCE_COPY[locale][presence].label;
  const buttonDisabled =
    status === "authorizing" || status === "connecting" || status === "stopping";
  const canStop =
    status === "authorizing" || status === "connecting" || status === "connected";
  const normalizedVoiceValue = useMemo(() => normalizeVoice(voice), [voice]);
  const normalizedInstructionsValue = useMemo(
    () => normalizeText(instructions, 800),
    [instructions]
  );
  const liveSessionConfigKey = useMemo(
    () =>
      JSON.stringify({
        language,
        targetLanguage,
        voice: normalizedVoiceValue,
        instructions: normalizedInstructionsValue,
        transcriptionLanguage,
      }),
    [language, normalizedInstructionsValue, normalizedVoiceValue, targetLanguage, transcriptionLanguage]
  );
  const sessionRequestKey = useMemo(
    () =>
      JSON.stringify({
        language,
        targetLanguage,
        voice: normalizedVoiceValue,
        instructions: normalizedInstructionsValue,
        transcriptionLanguage,
        transcriptionPrompt,
      }),
    [
      language,
      normalizedInstructionsValue,
      normalizedVoiceValue,
      targetLanguage,
      transcriptionLanguage,
      transcriptionPrompt,
    ]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const setConversationAnchor = useCallback((userText: string, assistantText: string) => {
    const normalizedUser = normalizeText(userText, 220);
    const normalizedAssistant = normalizeText(assistantText, 220);
    lastFinalUserTextRef.current = normalizedUser;
    lastFinalAssistantTextRef.current = normalizedAssistant;
    conversationAnchorRef.current = buildConversationAnchor(normalizedUser, normalizedAssistant);
    setConversationTopic(normalizedUser || normalizedAssistant || "");
  }, []);

  const clearBillingInterval = useCallback(() => {
    if (billingIntervalRef.current !== null) {
      window.clearInterval(billingIntervalRef.current);
      billingIntervalRef.current = null;
    }
  }, []);

  const cleanupConnection = useCallback(
    (options?: { preserveStatus?: boolean }) => {
      startNonceRef.current += 1;
      sessionOpenedRef.current = false;
      clearBillingInterval();

      if (dcRef.current) {
        try {
          dcRef.current.onopen = null;
          dcRef.current.onclose = null;
          dcRef.current.onmessage = null;
          dcRef.current.close();
        } catch {}
        dcRef.current = null;
      }

      if (pcRef.current) {
        try {
          pcRef.current.ontrack = null;
          pcRef.current.onconnectionstatechange = null;
          pcRef.current.oniceconnectionstatechange = null;
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
        localStreamRef.current = null;
      }

      remoteStreamRef.current = null;

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }

      billingStartedAtRef.current = 0;
      billedSecondsRef.current = 0;
      waitingForAssistantAtRef.current = 0;
      setAudioBlocked(false);
      setPresence(autoRestartRef.current ? "reconnecting" : "ready");
      prefetchPromiseRef.current = null;

      if (!options?.preserveStatus) {
        setStatus("idle");
      }
    },
    [clearBillingInterval]
  );

  const dispatchEntitlement = useCallback((payload: TranslationConsumePayload) => {
    dispatchTranslationEntitlementUpdatedEvent(normalizeEntitlementPayload(payload));
  }, []);

  const requestRealtimeSession = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error("You must be signed in to start Realtime.");
    }

    const cached = prefetchedSessionRef.current;
    if (
      cached &&
      cached.key === sessionRequestKey &&
      cached.expiresAtMs - Date.now() > 10_000
    ) {
      return cached.payload;
    }

    if (prefetchPromiseRef.current) {
      return prefetchPromiseRef.current;
    }

    const requestPromise = (async () => {
      const firebaseToken = await getIdToken(current);
      const response = await fetch(sessionEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firebaseToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language,
          targetLanguage,
          voice: normalizedVoiceValue,
          instructions: normalizedInstructionsValue,
          transcriptionLanguage,
          transcriptionPrompt,
          conversationFocus: conversationAnchorRef.current,
        } satisfies RealtimeStartPayload),
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => ({}))) as OpenAiRealtimeSessionResponse;
      if (!response.ok) {
        throw new Error(
          normalizeText(payload.error, 240) ||
            `Session request failed (${response.status})`
        );
      }

      const expiresAtSeconds = Number(payload.client_secret?.expires_at || 0);
      prefetchedSessionRef.current = {
        key: sessionRequestKey,
        payload,
        expiresAtMs: expiresAtSeconds > 0 ? expiresAtSeconds * 1000 : Date.now() + 45_000,
      };

      return payload;
    })();

    prefetchPromiseRef.current = requestPromise;
    try {
      return await requestPromise;
    } finally {
      prefetchPromiseRef.current = null;
    }
  }, [
    language,
    normalizedInstructionsValue,
    normalizedVoiceValue,
    sessionEndpoint,
    sessionRequestKey,
    targetLanguage,
    transcriptionLanguage,
    transcriptionPrompt,
  ]);

  const consumeTranslationSeconds = useCallback(
    async (seconds: number) => {
      const current = auth.currentUser;
      if (!current) {
        throw new Error("You must be signed in to continue.");
      }
      const amount = Math.max(1, Math.min(300, Math.floor(seconds)));

      consumeQueueRef.current = consumeQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const token = await getIdToken(current);
          const response = await fetch("/api/translation/consume", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              seconds: amount,
              origin: "ai_practice_realtime_web",
              roomId,
            }),
          });
          const payload = (await response.json().catch(() => ({}))) as TranslationConsumePayload;
          dispatchEntitlement(payload);
          if (!response.ok || !payload.enabled) {
            setPresence("ready");
            throw new Error(
              normalizeText(payload.lockReason || payload.error, 240) ||
                "Active minutes are required for AI Practice Realtime."
            );
          }
        });

      return consumeQueueRef.current;
    },
    [dispatchEntitlement, roomId]
  );

  const flushBilling = useCallback(
    async (force = false) => {
      if (!billingStartedAtRef.current) return;
      const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - billingStartedAtRef.current) / 1000)
      );
      let unbilledSeconds = elapsedSeconds - billedSecondsRef.current;

      while (
        unbilledSeconds >= BILLING_CHUNK_SECONDS ||
        (force && unbilledSeconds > 0)
      ) {
        const nextChunk =
          unbilledSeconds >= BILLING_CHUNK_SECONDS
            ? BILLING_CHUNK_SECONDS
            : unbilledSeconds;
        await consumeTranslationSeconds(nextChunk);
        billedSecondsRef.current += nextChunk;
        unbilledSeconds -= nextChunk;
      }
    },
    [consumeTranslationSeconds]
  );

  const stop = useCallback(
    async (options?: { fallbackReason?: string; preserveError?: boolean; flushBilling?: boolean }) => {
      clearBillingInterval();
      if (options?.flushBilling !== false) {
        try {
          await flushBilling(true);
        } catch (flushError) {
          if (!options?.preserveError) {
            setError(
              flushError instanceof Error
                ? flushError.message
                : "Active minutes are required for AI Practice Realtime."
            );
          }
        }
      }
      cleanupConnection();
      if (options?.fallbackReason) {
        onFallbackRequested?.(options.fallbackReason);
      }
    },
    [cleanupConnection, clearBillingInterval, flushBilling, onFallbackRequested]
  );

  useEffect(
    () => () => {
      void stop({ flushBilling: false });
    },
    [stop]
  );

  useEffect(() => {
    if (!disabled) return;
    if (!canStop) return;
    setPresence("ready");
    setError("");
    setStatus("stopping");
    void stop({ flushBilling: false });
  }, [canStop, disabled, stop]);

  useEffect(() => {
    if (authReady && !supported && !unsupportedNotifiedRef.current) {
      unsupportedNotifiedRef.current = true;
      setStatus("unsupported");
      onFallbackRequested?.("web_webrtc_unsupported");
    }
  }, [authReady, onFallbackRequested, supported]);

  useEffect(() => {
    if (disabled) return;
    if (!authReady || !currentUser || !supported) return;
    if (status !== "idle" && status !== "error") return;

    const timeoutId = window.setTimeout(() => {
      void requestRealtimeSession().catch(() => undefined);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authReady, currentUser, disabled, requestRealtimeSession, status, supported]);

  const pushTranscript = useCallback(
    (role: TranscriptRole, key: string, text: string, final: boolean) => {
      const cleaned = normalizeText(text, 1200);
      if (!cleaned) return;
      setTranscripts((current) =>
        appendTranscript(current, {
          id: key,
          role,
          text: cleaned,
          final,
          updatedAtMs: Date.now(),
        })
      );
    },
    []
  );

  const markSessionConnected = useCallback(
    (detail: { sessionId?: string; model?: string }) => {
      setStatus("connected");
      if (sessionOpenedRef.current) return;
      sessionOpenedRef.current = true;
      const measuredConnectMs = connectStartedAtRef.current
        ? Math.max(0, nowMs() - connectStartedAtRef.current)
        : null;
      billingStartedAtRef.current = Date.now();
      billedSecondsRef.current = 0;
      setPresence("listening");
      setIsAutoRestarting(false);
      setDiagnostics((current) => ({
        ...current,
        connectMs: measuredConnectMs,
      }));
      clearBillingInterval();
      billingIntervalRef.current = window.setInterval(() => {
        void flushBilling().catch((consumeError) => {
          const message =
            consumeError instanceof Error
              ? consumeError.message
              : "Active minutes are required for AI Practice Realtime.";
          setError(message);
          setStatus("error");
          void stop({ fallbackReason: message, preserveError: true, flushBilling: false });
        });
      }, BILLING_CHUNK_SECONDS * 1000);
      onEntitlementConsumed?.(detail);
    },
    [clearBillingInterval, flushBilling, onEntitlementConsumed, stop]
  );

  const unlockAudio = useCallback(
    async (options?: { countAttempt?: boolean; markBlockedOnFail?: boolean }) => {
      if (!audioRef.current) return;
      if (!audioRef.current.srcObject) return;
      if (options?.countAttempt) {
        setDiagnostics((current) => ({
          ...current,
          audioResumeAttempts: current.audioResumeAttempts + 1,
        }));
      }
      audioRef.current.muted = false;
      audioRef.current.volume = 1;
      audioRef.current.autoplay = true;
      audioRef.current.setAttribute("autoplay", "true");
      audioRef.current.setAttribute("playsinline", "true");
      audioRef.current.setAttribute("webkit-playsinline", "true");
      try {
        await audioRef.current.play();
        setAudioBlocked(false);
      } catch {
        if (options?.markBlockedOnFail ?? true) {
          setAudioBlocked(true);
        }
      }
    },
    []
  );

  const markAssistantReplyStarted = useCallback(() => {
    if (!waitingForAssistantAtRef.current) return;
    const latency = Math.max(0, nowMs() - waitingForAssistantAtRef.current);
    waitingForAssistantAtRef.current = 0;
    setDiagnostics((current) => ({
      ...current,
      firstReplyMs: current.firstReplyMs ?? latency,
      lastReplyMs: latency,
    }));
  }, []);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const nextSessionId = normalizeText(event.session?.id, 80);
          const nextModel =
            normalizeText(event.session?.model, 80) || DEFAULT_REALTIME_MODEL;
          if (nextSessionId) {
            setSessionId(nextSessionId);
          }
          setSessionModel(nextModel);
          break;
        }
        case "conversation.item.input_audio_transcription.delta":
        case "response.input_audio_transcript.delta": {
          setPresence("listening");
          const key = keyForUserTranscript(event.item_id);
          pushTranscript("user", key, String(event.delta || ""), false);
          break;
        }
        case "conversation.item.input_audio_transcription.completed":
        case "response.input_audio_transcript.done": {
          setPresence("thinking");
          waitingForAssistantAtRef.current = nowMs();
          const key = keyForUserTranscript(event.item_id);
          const finalUserText = String(event.transcript || event.text || "");
          setConversationAnchor(finalUserText, lastFinalAssistantTextRef.current);
          pushTranscript("user", key, finalUserText, true);
          break;
        }
        case "response.created":
        case "response.output_item.added": {
          setPresence("thinking");
          break;
        }
        case "response.output_audio.started": {
          markAssistantReplyStarted();
          setPresence("speaking");
          void unlockAudio({ countAttempt: false, markBlockedOnFail: false }).catch(() => undefined);
          break;
        }
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
        case "response.text.delta":
        case "response.output_text.delta": {
          markAssistantReplyStarted();
          setPresence("speaking");
          const key = keyForAssistantTranscript(event.response_id, event.item_id);
          pushTranscript("assistant", key, String(event.delta || ""), false);
          break;
        }
        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done":
        case "response.text.done":
        case "response.output_text.done":
        case "response.done":
        case "response.output_audio.stopped": {
          setPresence("listening");
          const key = keyForAssistantTranscript(event.response_id, event.item_id);
          const finalAssistantText = String(event.transcript || event.text || "");
          if (finalAssistantText.trim()) {
            setConversationAnchor(lastFinalUserTextRef.current, finalAssistantText);
          }
          pushTranscript("assistant", key, finalAssistantText, true);
          break;
        }
        case "error": {
          setPresence("ready");
          const message =
            normalizeText(event.error?.message, 240) ||
            normalizeText(event.message, 240) ||
            "Realtime error";
          setError(message);
          setStatus("error");
          void stop({ fallbackReason: message, preserveError: true });
          break;
        }
        default:
          break;
      }
    },
    [markAssistantReplyStarted, pushTranscript, setConversationAnchor, stop, unlockAudio]
  );

  useEffect(() => {
    if (!audioRef.current) return;
    const audioEl = audioRef.current;
    audioEl.muted = false;
    audioEl.volume = 1;
    audioEl.autoplay = true;
    audioEl.setAttribute("autoplay", "true");
    audioEl.setAttribute("playsinline", "true");
    audioEl.setAttribute("webkit-playsinline", "true");

    const onPlaying = () => setAudioBlocked(false);
    const onRecoverableAudioState = () => {
      if (statusRef.current !== "connected") return;
      window.setTimeout(() => {
        void unlockAudio({ countAttempt: false, markBlockedOnFail: false });
      }, 80);
    };

    audioEl.addEventListener("playing", onPlaying);
    audioEl.addEventListener("waiting", onRecoverableAudioState);
    audioEl.addEventListener("stalled", onRecoverableAudioState);

    return () => {
      audioEl.removeEventListener("playing", onPlaying);
      audioEl.removeEventListener("waiting", onRecoverableAudioState);
      audioEl.removeEventListener("stalled", onRecoverableAudioState);
    };
  }, [unlockAudio]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (status !== "connected" && !audioBlocked) return;

    const trySoftResume = () => {
      if (document.hidden) return;
      void unlockAudio({ countAttempt: false, markBlockedOnFail: false });
    };

    const tryUserResume = () => {
      if (document.hidden) return;
      void unlockAudio({ countAttempt: true, markBlockedOnFail: false });
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        trySoftResume();
      }
    };

    window.addEventListener("pageshow", trySoftResume);
    window.addEventListener("focus", trySoftResume);
    document.addEventListener("visibilitychange", onVisibilityChange);

    if (audioBlocked) {
      document.addEventListener("click", tryUserResume, true);
      document.addEventListener("touchend", tryUserResume, true);
      document.addEventListener("keydown", tryUserResume, true);
    }

    return () => {
      window.removeEventListener("pageshow", trySoftResume);
      window.removeEventListener("focus", trySoftResume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (audioBlocked) {
        document.removeEventListener("click", tryUserResume, true);
        document.removeEventListener("touchend", tryUserResume, true);
        document.removeEventListener("keydown", tryUserResume, true);
      }
    };
  }, [audioBlocked, status, unlockAudio]);

  const start = useCallback(async () => {
    if (disabled) {
      setStatus("idle");
      setError("Active minutes are required for AI Practice Realtime.");
      return;
    }

    if (!supported) {
      setStatus("unsupported");
      setError("Realtime WebRTC is not supported in this browser.");
      onFallbackRequested?.("web_webrtc_unsupported");
      return;
    }

    if (!currentUser) {
      setStatus("error");
      const reason = "not_authenticated";
      setError("You must be signed in to start Realtime.");
      onFallbackRequested?.(reason);
      return;
    }

    if (status === "authorizing" || status === "connecting" || status === "connected") {
      return;
    }

    cleanupConnection({ preserveStatus: true });
    const preserveConversation = preserveConversationOnRestartRef.current;
    preserveConversationOnRestartRef.current = false;
    const nonce = startNonceRef.current + 1;
    startNonceRef.current = nonce;
    connectStartedAtRef.current = nowMs();
    setAudioBlocked(false);
    setError("");
    if (!preserveConversation) {
      setTranscripts([]);
      setConversationTopic("");
      conversationAnchorRef.current = "";
      lastFinalUserTextRef.current = "";
      lastFinalAssistantTextRef.current = "";
      setDiagnostics(INITIAL_DIAGNOSTICS);
    }
    setSessionId("");
    setSessionModel(DEFAULT_REALTIME_MODEL);
    activeSessionConfigKeyRef.current = liveSessionConfigKey;
    setStatus("authorizing");

    try {
      const session = await requestRealtimeSession();
      prefetchedSessionRef.current = null;

      const clientSecret = normalizeText(session.client_secret?.value, 2048);
      const model = normalizeText(session.model, 80) || DEFAULT_REALTIME_MODEL;
      if (!clientSecret) {
        throw new Error("Missing OpenAI ephemeral session token.");
      }

      if (startNonceRef.current !== nonce) return;

      setSessionId(normalizeText(session.id, 80));
      setSessionModel(model);
      setStatus("connecting");

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (startNonceRef.current !== nonce) {
        localStream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = localStream;

      const peerConnection = new RTCPeerConnection();
      pcRef.current = peerConnection;
      remoteStreamRef.current = new MediaStream();

      peerConnection.addTransceiver("audio", { direction: "recvonly" });
      for (const track of localStream.getAudioTracks()) {
        peerConnection.addTrack(track, localStream);
      }

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dcRef.current = dataChannel;

      dataChannel.onmessage = (message) => {
        try {
          const parsed = JSON.parse(String(message.data)) as RealtimeEvent;
          handleRealtimeEvent(parsed);
        } catch {
          // Ignore malformed events.
        }
      };

      dataChannel.onopen = () => {
        if (startNonceRef.current !== nonce) return;
        markSessionConnected({
          sessionId: normalizeText(session.id, 80),
          model,
        });
      };

      dataChannel.onclose = () => {
        if (startNonceRef.current === nonce && statusRef.current !== "error") {
          setStatus("idle");
        }
      };

      peerConnection.ontrack = (event) => {
        const remoteStream = remoteStreamRef.current;
        if (!remoteStream) return;
        if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
        if (audioRef.current && audioRef.current.srcObject !== remoteStream) {
          audioRef.current.srcObject = remoteStream;
        }
        event.track.onunmute = () => {
          void unlockAudio({ countAttempt: false, markBlockedOnFail: false }).catch(() => undefined);
        };
        void unlockAudio({ countAttempt: false, markBlockedOnFail: true }).catch(() => undefined);
      };

      peerConnection.onconnectionstatechange = () => {
        if (
          peerConnection.connectionState === "connected" &&
          startNonceRef.current === nonce
        ) {
          markSessionConnected({
            sessionId: normalizeText(session.id, 80),
            model,
          });
          return;
        }

        if (
          (peerConnection.connectionState === "failed" ||
            peerConnection.connectionState === "closed" ||
            peerConnection.connectionState === "disconnected") &&
          startNonceRef.current === nonce
        ) {
          const message = "Realtime connection closed.";
          setStatus("error");
          setError(message);
          void stop({ fallbackReason: message, preserveError: true });
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === "failed" && startNonceRef.current === nonce) {
          const message = "ICE connection failed.";
          setStatus("error");
          setError(message);
          void stop({ fallbackReason: message, preserveError: true });
        }
      };

      const offer = await peerConnection.createOffer();
      if (startNonceRef.current !== nonce) return;

      await peerConnection.setLocalDescription(offer);
      if (startNonceRef.current !== nonce) return;

      const answerResponse = await fetch(
        `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
            "OpenAI-Beta": "realtime=v1",
          },
          body: offer.sdp || "",
        }
      );

      if (!answerResponse.ok) {
        const text = await answerResponse.text().catch(() => "");
        throw new Error(
          text.trim() || `OpenAI Realtime SDP exchange failed (${answerResponse.status})`
        );
      }

      const answerSdp = await answerResponse.text();
      if (startNonceRef.current !== nonce) return;

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to start Realtime.";
      cleanupConnection();
      setIsAutoRestarting(false);
      setPresence("ready");
      setStatus("error");
      setError(message);
      onFallbackRequested?.(message);
    }
  }, [
    cleanupConnection,
    currentUser,
    disabled,
    handleRealtimeEvent,
    markSessionConnected,
    onFallbackRequested,
    requestRealtimeSession,
    status,
    supported,
    stop,
    unlockAudio,
    liveSessionConfigKey,
  ]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    if (status !== "connected") return;
    if (!sessionOpenedRef.current) return;
    if (autoRestartRef.current) return;
    if (activeSessionConfigKeyRef.current === liveSessionConfigKey) return;

    autoRestartRef.current = true;
    preserveConversationOnRestartRef.current = true;

    void (async () => {
      try {
        setIsAutoRestarting(true);
        setPresence("reconnecting");
        setDiagnostics((current) => ({
          ...current,
          reconnectCount: current.reconnectCount + 1,
        }));
        await stop({ flushBilling: true });
      } finally {
        window.setTimeout(() => {
          autoRestartRef.current = false;
          void startRef.current?.();
        }, 0);
      }
    })();
  }, [liveSessionConfigKey, start, status, stop]);

  const displayedTranscripts = transcripts.slice().reverse();

  return (
    <section
      className={`w-full rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-slate-100 shadow-2xl shadow-black/30 backdrop-blur ${className}`}
    >
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
              {copy.title}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">{copy.subtitle}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {sessionId ? `Session ${sessionId}` : copy.noActiveSession}
              {sessionModel ? ` · ${sessionModel}` : ""}
            </p>
            {isAutoRestarting ? (
              <p className="mt-1 text-xs text-fuchsia-200">
                {copy.applyingCoach}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}
            >
              {status === "authorizing" || status === "connecting" || status === "stopping" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : status === "connected" ? (
                <Mic className="h-3.5 w-3.5" />
              ) : (
                <MicOff className="h-3.5 w-3.5" />
              )}
              {statusLabel}
            </div>
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${presenceTone}`}
            >
              {presence === "thinking" || presence === "reconnecting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : presence === "speaking" ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              {presenceLabel}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (canStop) {
                setStatus("stopping");
                void stop({ flushBilling: true });
              } else {
                void start();
              }
            }}
            disabled={buttonDisabled || status === "unsupported" || disabled}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              canStop
                ? "bg-rose-500 text-white hover:bg-rose-400 disabled:bg-rose-500/60"
                : "bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:bg-cyan-500/60"
            } disabled:cursor-not-allowed`}
          >
            {canStop ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {canStop ? copy.stop : copy.start}
          </button>

          {audioBlocked ? (
            <button
              type="button"
              onClick={() => void unlockAudio()}
              className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/20"
            >
              <Volume2 className="h-4 w-4" />
              {copy.enableAudio}
            </button>
          ) : null}

          {!supported ? (
            <span className="text-xs text-rose-200">
              {copy.unsupported}
            </span>
          ) : disabled ? (
            <span className="inline-flex items-center gap-2 text-xs text-amber-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {copy.locked}
            </span>
          ) : error ? (
            <span className="inline-flex items-center gap-2 text-xs text-rose-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {copy.billingHint}
            </span>
          )}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {copy.topicTitle}
            </p>
            <p className="mt-2 text-sm leading-6 text-white">
              {conversationTopic || copy.topicFallback}
            </p>
            <p className="mt-1 text-xs text-slate-500">{copy.topicHint}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {copy.metricsTitle}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-white">
              <MetricPill
                label={copy.connectMetric}
                value={formatMetricValue(diagnostics.connectMs, copy.noMetric)}
              />
              <MetricPill
                label={copy.firstReplyMetric}
                value={formatMetricValue(diagnostics.firstReplyMs, copy.noMetric)}
              />
              <MetricPill
                label={copy.lastReplyMetric}
                value={formatMetricValue(diagnostics.lastReplyMs, copy.noMetric)}
              />
              <MetricPill
                label={copy.reconnectMetric}
                value={String(diagnostics.reconnectCount)}
              />
              <MetricPill
                label={copy.audioResumeMetric}
                value={String(diagnostics.audioResumeAttempts)}
                className="col-span-2"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {copy.userTranscript}
            </p>
            <div className="mt-3 space-y-2">
              {displayedTranscripts.filter((entry) => entry.role === "user").length > 0 ? (
                displayedTranscripts
                  .filter((entry) => entry.role === "user")
                  .map((entry) => <TranscriptRow key={entry.id} entry={entry} />)
              ) : (
                <EmptyTranscriptState label={copy.waitingForUser} />
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {copy.assistantTranscript}
            </p>
            <div className="mt-3 space-y-2">
              {displayedTranscripts.filter((entry) => entry.role === "assistant").length > 0 ? (
                displayedTranscripts
                  .filter((entry) => entry.role === "assistant")
                  .map((entry) => <TranscriptRow key={entry.id} entry={entry} />)
              ) : (
                <EmptyTranscriptState label={copy.waitingForAssistant} />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricPill({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  const { locale } = useUiLocale();
  const copy = REALTIME_COPY[locale];
  const tone =
    entry.role === "assistant"
      ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-50"
      : entry.role === "user"
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-50"
        : "border-white/10 bg-white/5 text-slate-100";

  return (
    <div className={`rounded-2xl border px-3 py-2 ${tone}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
          {entry.role}
        </span>
        <span className="text-[10px] text-white/60">
          {entry.final ? copy.final : copy.live}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
    </div>
  );
}

function EmptyTranscriptState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
      {label}
    </div>
  );
}
