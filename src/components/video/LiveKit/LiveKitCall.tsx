"use client";

/* eslint-disable react-hooks/set-state-in-effect */
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
import { useRouter } from "next/navigation";
import Image from "next/image";
import { auth } from "@/lib/firebaseConfig";
import { getIdToken } from "firebase/auth";
import { motion } from "framer-motion";
import {
  CarouselLayout,
  ConnectionStateToast,
  ChatToggle,
  DisconnectButton,
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
import { LocalAudioTrack, Room, RoomEvent, Track } from "livekit-client";
import {
  Camera,
  CameraOff,
  Info,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  ScreenShare,
  Settings,
  Share2,
  SwitchCamera,
} from "lucide-react";
import boxingLibrary from "@/data/coach/boxing.json";
import businessLibrary from "@/data/coach/business.json";
import generalLibrary from "@/data/coach/general.json";
import meditationLibrary from "@/data/coach/meditation.json";
import mentalLibrary from "@/data/coach/mental.json";
import coachIndex from "@/data/coach/index.json";
import rumeurPositioning from "@/data/positioning/rumeur-publique.json";
import { getAuthHeader } from "@/lib/authHeader";
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
};

const LK_URL =
  process.env.NEXT_PUBLIC_LIVEKIT_URL?.replace(/\/$/, "") || "";

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
] as const;

type CaptionTarget = CaptionTargetCode;

const getBadgeClass = (active: boolean) =>
  `rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800 text-slate-500"}`;

const REALTIME_SAMPLE_RATE = 24000;
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;
const normalizeRealtimeUrl = (value?: string) => (value ?? "").trim().replace(/\/+$/, "");
const REALTIME_RETRY_DELAYS_MS = [2000, 4000, 8000];
const REALTIME_MAX_RETRIES = REALTIME_RETRY_DELAYS_MS.length;

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
  target?: CaptionTarget;
  sourceText?: string;
  sourceLang?: string;
  sourceLangName?: string;
};

type CaptionStreamOverlayProps = {
  text: string;
  onClose: () => void;
};

function CaptionStreamOverlay({ text, onClose }: CaptionStreamOverlayProps) {
  return (
    <div className="absolute inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="flex max-w-3xl items-center gap-2 rounded-2xl bg-black/70 px-3 py-2 text-sm text-white shadow-lg backdrop-blur">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
        <span className="truncate">{text || "Génération en cours…"}</span>
        <button
          type="button"
          className="ml-3 rounded-full border border-white/30 px-2 py-1 text-[10px] uppercase tracking-wide text-white"
          onClick={onClose}
        >
          Masquer
        </button>
      </div>
    </div>
  );
}

type ActionControlsProps = {
  visible: boolean;
  onAction: (type: string) => void;
  onClose: () => void;
};

function ActionControls({ visible, onAction, onClose }: ActionControlsProps) {
  if (!visible) return null;
  return (
    <div className="absolute inset-x-0 bottom-[calc(var(--lk-control-bar-height)+60px)] z-30 flex justify-center px-4">
      <div className="flex gap-2 rounded-full bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-800 shadow-lg">
        <button type="button" onClick={() => onAction("share-point")} className="rounded-full border border-slate-200 px-3 py-1">
          Partager un point clé
        </button>
        <button type="button" onClick={() => onAction("ask-summary")} className="rounded-full border border-slate-200 px-3 py-1">
          Demander un résumé
        </button>
        <button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-3 py-1">
          Fermer
        </button>
      </div>
    </div>
  );
}

type TranslateWithOpenAIOptions = {
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
};

const buildTranslateMessages = (text: string, from: string, to: string) => [
  {
    role: "system",
    content: `Translate ${from} to ${to}. Return only the translation.`,
  },
  {
    role: "user",
    content: text,
  },
];

async function fetchStreamedOpenAI(
  messages: unknown,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
) {
  const authHeader = await getAuthHeader();
  const res = await fetch("/api/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({ messages, stream: true }),
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
  { onChunk, signal }: TranslateWithOpenAIOptions = {}
) => {
  if (!process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
    // Keep backwards compatibility for environments where the key is only server-side.
  }
  if (onChunk) {
    return fetchStreamedOpenAI(
      buildTranslateMessages(text, from, to),
      onChunk,
      signal
    );
  }

  const authHeader = await getAuthHeader();
  const res = await fetch("/api/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({
      messages: buildTranslateMessages(text, from, to),
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

function useGuestCaptionPlayer(voice: string) {
  const guestAudioRef = useRef<HTMLAudioElement | null>(null);
  return useCallback(
    async (text: string, target?: CaptionTarget) => {
      if (!text.trim()) return;
      try {
        const authHeader = await getAuthHeader();
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ text, voice }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data?.error || "Erreur TTS locale");
        }
        const arrayBuffer = await res.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        guestAudioRef.current?.pause();
        const audio = new Audio(url);
        if (target && SPEECH_LANG_BY_TARGET[target]) {
          audio.lang = SPEECH_LANG_BY_TARGET[target];
        }
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (guestAudioRef.current === audio) {
            guestAudioRef.current = null;
          }
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (guestAudioRef.current === audio) {
            guestAudioRef.current = null;
          }
        };
        guestAudioRef.current = audio;
        await audio.play();
      } catch (err) {
        console.warn("Guest TTS failed", err);
      }
    },
    [voice]
  );
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
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant?.identity;

  const broadcast = useCallback(
    async (payload: AnnotationMessage) => {
      if (!roomId || !send) return;
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
        console.warn("Impossible d'envoyer la payload d'annotation", err);
      }
    },
    [roomId, send]
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
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onClearAiBackground: () => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
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
    aiBackgroundUrl,
    onAiImageGenerated,
    onClearAiBackground,
    onSaveAiBackground,
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
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const aiControllerRef = useRef<AbortController | null>(null);
  const [latestAiImage, setLatestAiImage] = useState<string | null>(null);
  const [latestAiPrompt, setLatestAiPrompt] = useState("");
  const [aiJobId, setAiJobId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<"idle" | "pending" | "processing" | "complete" | "error">(
    "idle"
  );
  const aiPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAiPolling = useCallback(() => {
    if (aiPollingRef.current) {
      clearInterval(aiPollingRef.current);
      aiPollingRef.current = null;
    }
  }, []);

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
    return () => {
      aiControllerRef.current?.abort();
      aiControllerRef.current = null;
      clearAiPolling();
    };
  }, [clearAiPolling]);

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

  const activateDrawMode = () => {
    setMode("draw");
    setAiControlsVisible((prevVisible) =>
      mode === "draw" && prevVisible ? false : true
    );
  };

  const activateTextMode = () => {
    setMode("text");
    setAiControlsVisible(false);
  };

  const pollAiJobStatus = useCallback(
    async (jobId: string, prompt: string) => {
      try {
        const response = await fetch(`/api/dalle?jobId=${jobId}`, { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error((payload?.error as string) || "Impossible de vérifier le job.");
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
          const proxiedImage = `/api/dalle/image?jobId=${jobId}`;
          setLatestAiImage(proxiedImage);
          setLatestAiPrompt(data.prompt || prompt);
          onAiImageGenerated(proxiedImage);
          setAiLoading(false);
          setAiJobId(null);
          setAiError("");
        } else if (nextStatus === "error") {
          clearAiPolling();
          setAiLoading(false);
          setAiJobId(null);
          setAiError(data.errorMessage || "Erreur lors de la génération.");
          setAiStatus("error");
        }
      } catch (err) {
        console.error("DALL·E job status :", err);
        clearAiPolling();
        setAiLoading(false);
        setAiJobId(null);
        setAiStatus("error");
        setLatestAiImage(null);
        setLatestAiPrompt("");
        setAiError(err instanceof Error ? err.message : "Erreur réseau.");
      }
    },
    [clearAiPolling, onAiImageGenerated]
  );

  const startAiPolling = useCallback(
    (jobId: string, prompt: string) => {
      clearAiPolling();
      setAiJobId(jobId);
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
    const trimmed = aiPrompt.trim();
    if (!trimmed) {
      setAiError("Décris l’ambiance que tu veux créer.");
      return;
    }
    aiControllerRef.current?.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;
    clearAiPolling();
    setAiError("");
    setLatestAiImage(null);
    setLatestAiPrompt(trimmed);
    setAiLoading(true);
    try {
      const response = await fetch("/api/dalle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload?.error as string) || "Impossible de créer la demande.");
      }
      const payload = await response.json();
      if (!payload.jobId) {
        throw new Error("Aucun job id reçu.");
      }
      startAiPolling(payload.jobId, trimmed);
    } catch (err) {
      setLatestAiImage(null);
      setLatestAiPrompt("");
      if (controller.signal.aborted) return;
      console.error("DALL·E :", err);
      setAiError(err instanceof Error ? err.message : "Erreur de génération.");
      setAiStatus("error");
      setAiLoading(false);
    } finally {
      if (aiControllerRef.current === controller) {
        aiControllerRef.current = null;
      }
    }
  }, [aiPrompt, clearAiPolling, startAiPolling]);

  const handleSaveAiToGallery = useCallback(() => {
    if (!latestAiImage || !latestAiPrompt) return;
    onSaveAiBackground(latestAiPrompt, latestAiImage);
    setAiError("Fond enregistré dans ta galerie.");
  }, [latestAiImage, latestAiPrompt, onSaveAiBackground]);

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
  const [aiControlsVisible, setAiControlsVisible] = useState(false);

  useEffect(() => {
    if (mode === "text") {
      setAiControlsVisible(false);
    }
  }, [mode]);

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
  const aiStatusMessage =
    aiError ||
    (aiStatus === "pending" || aiStatus === "processing"
      ? "Génération IA en cours…"
      : aiBackgroundUrl
      ? "Fond IA actif — tu peux le supprimer ou en générer un autre."
      : "Décris un décor mental ou un état d’énergie. L’image remplacera ton arrière-plan virtuel.");

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
      {isHost && (
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
                  disabled={mode === "text"}
                >
                  {drawingEnabled ? "Feutre actif" : "Activer le feutre"}
                </button>
                <button
                  type="button"
                  onClick={activateDrawMode}
                  className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                    mode === "draw"
                      ? "bg-sky-500 text-white shadow-lg"
                      : "bg-white/80 text-slate-900 shadow"
                  }`}
                  aria-pressed={mode === "draw"}
                >
                  Fond DALL·E
                </button>
                <button
                  type="button"
                  onClick={activateTextMode}
                  className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                    mode === "text"
                      ? "bg-white text-slate-900 shadow"
                      : "bg-white/80 text-slate-900 shadow"
                  }`}
                  aria-pressed={mode === "text"}
                >
                  Tag fond écran
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
      {isHost && aiControlsVisible && (
        <div className="absolute left-1/2 bottom-4 z-40 w-[calc(100%-1.5rem)] max-w-[360px] -translate-x-1/2 rounded-2xl border border-white/20 bg-black/60 p-3 text-white shadow-lg backdrop-blur-lg pointer-events-auto">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Prompt (ex: lumière douce, studio zen, portraits en mouvement)"
                className="flex-1 min-w-0 rounded-lg border border-white/30 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/50 focus:border-sky-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleGenerateAi}
                disabled={aiLoading}
                className="w-full rounded-lg bg-sky-500 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white disabled:opacity-60 sm:w-auto"
              >
                {aiLoading ? "Génération..." : "DALL·E"}
              </button>
              <button
                type="button"
                onClick={handleSaveAiToGallery}
                disabled={!latestAiImage || !latestAiPrompt || aiLoading}
                className="w-full rounded-lg border border-white/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white disabled:border-slate-700 disabled:text-slate-500 sm:w-auto"
              >
                Enregistrer
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-white/60">{aiStatusMessage}</p>
              <button
                type="button"
                onClick={() => setAiControlsVisible(false)}
                className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70 hover:text-white"
              >
                Fermer
              </button>
            </div>
            {aiBackgroundUrl && (
              <div className="flex items-center justify-between text-[11px] text-slate-200">
                <span>Fond IA appliqué.</span>
                <button
                  type="button"
                  onClick={onClearAiBackground}
                  className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-300 hover:text-rose-200"
                >
                  Supprimer
                </button>
              </div>
            )}
          </div>
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

const base64FromArrayBuffer = (buffer: ArrayBuffer) => {
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
}: {
  enabled: boolean;
  isHost: boolean;
  captionTargetName: string;
  captionSourceName?: string;
  realtimeVoice: string;
  localParticipant?: LocalParticipant;
  onError: (message: string) => void;
  onStatus?: (status: RealtimeStatus) => void;
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
        turn_detection: { type: "server_vad" },
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
  }, [localParticipant]);

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
        await context.audioWorklet.addModule("/audio/realtime-processor.js");
        const workletNode = new AudioWorkletNode(context, "realtime-processor");
        realtimeWorkletRef.current = workletNode;
        workletNode.port.onmessage = (event) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const input = event.data as Float32Array;
          const downsampled = downsampleBuffer(input, context.sampleRate, REALTIME_SAMPLE_RATE);
          if (!downsampled) return;
          const pcm16 = floatToPcm16(downsampled);
          const base64 = base64FromArrayBuffer(pcm16.buffer);
          wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
        };

        source.connect(workletNode);
        workletNode.connect(gain);
        gain.connect(context.destination);

        ws.onopen = () => {
          retryStateRef.current.attempts = 0;
          onStatus?.("open");
          console.log("[realtime] ws.onopen");
          wsOpeningRef.current = false;
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
          onError("Realtime: connexion impossible.");
          onStatus?.("error");
          if (retryStateRef.current.attempts < REALTIME_MAX_RETRIES) {
            const delay =
              REALTIME_RETRY_DELAYS_MS[
                Math.min(retryStateRef.current.attempts, REALTIME_RETRY_DELAYS_MS.length - 1)
              ];
            retryStateRef.current.attempts += 1;
            retryTimerRef.current = setTimeout(() => {
              if (cancelled) return;
              void startRealtime();
            }, delay);
          }
        };
        ws.onclose = (event) => {
          console.log("[realtime] ws.onclose", { code: event.code, reason: event.reason });
          wsOpeningRef.current = false;
          if (pendingStopRef.current) {
            pendingStopRef.current = false;
          }
          wsRef.current = null;
          if (cancelled) return;
          if (event.code && event.code !== 1000) {
            onError(`Realtime: connexion fermee (${event.code}).`);
            onStatus?.("error");
            if (retryStateRef.current.attempts < REALTIME_MAX_RETRIES) {
              const delay =
                REALTIME_RETRY_DELAYS_MS[
                  Math.min(retryStateRef.current.attempts, REALTIME_RETRY_DELAYS_MS.length - 1)
                ];
              retryStateRef.current.attempts += 1;
              retryTimerRef.current = setTimeout(() => {
                if (cancelled) return;
                void startRealtime();
              }, delay);
            }
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
      void stopRealtime();
    };
  }, [enabled, isHost, localParticipant, onError, onStatus, stopRealtime, buildSessionUpdate]);

  useEffect(() => {
    if (!enabled || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(buildSessionUpdate()));
  }, [enabled, buildSessionUpdate]);
};

type SuggestionMode =
  | "general"
  | "rp"
  | "business"
  | "fitness"
  | "writer"
  | "care";

const SUGGESTION_MODES: { id: SuggestionMode; label: string; hint: string }[] = [
  {
    id: "general",
    label: "General",
    hint: "Reponses libres et naturelles, sans jargon.",
  },
  {
    id: "rp",
    label: "Communication strategique (RP)",
    hint: "Messages corporate coherents, factuels, influence.",
  },
  {
    id: "business",
    label: "Coach mental pro",
    hint: "Clarte, assertivite, objectifs, posture executive.",
  },
  {
    id: "fitness",
    label: "Preparateur physique",
    hint: "Motivation, effort, progression, rythme.",
  },
  {
    id: "writer",
    label: "Style Brice Faradji",
    hint: "Ton direct, image forte, oralite soignee.",
  },
  {
    id: "care",
    label: "Ecoute sensible",
    hint: "Bienveillance, questions ouvertes, sans diagnostic.",
  },
];

export default function LiveKitCall({
  roomId,
  onParticipantCount,
  isHost,
  onLeave,
  audioOnly,
}: {
  roomId: string;
  onParticipantCount?: (count: number) => void;
  isHost: boolean;
  onLeave?: () => void;
  audioOnly?: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [tokenRetryTrigger, setTokenRetryTrigger] = useState(0);
  const handleRetryToken = useCallback(() => {
    setToken("");
    setError("");
    setTokenRetryTrigger((prev) => prev + 1);
  }, []);
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
        id:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}`,
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
  const [preJoinChoices, setPreJoinChoices] = useState<LocalUserChoices | null>(null);
  const [autoFrame, setAutoFrame] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionSize, setCaptionSize] = useState<"sm" | "md" | "lg">("md");
  const [captionTarget, setCaptionTarget] = useState<CaptionTarget>(DEFAULT_CAPTION_TARGET);
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
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [hostLocalTtsEnabled, setHostLocalTtsEnabled] = useState(false);
  const [shareMicToGuests, setShareMicToGuests] = useState(true);
  const [guestTtsEnabled, setGuestTtsEnabled] = useState(false);
  const [guestCaptionTarget, setGuestCaptionTarget] = useState<CaptionTarget>(captionTarget);

  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [realtimeVoiceInput, setRealtimeVoiceInput] = useState(
    process.env.NEXT_PUBLIC_REALTIME_VOICE || "alloy"
  );
  const [realtimeError, setRealtimeError] = useState("");
  const [ttsError, setTtsError] = useState("");
  const [videoFit, setVideoFit] = useState<"cover" | "contain">("cover");
  const realtimeAvailable = Boolean(REALTIME_URL);
  const onRealtimeError = useCallback((message: string) => setRealtimeError(message), []);
  const onTtsError = useCallback((message: string) => setTtsError(message), []);
  const captionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget)?.name || "English",
    [captionTarget]
  );
  const prevHostCaptionTargetRef = useRef<CaptionTarget>(captionTarget);
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
    (target: CaptionTarget) => {
      setGuestCaptionTarget(target);
    },
    []
  );
  const positioningGuide = useMemo(() => {
    const company = rumeurPositioning.company;
    const expertise = rumeurPositioning.expertise.join(", ");
    const values = company.positioning.value.join("; ");
    const crisis = rumeurPositioning.corporate_comms.crisis_method;
    return [
      `Marque: ${company.name}.`,
      `Tagline: ${company.tagline}.`,
      `Positionnement: ${company.positioning.core}.`,
      `Valeurs: ${values}.`,
      `Expertises: ${expertise}.`,
      `Crise (avant): ${crisis.before.join("; ")}.`,
      `Crise (pendant): ${crisis.during.join("; ")}.`,
    ].join(" ");
  }, []);
  const captionsSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  }, []);


  const identity = useMemo(
    () => (typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}`),
    []
  );
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
    if (!realtimeEnabled) return;
    if (ttsError) setTtsError("");
    if (shareMicToGuests) setShareMicToGuests(false);
  }, [realtimeEnabled, ttsError, shareMicToGuests]);

  useEffect(() => {
    if (realtimeEnabled) return;
    if (realtimeError) setRealtimeError("");
  }, [realtimeEnabled, realtimeError]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!roomId) {
      setToken("");
      setError("");
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setToken("");
    setError("");

    const fetchToken = async () => {
      try {
        const displayName =
          preJoinChoices?.username ||
          (isHost ? `Hôte-${identity.slice(0, 6)}` : `Invité-${identity.slice(0, 6)}`);
        const authHeader = await getAuthHeader();
        const res = await fetch("/api/livekit/token", {
          signal: controller.signal,
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            room: roomId,
            identity,
            name: displayName,
            role: isHost ? "host" : "guest",
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `Token LiveKit error (${res.status})${body ? `: ${body}` : ""}`
          );
        }
        const nextToken = (await res.text()).trim();
        if (!nextToken || nextToken.split(".").length !== 3) {
          throw new Error("Token LiveKit invalide");
        }
        if (!cancelled) setToken(nextToken);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : "Erreur inconnue lors de la génération du token.";
        setError(message);
      }
    };

    void fetchToken();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomId, identity, isHost, preJoinChoices?.username, tokenRetryTrigger]);

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
        <p className="text-sm text-red-800/80 break-words">{error}</p>
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
              username: isHost ? "Hote" : "Invite",
              audioEnabled: true,
              videoEnabled: true,
            }}
            joinLabel="Rejoindre"
            userLabel="Nom"
            micLabel="Micro"
            camLabel="Camera"
            onSubmit={(values) => setPreJoinChoices(values)}
          />
          <p className="mt-4 text-xs text-slate-400 text-center">
            Active ton micro et ta camera puis clique sur Rejoindre.
          </p>
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
        token={token}
        serverUrl={LK_URL}
        connect
        audio={audioOptions}
        video={videoOptions}
        options={roomOptions}
        onDisconnected={() => {
          if (onLeave) {
            onLeave();
            return;
          }
          router.push("/");
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
            roomId={roomId}
            isHost={isHost}
            onChangeBackground={setBackgroundMode}
            autoFrame={autoFrame}
            onToggleAutoFrame={() => setAutoFrame((value) => !value)}
            captionsEnabled={captionsEnabled}
            captionsSupported={captionsSupported}
            onToggleCaptions={() => setCaptionsEnabled((value) => !value)}
            onDisableCaptions={() => setCaptionsEnabled(false)}
            captionTarget={captionTarget}
            onChangeCaptionTarget={setCaptionTarget}
            sourceLanguageOption={sourceLanguageOption}
            sourceLanguage={sourceLanguage}
            onChangeSourceLanguage={handleSourceLanguageChange}
            ttsEnabled={ttsEnabled}
            onToggleTts={() => setTtsEnabled((value) => !value)}
            realtimeEnabled={realtimeEnabled}
            realtimeAvailable={Boolean(REALTIME_URL)}
            realtimeVoice={realtimeVoiceInput}
            onChangeRealtimeVoice={setRealtimeVoiceInput}
            onToggleRealtime={() => setRealtimeEnabled((value) => !value)}
            realtimeError={realtimeError}
            onRealtimeError={onRealtimeError}
            hostLocalTtsEnabled={hostLocalTtsEnabled}
            onToggleHostLocalTts={() => setHostLocalTtsEnabled((value) => !value)}
            shareMicToGuests={shareMicToGuests}
            onToggleShareMicToGuests={() => setShareMicToGuests((value) => !value)}
            guestCaptionTarget={guestCaptionTarget}
            onChangeGuestCaptionTarget={handleGuestCaptionTargetChange}
            guestTtsEnabled={guestTtsEnabled}
            onToggleGuestTts={() => setGuestTtsEnabled((value) => !value)}
            ttsError={ttsError}
            onTtsError={setTtsError}
            captionSize={captionSize}
            onChangeCaptionSize={setCaptionSize}
            videoFit={videoFit}
            onChangeVideoFit={setVideoFit}
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

function useIsMobileViewport(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, [breakpoint]);

  return isMobile;
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
  ttsError,
  onTtsError,
  onDisableCaptions,
  captionSize,
  onChangeCaptionSize,
  videoFit,
  onChangeVideoFit,
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
  ttsError: string;
  onTtsError: (message: string) => void;
  onDisableCaptions: () => void;
  captionSize: "sm" | "md" | "lg";
  onChangeCaptionSize: (size: "sm" | "md" | "lg") => void;
  videoFit: "cover" | "contain";
  onChangeVideoFit: (fit: "cover" | "contain") => void;
}) {
  const isMobileDevice = useIsMobileViewport();
  const isIPhone = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /iPhone|iPod/i.test(ua);
  }, []);
  const useMobileLayout = isMobileDevice || isIPhone;
  const { cameraTrack, isCameraEnabled, localParticipant } = useLocalParticipant();
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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
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
  const realtimeAudioTracks = useTracks(
    [{ source: Track.Source.ScreenShareAudio, withPlaceholder: false }],
    { onlySubscribed: true }
  );
  const hasRealtimeAudio = useMemo(
    () =>
      realtimeAudioTracks.some(
        (track) => isTrackReference(track) && !track.participant.isLocal
      ),
    [realtimeAudioTracks]
  );
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
  useEffect(() => {
    const track = cameraTrack?.track;
    if (
      !track ||
      typeof (track as { setProcessor?: (p?: unknown) => Promise<void> }).setProcessor !== "function"
    ) {
      return;
    }

    if (isIPhone) {
      processorRef.current?.destroy?.();
      processorRef.current = null;
      processorDisabledRef.current = true;
      if (backgroundMode !== "none") {
        onChangeBackground("none");
      }
      return;
    }

    let cancelled = false;

    const applyProcessor = async () => {
      if (processorDisabledRef.current) return;
      if (isIPhone) return;

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
    };
  }, [backgroundMode, backgroundOptions, cameraTrack?.track, isMobileDevice, isIPhone, onChangeBackground]);

  return (
    <>
        <SettingsDrawer
        roomId={roomId}
        isHost={isHost}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        backgroundMode={backgroundMode}
        customBackgrounds={customBackgrounds}
        onAddCustomBackground={onAddCustomBackground}
        onRemoveCustomBackground={onRemoveCustomBackground}
        onChangeBackground={onChangeBackground}
        backgroundDisabled={isIPhone}
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
        realtimeStatus={realtimeError ? "error" : realtimeEnabled ? "connecting" : "idle"}
        realtimeError={realtimeError}
        hostLocalTtsEnabled={hostLocalTtsEnabled}
        onToggleHostLocalTts={onToggleHostLocalTts}
        shareMicToGuests={shareMicToGuests}
        onToggleShareMicToGuests={onToggleShareMicToGuests}
        guestCaptionTarget={guestCaptionTarget}
        onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
        guestTtsEnabled={guestTtsEnabled}
          guestTtsDisabled={!isHost && hasRealtimeAudio}
          onToggleGuestTts={onToggleGuestTts}
          ttsError={ttsError}
          captionSize={captionSize}
          onChangeCaptionSize={onChangeCaptionSize}
        videoFit={videoFit}
        onChangeVideoFit={onChangeVideoFit}
        onSendToChat={roomChat.sendMessage}
        timerState={roomTimer.state}
        timerActions={roomTimer.actions}
        aiBackgroundUrl={aiBackgroundUrl}
        onAiBackgroundClear={onClearAiBackground}
        aiGallery={aiGallery}
        onAiGallerySelect={onAiGallerySelect}
        />
      {useMobileLayout ? (
        <LiveKitConferenceMobile
          roomId={roomId}
          isHost={isHost}
          guestTtsEnabled={guestTtsEnabled}
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
          autoFrame={autoFrame}
          captionSize={captionSize}
          videoFit={videoFit}
          sourceLanguage={sourceLanguage}
          onChangeSourceLanguage={onChangeSourceLanguage}
          guestCaptionTarget={guestCaptionTarget}
          onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
          isSettingsOpen={settingsOpen}
        aiBackgroundUrl={aiBackgroundUrl}
        onAiImageGenerated={onAiImageGenerated}
        onClearAiBackground={onClearAiBackground}
        aiGallery={aiGallery}
        onAiGallerySelect={onAiGallerySelect}
        onSaveAiBackground={onSaveAiBackground}
        />
      ) : (
        <LiveKitConference
          roomId={roomId}
          widgetState={widgetState}
          onWidgetChange={handleWidgetChange}
          roomChat={roomChat}
          timerState={roomTimer.state}
          onOpenSettings={() => setSettingsOpen(true)}
          autoFrame={autoFrame}
          captionsEnabled={captionsEnabled}
          captionsSupported={captionsSupported}
          captionTarget={captionTarget}
          ttsEnabled={ttsEnabled}
          realtimeEnabled={realtimeEnabled}
          realtimeAvailable={realtimeAvailable}
          realtimeVoice={realtimeVoice}
          onRealtimeStatus={() => {}}
          onRealtimeError={onRealtimeError}
          hostLocalTtsEnabled={hostLocalTtsEnabled}
          shareMicToGuests={shareMicToGuests}
          guestTtsEnabled={guestTtsEnabled}
          ttsError={ttsError}
          suggestionsOpen={suggestionsOpen}
          onToggleSuggestions={() => setSuggestionsOpen((value) => !value)}
          isHost={isHost}
          onDisableCaptions={onDisableCaptions}
          captionSize={captionSize}
          videoFit={videoFit}
          onTtsError={onTtsError}
          sourceLanguageOption={sourceLanguageOption}
          sourceLanguage={sourceLanguage}
          onChangeSourceLanguage={onChangeSourceLanguage}
          guestCaptionTarget={guestCaptionTarget}
          onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
          aiBackgroundUrl={aiBackgroundUrl}
          onAiImageGenerated={onAiImageGenerated}
          onClearAiBackground={onClearAiBackground}
          aiGallery={aiGallery}
          onAiGallerySelect={onAiGallerySelect}
          onSaveAiBackground={onSaveAiBackground}
          isSettingsOpen={settingsOpen}
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

type SuggestedResponse = {
  id: string;
  text: string;
  heard: string;
  createdAt: number;
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
  const seenMessageIds = useRef<Set<string>>(new Set());
  const { message: incoming, send, isSending } = useDataChannel("bfzoom-chat");

  const localId = localParticipant?.identity || "local";
  const localName = localParticipant?.name || "Moi";

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
        }
      });
    } catch (err) {
      console.warn("Chat payload invalide", err);
    }
  }, [incoming, isChatOpen, localId, roomId]);

  useEffect(() => {
    if (isChatOpen && unreadCount > 0) {
      queueMicrotask(() => {
        setUnreadCount(0);
      });
    }
  }, [isChatOpen, unreadCount]);

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
      id: typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}`,
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
  autoFrame,
  captionsEnabled,
  captionsSupported,
  captionTarget,
  ttsEnabled,
  realtimeEnabled,
  realtimeAvailable,
  realtimeVoice,
  onRealtimeStatus,
  onRealtimeError,
  hostLocalTtsEnabled,
  shareMicToGuests,
  guestTtsEnabled,
  ttsError,
  suggestionsOpen,
  onToggleSuggestions,
  isHost,
  onDisableCaptions,
  captionSize,
  videoFit,
  onTtsError,
  sourceLanguageOption,
  sourceLanguage,
  onChangeSourceLanguage,
  guestCaptionTarget,
  onChangeGuestCaptionTarget,
  aiGallery,
  onAiGallerySelect,
  aiBackgroundUrl,
  onAiImageGenerated,
  onClearAiBackground,
  onSaveAiBackground,
  isSettingsOpen,
}: {
  roomId: string;
  widgetState: { showChat: boolean; unreadMessages: number; showSettings?: boolean };
  onWidgetChange: (state: { showChat: boolean; unreadMessages: number; showSettings?: boolean }) => void;
  roomChat: ReturnType<typeof useRoomChat>;
  timerState: RoomTimerState;
  onOpenSettings: () => void;
  autoFrame: boolean;
  captionsEnabled: boolean;
  captionsSupported: boolean;
  captionTarget: CaptionTarget;
  ttsEnabled: boolean;
  realtimeEnabled: boolean;
  realtimeAvailable: boolean;
  realtimeVoice: string;
  onRealtimeStatus: (status: RealtimeStatus) => void;
  onRealtimeError: (message: string) => void;
  hostLocalTtsEnabled: boolean;
  shareMicToGuests: boolean;
  guestTtsEnabled: boolean;
  ttsError: string;
  suggestionsOpen: boolean;
  onToggleSuggestions: () => void;
  isHost: boolean;
  onDisableCaptions: () => void;
  captionSize: "sm" | "md" | "lg";
  videoFit: "cover" | "contain";
  onTtsError: (message: string) => void;
  sourceLanguageOption: SourceLanguageOption;
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  guestCaptionTarget: CaptionTarget;
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onClearAiBackground: () => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  isSettingsOpen: boolean;
}) {
  const layoutContext = useCreateLayoutContext();
  const [isMobile, setIsMobile] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const [actionControlsState, setActionControlsState] = useState({
    visible: false,
    lastAction: "",
  });
  const isIPhone = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);
  const { send: sendAction } = useDataChannel("bfzoom-actions");
  const sendActionItem = useCallback(
    async (type: string) => {
      if (!sendAction) return;
      const text = actionControlsState.lastAction;
      if (!text) return;
      const payload = {
        id: typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}`,
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
    if (!isHost || !roomId || typeof window === "undefined") return;
    const key = `bfzoom:invite-opened:${roomId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setInviteOpen(true);
  }, [isHost, roomId]);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
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
  const remoteAudioTrack = useMemo(() => {
    for (const participant of remoteParticipants) {
      if (participant.identity === localParticipant?.identity) continue;
      const pub = participant.getTrackPublication(Track.Source.Microphone);
      const track = pub?.track as { mediaStreamTrack?: MediaStreamTrack } | undefined;
      if (track?.mediaStreamTrack) return track.mediaStreamTrack;
    }
    return null;
  }, [remoteParticipants, localParticipant?.identity]);
  const room = useRoomContext();
  const lastCameraRefreshRef = useRef(0);
  const initialPageShowRef = useRef(true);
  const lastAutoPinnedParticipantRef = useRef<string | null>(null);
  const manualPinRef = useRef(false);
  const lastAutoSpeakerRef = useRef<string | null>(null);
  const lastAutoSpeakerSwitchRef = useRef(0);
  const [mediaError, setMediaError] = useState<string>("");
  const [captionText, setCaptionText] = useState("");
  const [captionError, setCaptionError] = useState("");
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const [captionStreamState, setCaptionStreamState] = useState({
    active: false,
    text: "",
    error: "",
  });
  const { message: captionIncoming, send: sendCaption } = useDataChannel("bfzoom-captions");
  const lastCaptionSentAtRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopOnErrorRef = useRef(false);
const captionTargetLabel = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget)?.label || "EN",
    [captionTarget]
  );
  const ttsTrackRef = useRef<LocalAudioTrack | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsContextRef = useRef<AudioContext | null>(null);
  const ttsDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const speakGuestCaption = useGuestCaptionPlayer(realtimeVoice);
  const [suggestions, setSuggestions] = useState<SuggestedResponse[]>([]);
  const [listening, setListening] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [useGuidelines, setUseGuidelines] = useState(true);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>("rp");
  const lastSuggestAtRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const listeningRef = useRef(false);
  const suggestingRef = useRef(false);
  const captionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget)?.name || "English",
    [captionTarget]
  );
  const guestCaptionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === guestCaptionTarget)?.name || "English",
    [guestCaptionTarget]
  );
  const sourceLanguageName = sourceLanguageOption.name;
  const sourceLanguageLocale = sourceLanguageOption.recognitionLocale;
  useRealtimeTranslation({
    enabled: realtimeEnabled && realtimeAvailable,
    isHost,
    captionTargetName,
    captionSourceName: sourceLanguageOption.name,
    realtimeVoice,
    localParticipant,
    onError: onRealtimeError,
    onStatus: onRealtimeStatus,
  });
  const positioningGuide = useMemo(() => {
    const company = rumeurPositioning.company;
    const expertise = rumeurPositioning.expertise.join(", ");
    const values = company.positioning.value.join("; ");
    const crisis = rumeurPositioning.corporate_comms.crisis_method;
    return [
      `Marque: ${company.name}.`,
      `Tagline: ${company.tagline}.`,
      `Positionnement: ${company.positioning.core}.`,
      `Valeurs: ${values}.`,
      `Expertises: ${expertise}.`,
      `Crise (avant): ${crisis.before.join("; ")}.`,
      `Crise (pendant): ${crisis.during.join("; ")}.`,
    ].join(" ");
  }, []);

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

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    suggestingRef.current = suggesting;
  }, [suggesting]);

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

  const stopRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
    recorderRef.current = null;
  }, []);

  const requestSuggestions = useCallback(
    async (blob: Blob) => {
      if (!listeningRef.current || suggestingRef.current) return;
      const now = Date.now();
      if (now - lastSuggestAtRef.current < 4500) return;
      lastSuggestAtRef.current = now;

      setSuggesting(true);
      suggestingRef.current = true;
      try {
        const formData = new FormData();
        formData.append("file", blob, "audio.webm");
        const authHeader = await getAuthHeader();
        const transcriptResponse = await fetch("/api/transcribe", {
          method: "POST",
          headers: { ...authHeader },
          body: formData,
        });
        const transcriptPayload = await transcriptResponse.json();
        if (!transcriptResponse.ok) {
          throw new Error(transcriptPayload?.error || "Transcription impossible.");
        }
        const transcript = String(transcriptPayload?.text || "").trim();
        if (!transcript || transcript.length < 6) return;
        if (transcript === lastHeard) return;
        setLastHeard(transcript);

        const systemPrompt = [
          "Donne 3 reponses possibles, courtes (1-2 phrases) et concretes.",
          "Ne fabrique pas de faits, reste prudent.",
          "Reponds en francais.",
          suggestionMode === "general"
            ? "Ton naturel, clair, sans jargon."
            : "",
          suggestionMode === "rp"
            ? "Tu es un coach RP qui aide un porte-parole a repondre avec impact."
            : "",
          suggestionMode === "business"
            ? "Tu es un coach mental pour dirigeants: clarté, assertivite, structure."
            : "",
          suggestionMode === "fitness"
            ? "Tu es un preparateur physique: motivation, rythme, progression concrete."
            : "",
          suggestionMode === "writer"
            ? "Tu ecris avec le ton de Brice Faradji: direct, image vive, oralite soignee. Pas d'insulte."
            : "",
          suggestionMode === "care"
            ? "Tu offres une ecoute bienveillante: reformule, pose des questions ouvertes, propose du soutien. Pas de diagnostic ni conseil medical."
            : "",
          suggestionMode === "rp" && useGuidelines
            ? `Contexte entreprise: ${positioningGuide}`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        const suggestResponse = await fetch("/api/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: transcript },
            ],
          }),
        });
        const suggestPayload = await suggestResponse.json();
        if (!suggestResponse.ok) {
          throw new Error(suggestPayload?.error || "Suggestions indisponibles.");
        }
        const content = String(
          suggestPayload?.choices?.[0]?.message?.content || ""
        ).trim();
        const parsed = content
          .split("\n")
          .map((line) => line.replace(/^[-\\d.).\\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 3);
        if (parsed.length === 0) return;
        const createdAt = Date.now();
        const entries = parsed.map((text, index) => ({
          id: `${createdAt}-${index}`,
          text,
          heard: transcript,
          createdAt,
        }));
        setSuggestions((prev) => [...entries, ...prev].slice(0, 12));
        setSuggestError("");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Erreur suggestions.";
        setSuggestError(message);
      } finally {
        setSuggesting(false);
        suggestingRef.current = false;
      }
    },
    [lastHeard, positioningGuide, suggestionMode, useGuidelines]
  );

  const startRecorder = useCallback(() => {
    if (!remoteAudioTrack) {
      setSuggestError("Aucun audio interlocuteur.");
      setListening(false);
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setSuggestError("Enregistrement audio non supporte.");
      return;
    }
    const mimeType = getRecorderMimeType();
    const stream = new MediaStream([remoteAudioTrack]);
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      void requestSuggestions(event.data);
    };
    recorder.onerror = () => {
      setSuggestError("Enregistrement audio interrompu.");
      setListening(false);
    };
    try {
      recorder.start(4000);
    } catch {
      setSuggestError("Impossible de demarrer l'ecoute.");
      setListening(false);
    }
  }, [getRecorderMimeType, remoteAudioTrack, requestSuggestions]);

  useEffect(() => {
    if (!suggestionsOpen) {
      setListening(false);
      return;
    }
    if (!listening) {
      stopRecorder();
      return;
    }
    stopRecorder();
    startRecorder();
    return () => stopRecorder();
  }, [listening, startRecorder, stopRecorder, suggestionsOpen]);

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
    if (!localParticipant) return false;
    if (ttsTrackRef.current) return true;
    const context = ttsContextRef.current ?? new AudioContext();
    ttsContextRef.current = context;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {}
    }
    const destination = ttsDestinationRef.current ?? context.createMediaStreamDestination();
    ttsDestinationRef.current = destination;
    const [audioTrack] = destination.stream.getAudioTracks();
    if (!audioTrack) {
      onTtsError("Synthese vocale: aucun flux audio.");
      return false;
    }
    const localTrack = new LocalAudioTrack(audioTrack, undefined, true);
    ttsTrackRef.current = localTrack;
    try {
      await localParticipant.publishTrack(localTrack, { source: Track.Source.ScreenShareAudio });
    } catch (err) {
      onTtsError("Synthese vocale: publication audio impossible.");
      localTrack.stop();
      ttsTrackRef.current = null;
      return false;
    }
    return true;
  }, [localParticipant, onTtsError]);

  const playNextTts = useCallback(async () => {
    if (ttsPlayingRef.current) return;
    const nextText = ttsQueueRef.current.shift();
    if (!nextText) return;
    if (!ttsEnabled) return;
    if (hostLocalTtsEnabled) {
      void speakGuestCaption(nextText, captionTarget);
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
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ text: nextText, voice: realtimeVoice }),
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
  }, [captionTarget, ensureTtsTrack, hostLocalTtsEnabled, onTtsError, speakGuestCaption, ttsEnabled]);

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
        setCaptionText(payload.text);
        if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
        captionTimerRef.current = setTimeout(() => setCaptionText(""), 15000);
        if (!isHost && guestTtsEnabled) {
          let guestText = payload.text;
          let guestTarget = payload.target;
          if (
            guestCaptionTarget &&
            guestCaptionTargetName &&
            payload.sourceText &&
            payload.sourceLangName &&
            payload.target !== guestCaptionTarget
          ) {
            try {
              const guestTranslation = await translateWithOpenAi(
                payload.sourceText,
                payload.sourceLangName,
                guestCaptionTargetName
              );
              if (guestTranslation) {
                guestText = guestTranslation;
                guestTarget = guestCaptionTarget;
              }
            } catch (err) {
              console.warn("Guest translation failed", err);
            }
          }
          if (cancelled) return;
          void speakGuestCaption(guestText ?? payload.text, guestTarget ?? payload.target);
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
    guestCaptionTarget,
    guestCaptionTargetName,
    guestTtsEnabled,
    isHost,
    localParticipant?.identity,
    roomId,
    speakGuestCaption,
  ]);

  useEffect(() => {
    return () => {
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!captionsEnabled || !captionsSupported || !isHost) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    const SpeechCtor =
      (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechCtor) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    stopOnErrorRef.current = false;
    const recognition = new SpeechCtor();
    recognitionRef.current = recognition;
    setCaptionError("");
    recognition.lang = sourceLanguageOption.recognitionLocale;
    recognition.continuous = true;
    recognition.interimResults = false;

    const translateAndBroadcast = async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      const now = Date.now();
      if (now - lastCaptionSentAtRef.current < 700) return;
      lastCaptionSentAtRef.current = now;
      try {
        translationAbortRef.current?.abort();
        const controller = new AbortController();
        translationAbortRef.current = controller;
        setCaptionStreamState({ active: true, text: "", error: "" });
        let streamingAccumulator = "";
        const translated = await translateWithOpenAi(
          trimmed,
          sourceLanguageName,
          captionTargetName,
          {
            signal: controller.signal,
            onChunk: (chunk) => {
              streamingAccumulator += chunk;
              setCaptionStreamState((state) => ({
                ...state,
                active: true,
                text: streamingAccumulator,
              }));
              setCaptionText((prev) => prev + chunk);
              if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
              captionTimerRef.current = setTimeout(() => setCaptionText(""), 15000);
            },
          }
        );
        const finalTranslation = translated || streamingAccumulator;
        if (!finalTranslation) return;
        setCaptionText(finalTranslation);
        setCaptionStreamState((state) => ({
          ...state,
          active: false,
          text: finalTranslation,
        }));
        if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
        captionTimerRef.current = setTimeout(() => setCaptionText(""), 15000);
        const payload = {
          id: typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}`,
          text: translated,
          target: captionTarget,
          sourceText: trimmed,
          sourceLang: sourceLanguage,
          sourceLangName: sourceLanguageName,
          from: localParticipant?.identity || "host",
          timestamp: Date.now(),
          roomId,
        };
        setCaptionText(translated);
        if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
        captionTimerRef.current = setTimeout(() => setCaptionText(""), 15000);
        enqueueTts(translated);
        if (hostLocalTtsEnabled && realtimeEnabled) {
          void speakGuestCaption(translated, captionTarget);
        }
        const encoder = new TextEncoder();
        await sendCaption(encoder.encode(JSON.stringify(payload)), {
          reliable: true,
          topic: "bfzoom-captions",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur traduction";
        setCaptionError(`Traduction: ${message}`);
        setCaptionStreamState({ active: false, text: "", error: message });
        console.warn("Erreur traduction", err);
      }
    };

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal && result[0]?.transcript) {
          void translateAndBroadcast(result[0].transcript);
        }
      }
    };

    recognition.onerror = (event: any) => {
      const reason = event?.error || "speech_error";
      if (reason === "aborted") {
        return;
      }
      if (reason === "no-speech") {
        setCaptionError("SpeechRecognition: aucune voix detectee.");
        return;
      }
      setCaptionError(`SpeechRecognition: ${reason}`);
      console.warn("SpeechRecognition error", event);
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(reason)) {
        stopOnErrorRef.current = true;
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        try {
          recognition.stop();
        } catch {}
        onDisableCaptions();
      }
    };

    recognition.onend = () => {
      if (cancelled) return;
      if (!captionsEnabled) return;
      if (stopOnErrorRef.current) return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        try {
          recognition.start();
        } catch (err) {
          console.warn("SpeechRecognition restart failed", err);
        }
      }, 1200);
    };

    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => {
      if (cancelled) return;
      try {
        recognition.start();
      } catch (err) {
        console.warn("SpeechRecognition start failed", err);
      }
    }, 200);
    return () => {
      cancelled = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognition.stop();
      recognitionRef.current = null;
      translationAbortRef.current?.abort();
      translationAbortRef.current = null;
    };
  }, [
    captionsEnabled,
    captionsSupported,
    hostLocalTtsEnabled,
    isHost,
    localParticipant?.identity,
    onDisableCaptions,
    enqueueTts,
    realtimeEnabled,
    roomId,
    sendCaption,
    captionTarget,
    captionTargetName,
    sourceLanguage,
    sourceLanguageName,
    sourceLanguageLocale,
    sourceLanguageOption,
    speakGuestCaption,
    translateWithOpenAi,
  ]);

  const retryMicrophone = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "Erreur micro inconnue.");
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
  }, [isCameraEnabled, localParticipant]);

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
    if (!focusTrack) return;
    const cameraTracks = tracks
      .filter(isTrackReference)
      .filter((track) => track.publication.source === Track.Source.Camera);
    if (cameraTracks.length >= 3) {
      manualPinRef.current = false;
      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
    }
  }, [focusTrack, layoutContext.pin, tracks]);

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

  const guestInviteLink =
    typeof window !== "undefined" ? `${window.location.origin}/videoconference?room=${roomId}` : "";

  const copyInvite = async () => {
    if (!guestInviteLink) return;
    try {
      await navigator.clipboard.writeText(guestInviteLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {
      setInviteCopied(false);
    }
  };

  return (
    <div
      className="lk-video-conference"
      data-auto-frame={autoFrame ? "true" : "false"}
      data-video-fit={videoFit}
    >
      <LayoutContextProvider value={layoutContext} onWidgetChange={onWidgetChange}>
        <div
          className="lk-video-conference-inner"
          onClick={() => setControlsHidden((value) => !value)}
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
            aiBackgroundUrl={aiBackgroundUrl}
            onAiImageGenerated={onAiImageGenerated}
            onClearAiBackground={onClearAiBackground}
            onSaveAiBackground={onSaveAiBackground}
          />
          <TimerOverlay timerState={timerState} />
          {captionStreamState.active && (
            <CaptionStreamOverlay
              text={captionStreamState.text}
              onClose={() => setCaptionStreamState({ active: false, text: "", error: "" })}
            />
          )}
          <ActionControls
            visible={actionControlsState.visible}
            onAction={sendActionItem}
            onClose={() =>
              setActionControlsState((state) => ({ ...state, visible: false }))
            }
          />
          {captionText && (
            <div className="absolute inset-x-0 bottom-[calc(var(--lk-control-bar-height)+16px)] z-20 flex justify-center px-4">
              <div
                className={`max-w-3xl rounded-full bg-black/70 px-4 py-2 text-center text-white backdrop-blur ${
                  captionSize === "lg"
                    ? "text-[16px]"
                    : captionSize === "md"
                    ? "text-[14px]"
                    : "text-[12px]"
                }`}
              >
                {captionText}
              </div>
            </div>
          )}
          <button
            onClick={() => setControlsHidden((value) => !value)}
            className="absolute left-4 bottom-[calc(var(--lk-control-bar-height)+12px)] z-20 rounded-full bg-black/70 px-3 py-2 text-[11px] text-white shadow-md"
            aria-label="Afficher ou masquer les controles"
            onClickCapture={(event) => event.stopPropagation()}
          >
            {controlsHidden ? "Afficher" : "Masquer"}
          </button>
          {isIPhone ? (
            <div className="lk-focus-layout-wrapper">
              <div className="bf-iphone-layout" onClick={(event) => event.stopPropagation()}>
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
                    onClick={() => {
                      if (screenShareTracks.length > 0) return;
                      manualPinRef.current = false;
                      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
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
                          {`Partage d’écran en cours${
                            screenShareTracks[0]?.publication?.trackName
                              ? ` • ${screenShareTracks[0].publication.trackName}`
                              : ""
                          }`}
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}
              </FocusLayoutContainer>
              {screenShareTracks.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-4">
                  <div className="pointer-events-auto rounded-full bg-slate-900/80 px-3 py-2 text-[11px] text-white">
                    {`Partage d’écran en cours${
                      screenShareTracks[0]?.publication?.trackName
                        ? ` • ${screenShareTracks[0].publication.trackName}`
                        : ""
                    }`}
                    <button
                      onClick={() => setGalleryVisible((value) => !value)}
                      className="ml-3 rounded-full border border-slate-500/60 bg-slate-900/60 px-2 py-1 text-[10px] text-slate-200"
                      type="button"
                    >
                      {galleryVisible ? "Masquer galerie" : "Afficher galerie"}
                    </button>
                  </div>
                </div>
              )}
              {screenShareTracks.length > 0 && isScreenSharing && (
                <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-6">
                  <button
                    onClick={() => {
                      if (confirm("Arrêter le partage d’écran ?")) {
                        handleToggleScreenShare();
                      }
                    }}
                    className="pointer-events-auto rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
                  >
                    Arrêter le partage
                  </button>
                </div>
              )}
            </div>
          )}
          <div
            className={controlsHidden ? "hidden" : "relative z-20"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="lk-control-bar flex items-center justify-between gap-2 !border-0 !bg-transparent !p-2 sm:!p-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setInviteOpen(true)}
                  className="lk-button"
                  aria-label="Partager le lien"
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Partager</span>
                </button>
                {inviteCopied && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                    Copie
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
                    <Mic className="h-4 w-4" />
                  ) : (
                    <MicOff className="h-4 w-4 text-red-300" />
                  )}
                  <span className="hidden sm:inline">Micro</span>
                </TrackToggle>
                <TrackToggle source={Track.Source.Camera} showIcon={false}>
                  {isCameraEnabled ? (
                    <Camera className="h-4 w-4" />
                  ) : (
                    <CameraOff className="h-4 w-4 text-red-300" />
                  )}
                  <span className="hidden sm:inline">Camera</span>
                </TrackToggle>
                {isMobile && (
                  <button
                    onClick={flipCamera}
                    className="lk-button"
                    disabled={!isCameraEnabled || isFlippingCamera}
                    aria-label="Retourner la camera"
                  >
                    <SwitchCamera className="h-4 w-4" />
                    <span className="hidden sm:inline">Retourner</span>
                  </button>
                )}
                <button
                  onClick={handleToggleScreenShare}
                  className={`lk-button ${isScreenSharing ? "bg-sky-600" : ""}`}
                >
                  <ScreenShare className="h-4 w-4" />
                  <span className="hidden sm:inline">Ecran</span>
                </button>
                <ChatToggle>
                  <MessageCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">Chat</span>
                </ChatToggle>
                <button onClick={onOpenSettings} className="lk-button">
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Reglages</span>
                </button>
                {captionsEnabled && isHost && (
                  <span className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold text-emerald-100">
                    {`${sourceLanguageName}→${captionTargetLabel} live`}
                  </span>
                )}
              </div>
              <DisconnectButton className="lk-disconnect-button !bg-rose-600/90 !text-white hover:!bg-rose-600">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Quitter</span>
              </DisconnectButton>
            </div>
            {mediaError && (
              <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                <div className="flex items-center justify-between gap-2">
                  <span>Micro/camera: {mediaError}</span>
                  <button
                    onClick={retryMicrophone}
                    className="rounded-md border border-rose-400/60 px-2 py-1 text-[11px] text-rose-100"
                  >
                    Debloquer micro
                  </button>
                </div>
              </div>
            )}
            {screenShareError && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Ecran: {screenShareError}
              </div>
            )}
            {captionError && isHost && captionsEnabled && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
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
          onUnreadChange={(count) => roomChat.setUnreadCount(count)}
        />
        {isHost && (
          <SuggestionsDrawer
            isOpen={suggestionsOpen}
            onClose={onToggleSuggestions}
            listening={listening}
            onToggleListening={() => setListening((value) => !value)}
            lastHeard={lastHeard}
            suggestions={suggestions}
            suggesting={suggesting}
            suggestError={suggestError}
            useGuidelines={useGuidelines}
            onToggleGuidelines={() => setUseGuidelines((value) => !value)}
            mode={suggestionMode}
            onChangeMode={setSuggestionMode}
            onSendToChat={roomChat.sendMessage}
          />
        )}
        <InviteDrawer
          isOpen={inviteOpen}
          onClose={() => setInviteOpen(false)}
          inviteLink={guestInviteLink}
          onCopy={copyInvite}
          copied={inviteCopied}
        />
      </LayoutContextProvider>
      <ConnectionStateToast />
    </div>
  );
}

function LiveKitConferenceMobile({
  roomId,
  isHost,
  guestTtsEnabled,
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
  autoFrame,
  captionSize,
  videoFit,
  sourceLanguage,
  onChangeSourceLanguage,
  guestCaptionTarget,
  onChangeGuestCaptionTarget,
  aiBackgroundUrl,
  onAiImageGenerated,
  onClearAiBackground,
  aiGallery,
  onAiGallerySelect,
  onSaveAiBackground,
  isSettingsOpen,
}: {
  roomId: string;
  isHost: boolean;
  guestTtsEnabled: boolean;
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
  autoFrame: boolean;
  captionSize: "sm" | "md" | "lg";
  videoFit: "cover" | "contain";
  sourceLanguage: SourceLanguageOption["code"];
  onChangeSourceLanguage: (value: SourceLanguageOption["code"]) => void;
  guestCaptionTarget: CaptionTarget;
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  aiBackgroundUrl: string | null;
  onAiImageGenerated: (url: string) => void;
  onClearAiBackground: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
  onSaveAiBackground: (prompt: string, image: string) => void;
  isSettingsOpen: boolean;
}) {
  const [controlsHidden, setControlsHidden] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const isIPhone = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    if (!isHost || !roomId || typeof window === "undefined") return;
    const key = `bfzoom:invite-opened:${roomId}:mobile`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setInviteOpen(true);
  }, [isHost, roomId]);
  const [showMobileBadge, setShowMobileBadge] = useState(true);
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, lastMicrophoneError, lastCameraError } =
    useLocalParticipant();
  const captionTargetName = useMemo(
    () => CAPTION_TARGETS_CONFIG.find((item) => item.code === captionTarget)?.name || "English",
    [captionTarget]
  );

  useEffect(() => {
    if (!isHost || shareMicToGuests) return;
    if (!localParticipant) return;
    void localParticipant.setMicrophoneEnabled(false);
  }, [isHost, localParticipant, shareMicToGuests]);
  const [mediaError, setMediaError] = useState<string>("");
  const [captionText, setCaptionText] = useState("");
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { message: captionIncoming } = useDataChannel("bfzoom-captions");
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
  const speakGuestCaption = useGuestCaptionPlayer(realtimeVoice);
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
    const decoder = new TextDecoder();
    try {
      const text = decoder.decode(captionIncoming.payload);
      const payload = JSON.parse(text) as { text?: string; roomId?: string; target?: CaptionTarget };
      if (!payload.text) return;
      if (payload.roomId && payload.roomId !== roomId) return;
      setCaptionText(payload.text);
      if (!isHost && guestTtsEnabled) {
        void speakGuestCaption(payload.text, payload.target);
      }
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      captionTimerRef.current = setTimeout(() => setCaptionText(""), 15000);
    } catch (err) {
      console.warn("Caption payload invalide", err);
    }
  }, [captionIncoming, guestTtsEnabled, isHost, roomId, speakGuestCaption]);

  useEffect(() => {
    return () => {
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
    };
  }, []);

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

  const guestInviteLink =
    typeof window !== "undefined" ? `${window.location.origin}/videoconference?room=${roomId}` : "";

  const copyInvite = async () => {
    if (!guestInviteLink) return;
    try {
      await navigator.clipboard.writeText(guestInviteLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {
      setInviteCopied(false);
    }
  };

  return (
    <div
      className="lk-video-conference"
      data-auto-frame={autoFrame ? "true" : "false"}
      data-video-fit={videoFit}
    >
      <div
        className="lk-video-conference-inner"
        onClick={() => setControlsHidden((value) => !value)}
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
            aiBackgroundUrl={aiBackgroundUrl}
            onAiImageGenerated={onAiImageGenerated}
            onClearAiBackground={onClearAiBackground}
            onSaveAiBackground={onSaveAiBackground}
          />
        <TimerOverlay timerState={timerState} />
        {showMobileBadge && (
          <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-sky-400/60 bg-sky-500/20 px-3 py-1 text-[11px] text-sky-100">
            Mobile layout ON
          </div>
        )}
        {captionText && (
          <div className="absolute inset-x-0 bottom-[calc(var(--lk-control-bar-height)+16px)] z-20 flex justify-center px-4">
            <div
              className={`max-w-3xl rounded-full bg-black/70 px-4 py-2 text-center text-white backdrop-blur ${
                captionSize === "lg"
                  ? "text-[16px]"
                  : captionSize === "md"
                  ? "text-[14px]"
                  : "text-[12px]"
              }`}
            >
              {captionText}
            </div>
          </div>
        )}
        <div className="lk-focus-layout-wrapper">
          {mobileView === "mosaic" ? (
            <div className="bf-iphone-mosaic" onClick={(event) => event.stopPropagation()}>
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
            </div>
          ) : (
            <div className="bf-iphone-layout" onClick={(event) => event.stopPropagation()}>
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
            </div>
          )}
        </div>
        <div
          className={controlsHidden ? "hidden" : "relative z-20"}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="lk-control-bar flex items-center justify-between gap-2 !border-0 !bg-transparent !p-2 sm:!p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setInviteOpen(true)}
                className="lk-button"
                aria-label="Partager le lien"
              >
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">Partager</span>
              </button>
              {inviteCopied && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                  Copie
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
                  <Mic className="h-4 w-4" />
                ) : (
                  <MicOff className="h-4 w-4 text-red-300" />
                )}
                <span className="hidden sm:inline">Micro</span>
              </TrackToggle>
              <TrackToggle source={Track.Source.Camera} showIcon={false}>
                {isCameraEnabled ? (
                  <Camera className="h-4 w-4" />
                ) : (
                  <CameraOff className="h-4 w-4 text-red-300" />
                )}
                <span className="hidden sm:inline">Camera</span>
              </TrackToggle>
              <button
                onClick={handleToggleScreenShare}
                className={`lk-button ${isScreenSharing ? "bg-sky-600" : ""}`}
              >
                <ScreenShare className="h-4 w-4" />
                <span className="hidden sm:inline">Ecran</span>
              </button>
              <button
                onClick={() =>
                  onWidgetChange({ ...widgetState, showChat: !widgetState.showChat })
                }
                className="lk-button"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Chat</span>
              </button>
              <button onClick={onOpenSettings} className="lk-button">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Reglages</span>
              </button>
            </div>
            <DisconnectButton className="lk-disconnect-button !bg-rose-600/90 !text-white hover:!bg-rose-600">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Quitter</span>
            </DisconnectButton>
          </div>
          {mediaError && (
            <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              <div className="flex items-center justify-between gap-2">
                <span>Micro/camera: {mediaError}</span>
              </div>
            </div>
          )}
          {screenShareError && (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              Ecran: {screenShareError}
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
        onUnreadChange={(count) => roomChat.setUnreadCount(count)}
      />
      <InviteDrawer
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        inviteLink={guestInviteLink}
        onCopy={copyInvite}
        copied={inviteCopied}
      />
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
}) {
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

  const languageOptions = [
    "Arabe",
    "Anglais",
    "Chinois",
    "Espagnol",
    "Persan (Farsi)",
    "Hebreu",
    "Italien",
    "Russe",
    "Français",
  ];

  const localId = localParticipant?.identity || "";
  const localName = localParticipant?.name || "Moi";

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
        className={`absolute bottom-0 left-0 right-0 sm:top-0 sm:left-auto sm:right-0 sm:h-full sm:w-96 bg-slate-950 text-slate-100 shadow-2xl border-t border-slate-800 sm:border-l sm:border-t-0 transition-transform ${
          isOpen
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Chat</p>
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
            Fermer
          </button>
        </div>

        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-slate-400">
            Messages visibles par tous les participants.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            <span>J’écris en</span>
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

        <div className="flex-1 overflow-y-auto px-4 pb-24">
          {visibleMessages.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun message dans la salle.</p>
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950 p-3">
          {preview && (
            <div className="mb-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-200">
              <span className="text-slate-400">Traduction envoyée:</span> {preview}
            </div>
          )}
          {previewError && (
            <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {previewError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ecris un message..."
              className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
            />
            <button
              onClick={handlePreview}
              disabled={previewLoading || !draft.trim()}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-50"
            >
              {previewLoading ? "..." : "Aperçu"}
            </button>
            <button
              onClick={handleSend}
              disabled={isSending || !draft.trim()}
              className="rounded-lg bg-sky-500 px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestionsDrawer({
  isOpen,
  onClose,
  listening,
  onToggleListening,
  lastHeard,
  suggestions,
  suggesting,
  suggestError,
  useGuidelines,
  onToggleGuidelines,
  mode,
  onChangeMode,
  onSendToChat,
}: {
  isOpen: boolean;
  onClose: () => void;
  listening: boolean;
  onToggleListening: () => void;
  lastHeard: string;
  suggestions: SuggestedResponse[];
  suggesting: boolean;
  suggestError: string;
  useGuidelines: boolean;
  onToggleGuidelines: () => void;
  mode: SuggestionMode;
  onChangeMode: (mode: SuggestionMode) => void;
  onSendToChat: (text: string, opts?: { fromName?: string }) => Promise<void>;
}) {
  const [sendingId, setSendingId] = useState<string | null>(null);
  const activeMode = SUGGESTION_MODES.find((item) => item.id === mode);

  const handleSend = async (text: string, id: string) => {
    if (!text.trim()) return;
    setSendingId(id);
    await onSendToChat(text.trim(), { fromName: "Coach IA" });
    setSendingId(null);
  };

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
        className={`absolute bottom-0 left-0 right-0 sm:top-0 sm:left-auto sm:right-0 sm:h-full sm:w-96 bg-slate-950 text-slate-100 shadow-2xl border-t border-slate-800 sm:border-l sm:border-t-0 transition-transform ${
          isOpen
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Conseils</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                listening
                  ? "bg-emerald-500/20 text-emerald-100"
                  : "bg-slate-700/60 text-slate-200"
              }`}
            >
              {listening ? "Ecoute" : "Pause"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Fermer
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-slate-400">
            L'IA ecoute l'interlocuteur et propose des reponses en direct.
          </p>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wide text-slate-500">
              Mode
            </label>
            <select
              value={mode}
              onChange={(event) => onChangeMode(event.target.value as SuggestionMode)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
            >
              {SUGGESTION_MODES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {activeMode && (
              <p className="text-[11px] text-slate-400">{activeMode.hint}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onToggleListening}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                listening
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-800 text-slate-100"
              }`}
            >
              {listening ? "Arreter l'ecoute" : "Ecouter l'autre"}
            </button>
            {mode === "rp" && (
              <button
                onClick={onToggleGuidelines}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  useGuidelines
                    ? "bg-sky-500 text-white"
                    : "bg-slate-800 text-slate-100"
                }`}
              >
                Guidelines {useGuidelines ? "ON" : "OFF"}
              </button>
            )}
          </div>
          {suggestError && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {suggestError}
            </div>
          )}
          {suggesting && (
            <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-300">
              Analyse en cours...
            </div>
          )}
          {lastHeard && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-200">
              <span className="text-[10px] uppercase text-slate-500">Dernier extrait</span>
              <p className="mt-1">{lastHeard}</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {suggestions.length === 0 ? (
            <p className="text-xs text-slate-500">
              Aucune suggestion pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {suggestions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-3"
                >
                  <p className="text-xs text-slate-100">{item.text}</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>
                      {new Date(item.createdAt).toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <button
                      onClick={() => handleSend(item.text, item.id)}
                      disabled={sendingId === item.id}
                      className="rounded-full bg-sky-500 px-3 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                    >
                      {sendingId === item.id ? "Envoi..." : "Envoyer au chat"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteDrawer({
  isOpen,
  onClose,
  inviteLink,
  onCopy,
  copied,
}: {
  isOpen: boolean;
  onClose: () => void;
  inviteLink: string;
  onCopy: () => void;
  copied: boolean;
}) {
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
          <p className="text-sm font-semibold">Partager la salle</p>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Fermer
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            Envoie ce lien invite (sans droits hote) pour rejoindre la salle.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={inviteLink}
              readOnly
              onFocus={(event) => event.target.select()}
              className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
            />
            <button
              onClick={onCopy}
              className="rounded-md bg-sky-500 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-400"
            >
              {copied ? "Copie ✅" : "Copier lien invite"}
            </button>
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
  backgroundMode,
  onChangeBackground,
  backgroundDisabled,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
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
  onChangeGuestCaptionTarget,
  guestTtsEnabled,
  guestTtsDisabled,
  onToggleGuestTts,
  ttsError,
  captionSize,
  onChangeCaptionSize,
  videoFit,
  onChangeVideoFit,
  onSendToChat,
  timerState,
  timerActions,
  aiBackgroundUrl,
  onAiBackgroundClear,
  aiGallery,
  onAiGallerySelect,
}: {
  roomId: string;
  isHost: boolean;
  isOpen: boolean;
  onClose: () => void;
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  backgroundDisabled: boolean;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
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
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  guestTtsEnabled: boolean;
  guestTtsDisabled: boolean;
  onToggleGuestTts: () => void;
  ttsError: string;
  captionSize: "sm" | "md" | "lg";
  onChangeCaptionSize: (size: "sm" | "md" | "lg") => void;
  videoFit: "cover" | "contain";
  onChangeVideoFit: (fit: "cover" | "contain") => void;
  onSendToChat: (text: string, opts?: { fromName?: string }) => Promise<void>;
  timerState: RoomTimerState;
  timerActions: RoomTimerActions;
  aiBackgroundUrl: string | null;
  onAiBackgroundClear: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
}) {
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
  const [isMobile, setIsMobile] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(true);
  const [hostOpen, setHostOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<
    "background" | "camera" | "timer" | "coach" | "host"
  >("background");

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
    { id: "background", label: "Fond" },
    { id: "camera", label: "Camera" },
    { id: "timer", label: "Timer" },
    { id: "coach", label: "Coach" },
    { id: "host", label: "Hote" },
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
            <p className="text-sm font-semibold">Reglages</p>
            <p className="text-[10px] text-slate-400">BFZoom v{appVersion}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Fermer
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
              {mobileSection === "background" && (
                <BackgroundSection
                  backgroundMode={backgroundMode}
                  onChangeBackground={onChangeBackground}
                  disabled={backgroundDisabled}
                  customBackgrounds={customBackgrounds}
                  onAddCustomBackground={onAddCustomBackground}
                  onRemoveCustomBackground={onRemoveCustomBackground}
                  aiBackgroundUrl={aiBackgroundUrl}
                  onAiBackgroundClear={onAiBackgroundClear}
                  aiGallery={aiGallery}
                  onAiGallerySelect={onAiGallerySelect}
                />
              )}
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
                  guestCaptionTarget={guestCaptionTarget}
                  onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
                  guestTtsEnabled={guestTtsEnabled}
                  guestTtsDisabled={guestTtsDisabled}
                  onToggleGuestTts={onToggleGuestTts}
                  ttsError={ttsError}
                  captionSize={captionSize}
                  onChangeCaptionSize={onChangeCaptionSize}
                  videoFit={videoFit}
                  onChangeVideoFit={onChangeVideoFit}
                />
              )}
              {mobileSection === "timer" && (
                <TimerPanel timerState={timerState} timerActions={timerActions} />
              )}
              {mobileSection === "coach" && (
                <CoachPanel roomId={roomId} onSendToChat={onSendToChat} />
              )}
              {mobileSection === "host" && <LiveKitHostSection roomId={roomId} />}
            </>
          ) : (
            <>
              <SectionHeader
                title="Arriere-plan"
                isOpen={backgroundOpen}
                onToggle={() => setBackgroundOpen((value) => !value)}
              />
              {backgroundOpen && (
              <BackgroundSection
                backgroundMode={backgroundMode}
                onChangeBackground={onChangeBackground}
                disabled={backgroundDisabled}
                customBackgrounds={customBackgrounds}
                onAddCustomBackground={onAddCustomBackground}
                onRemoveCustomBackground={onRemoveCustomBackground}
                aiBackgroundUrl={aiBackgroundUrl}
                onAiBackgroundClear={onAiBackgroundClear}
                aiGallery={aiGallery}
                onAiGallerySelect={onAiGallerySelect}
              />
              )}
              <SectionHeader
                title="Camera"
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
                  guestCaptionTarget={guestCaptionTarget}
                  onChangeGuestCaptionTarget={onChangeGuestCaptionTarget}
                  guestTtsEnabled={guestTtsEnabled}
                  guestTtsDisabled={guestTtsDisabled}
                  onToggleGuestTts={onToggleGuestTts}
                  ttsError={ttsError}
                  captionSize={captionSize}
                  onChangeCaptionSize={onChangeCaptionSize}
                  videoFit={videoFit}
                  onChangeVideoFit={onChangeVideoFit}
                />
              )}

              {!isHost && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
                  <p className="font-semibold text-slate-100">Options hote</p>
                  <p className="mt-1 text-slate-300">
                    Timer, coach et gestion hote sont reserves a l'hote.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-400">
                    Ouvre le lien de salle en mode hote pour les afficher.
                  </p>
                </div>
              )}

              {isHost && (
                <>
                  <SectionHeader
                    title="Timer"
                    isOpen={timerOpen}
                    onToggle={() => setTimerOpen((value) => !value)}
                  />
                  {timerOpen && (
                    <TimerPanel timerState={timerState} timerActions={timerActions} />
                  )}
                  <SectionHeader
                    title="Coach IA"
                    isOpen={coachOpen}
                    onToggle={() => setCoachOpen((value) => !value)}
                  />
                  {coachOpen && (
                    <CoachPanel roomId={roomId} onSendToChat={onSendToChat} />
                  )}
                  <SectionHeader
                    title="Gestion hote"
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
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</p>
      <button
        onClick={onToggle}
        className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
      >
        {isOpen ? "Replier" : "Ouvrir"}
      </button>
    </div>
  );
}

function BackgroundSection({
  backgroundMode,
  onChangeBackground,
  disabled,
  customBackgrounds,
  onAddCustomBackground,
  onRemoveCustomBackground,
  aiBackgroundUrl,
  onAiBackgroundClear,
  aiGallery,
  onAiGallerySelect,
}: {
  backgroundMode: string;
  onChangeBackground: (mode: string) => void;
  disabled: boolean;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: (id: string) => void;
  aiBackgroundUrl: string | null;
  onAiBackgroundClear: () => void;
  aiGallery: AiGalleryItem[];
  onAiGallerySelect: (item: AiGalleryItem) => void;
}) {
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
      {disabled && (
        <p className="text-[11px] text-amber-200">
          Effets indisponibles sur iPhone Safari. Utilise un ordinateur pour les activer.
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
                    <Image
                      src={opt.imagePath}
                      alt=""
                      className="h-6 w-10 rounded-md object-cover"
                      width={160}
                      height={96}
                      unoptimized
                    />
                    {opt.label}
                  </span>
                ) : (
              opt.label
            )}
            </button>
          ))}
        </div>
        {aiBackgroundUrl && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div
              className="h-12 w-12 rounded-lg bg-cover bg-center"
              style={{ backgroundImage: `url(${aiBackgroundUrl})` }}
            />
            <div className="flex-1 text-[11px] text-slate-200">
              Fond IA actif · génère un nouveau prompt pour le remplacer.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChangeBackground("ai")}
                disabled={disabled}
                className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-white disabled:border-slate-600 disabled:text-slate-500 hover:border-slate-500"
              >
                Activer
              </button>
              <button
                type="button"
                onClick={onAiBackgroundClear}
                disabled={disabled}
                className="rounded-full border border-rose-500 px-3 py-1 text-[11px] text-rose-300 disabled:border-rose-400 disabled:text-rose-500 hover:border-rose-400"
              >
                Supprimer
              </button>
            </div>
          </div>
        )}
        {aiGallery.length > 0 && (
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Galerie IA</p>
            <div className="grid grid-cols-2 gap-2">
              {aiGallery.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onAiGallerySelect(item)}
                  disabled={disabled}
                  className="group flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-2 text-left transition hover:border-sky-400"
                >
                  <div
                    className="h-16 w-full rounded-md bg-cover bg-center"
                    style={{ backgroundImage: `url(${item.image})` }}
                  />
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
          <span className="text-xs">Importer une image</span>
        </label>
      </div>
      {customBackgrounds.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Fonds importés
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
                  Supprimer
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
  guestCaptionTarget,
  onChangeGuestCaptionTarget,
  guestTtsEnabled,
  guestTtsDisabled,
  onToggleGuestTts,
  ttsError,
  captionSize,
  onChangeCaptionSize,
  videoFit,
  onChangeVideoFit,
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
  guestCaptionTarget: CaptionTarget;
  onChangeGuestCaptionTarget: (target: CaptionTarget) => void;
  guestTtsEnabled: boolean;
  guestTtsDisabled: boolean;
  onToggleGuestTts: () => void;
  ttsError: string;
  captionSize: "sm" | "md" | "lg";
  onChangeCaptionSize: (size: "sm" | "md" | "lg") => void;
  videoFit: "cover" | "contain";
  onChangeVideoFit: (fit: "cover" | "contain") => void;
}) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const guestCaptionTargetValue = guestCaptionTarget;
  const onChangeGuestCaptionTargetValue = onChangeGuestCaptionTarget;
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
  const hostLocalActive = Boolean(hostLocalTtsEnabled);
  const translationStatusMessage = realtimeEnabled
    ? `Realtime actif (${sourceLanguageName} → ${activeLanguageName}). La synthèse OpenAI en ${activeLanguageName} remplace ta voix pour les invités.`
    : shareMicToGuests
    ? `Les invités entendent ta voix (${sourceLanguageName}) pendant que les sous-titres et la synthèse restent en ${activeLanguageName}.`
    : `Mode traduction exclusive (${sourceLanguageName} → ${activeLanguageName}) activé : seuls les sous-titres et la synthèse OpenAI sont diffusés en ${activeLanguageName}.`;
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
  }, [recommendationLocked]);

  useEffect(() => {
    if (!showRecommendationToast) return;
    const timer = setTimeout(() => setShowRecommendationToast(false), 2000);
    return () => clearTimeout(timer);
  }, [showRecommendationToast]);

  const markManualMode = useCallback(() => {
    setRecommendationLocked(true);
  }, []);

  const applyRecommendedMode = useCallback(() => {
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
          <span className="font-semibold text-[12px] uppercase tracking-wide text-slate-400">Caméra & sous-titres</span>
          <span
            title="Réglages de la caméra et des sous-titres."
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
          >
            <Info className="h-3 w-3" />
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          Ajuste le cadrage et contrôle la transcription automatique.
        </p>
        <div className="grid gap-2">
          <button
            onClick={onToggleAutoFrame}
            className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200"
          >
            <span className="flex items-center gap-2">
              Auto-cadrage
              <span
                title="Garde ton visage centre automatiquement."
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
              >
                <Info className="h-3 w-3" />
              </span>
            </span>
            <span className={autoFrame ? "text-sky-200" : "text-slate-400"}>
              {autoFrame ? "Actif" : "Inactif"}
            </span>
          </button>
          {isHost ? (
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
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
              Les sous-titres sont controles par l'hote.
            </div>
          )}
        </div>
      </section>
      {isHost && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3 text-xs text-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Traduction & voix</span>
              <div className="flex items-center gap-2">
                {recommendedMode !== "unknown" && (
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
                  title="Choisis la langue et le mode audio. Realtime = streaming, Traduction vocale = texte puis voix."
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300"
                >
                  <Info className="h-3 w-3" />
                </span>
              </div>
            </div>
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
            <div className="grid gap-3">
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">
                    Langue source (ex : Français, Persan, Arabe…)
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
                  Choisis ta langue parlée (Français, Persan, Arabe, etc.) : toutes les options du sélecteur sont reconnues par OpenAI et l’accent est détecté automatiquement.
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
          </section>

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
          {showRecommendationToast && (
            <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
              Mode recommande applique.
            </div>
          )}
        </div>
      )}
      {isHost && null}
      {!isHost && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            <span className="text-[11px] text-slate-400">Langue de réception</span>
            <select
              value={guestCaptionTargetValue}
              onChange={(event) => onChangeGuestCaptionTargetValue(event.target.value as CaptionTarget)}
              disabled={guestTtsDisabled}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
            >
              {CAPTION_TARGETS_CONFIG.map((target) => (
                <option key={target.code} value={target.code}>
                  {target.name}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500">
              Choisis ta langue.
            </span>
          </div>
          <button
            onClick={onToggleGuestTts}
            disabled={guestTtsDisabled}
            title="Joue la traduction locale sur ton poste uniquement."
            className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200"
          >
            <span>Lecture vocale locale</span>
            <span className={guestTtsEnabled ? "text-sky-200" : "text-slate-400"}>
              {guestTtsEnabled ? "Actif" : guestTtsDisabled ? "Indispo" : "Inactif"}
            </span>
          </button>
        </div>
      )}
      {isHost && ttsError && (
        <p className="text-[11px] text-amber-200">{ttsError}</p>
      )}
      {isHost && realtimeError && (
        <p className="text-[11px] text-amber-200">{realtimeError}</p>
      )}
      {isHost && realtimeAvailable && (
        <p className={`text-[11px] ${realtimeStatusTone[realtimeStatus]}`}>
          Realtime WS: {realtimeStatusLabel[realtimeStatus]}
        </p>
      )}
      {isHost && (
        <div className="flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              Taille sous-titres
              <span
                title="Ajuste la taille du texte affiche."
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
            Cadrage video
            <span
              title="Remplir coupe l'image, Entier affiche toute l'image."
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
                {fit === "cover" ? "Remplir" : "Entier"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={handleFlip}
        disabled={!isCameraEnabled || isFlipping}
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
      >
        <SwitchCamera className="h-4 w-4" />
        Retourner la camera
      </button>
      {error && <p className="text-[11px] text-rose-200">{error}</p>}
    </div>
  );
}

type CoachItem = {
  id: string;
  title: string;
  prompt: string;
  local?: string;
};

type CoachMode = {
  id: string;
  title: string;
  description?: string;
  items: CoachItem[];
};

type CoachLibrary = {
  modes: CoachMode[];
};

function CoachPanel({
  roomId,
  onSendToChat,
}: {
  roomId: string;
  onSendToChat: (text: string, opts?: { fromName?: string }) => Promise<void>;
}) {
  const positioningGuide = useMemo(() => {
    const company = rumeurPositioning.company;
    const expertise = rumeurPositioning.expertise.join(", ");
    const values = company.positioning.value.join("; ");
    const crisis = rumeurPositioning.corporate_comms.crisis_method;
    return [
      `Marque: ${company.name}.`,
      `Tagline: ${company.tagline}.`,
      `Positionnement: ${company.positioning.core}.`,
      `Valeurs: ${values}.`,
      `Expertises: ${expertise}.`,
      `Crise (avant): ${crisis.before.join("; ")}.`,
      `Crise (pendant): ${crisis.during.join("; ")}.`,
    ].join(" ");
  }, []);
  const allModes = [
    boxingLibrary,
    mentalLibrary,
    generalLibrary,
    businessLibrary,
    meditationLibrary,
  ] as CoachLibrary["modes"];
  const enabled = new Set((coachIndex as { enabled?: string[] }).enabled || []);
  const library = allModes.filter((mode) => enabled.has(mode.id));
  const [modeId, setModeId] = useState(library[0]?.id || "");
  const [prompt, setPrompt] = useState("");
  const [localText, setLocalText] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [useAI, setUseAI] = useState(false);
  const [useGuidelines, setUseGuidelines] = useState(true);

  const currentMode = library.find((mode) => mode.id === modeId) || library[0];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    try {
      if (!useAI) {
        const fallback = localText.trim() || prompt.trim();
        setResponse(fallback || "Aucune reponse locale.");
        return;
      }
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "Tu es un coach en communication d'influence. Reponds en 6-8 lignes max, clair, court et actionnable. " +
                (useGuidelines ? positioningGuide : ""),
            },
            {
              role: "user",
              content: `Mode: ${currentMode?.title || "Coach"}\nSalle: ${roomId}\n${prompt}\nReponse courte.`,
            },
          ],
        }),
      });
      const raw = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(raw);
      } catch {
        if (!res.ok) throw new Error(raw || "Erreur OpenAI");
      }
      if (!res.ok) {
        const errMessage =
          (data as { error?: string })?.error || "Erreur OpenAI";
        throw new Error(errMessage);
      }
      const choice = (data as { choices?: { message?: { content?: string }; finish_reason?: string }[] })
        ?.choices?.[0];
      const answer = choice?.message?.content || "Pas de reponse pour le moment.";
      const trimmed =
        choice?.finish_reason === "length"
          ? `${answer}\n\n[Reponse tronquee]`
          : answer;
      setResponse(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendToChat = async () => {
    if (!response.trim()) return;
    await onSendToChat(response.trim(), { fromName: "Coach IA" });
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-3">
      <div>
        <label className="text-[11px] text-slate-400">Mode</label>
        <select
          value={modeId}
          onChange={(event) => setModeId(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-xs text-slate-200"
        >
          {library.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.title}
            </option>
          ))}
        </select>
        {currentMode?.description && (
          <p className="mt-2 text-[11px] text-slate-500">
            {currentMode.description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {currentMode?.items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setPrompt(item.prompt);
              setLocalText(item.local || item.prompt);
            }}
            className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-200">Mode de reponse</p>
            <p className="text-[11px] text-slate-500">
              {useAI ? "IA (personnalise)" : "Local (rapide)"}
            </p>
          </div>
          <button
            onClick={() => setUseAI((value) => !value)}
            className={`rounded-full px-3 py-1 text-[11px] ${
              useAI ? "bg-sky-500 text-white" : "border border-slate-700 text-slate-200"
            }`}
          >
            {useAI ? "IA" : "Local"}
          </button>
        </div>
        {useAI && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
            <div>
              <p className="text-[11px] text-slate-300">Guidelines entreprise</p>
              <p className="text-[11px] text-slate-500">
                {useGuidelines ? "Positionnement applique" : "Positionnement ignore"}
              </p>
            </div>
            <button
              onClick={() => setUseGuidelines((value) => !value)}
              className={`rounded-full px-3 py-1 text-[11px] ${
                useGuidelines
                  ? "bg-emerald-500 text-white"
                  : "border border-slate-700 text-slate-200"
              }`}
            >
              {useGuidelines ? "ON" : "OFF"}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <textarea
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (!useAI) {
              setLocalText(event.target.value);
            }
          }}
          placeholder="Ecris ou selectionne un prompt..."
          rows={4}
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="w-full rounded-lg bg-sky-500 px-3 py-2 text-xs text-white disabled:opacity-50"
        >
          {loading ? "Generation..." : "Generer"}
        </button>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {response && (
        <div className="space-y-2">
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 whitespace-pre-line">
            {response}
          </div>
          <button
            onClick={handleSendToChat}
            className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            Envoyer au chat
          </button>
        </div>
      )}
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
