"use client";

import {
  ForwardedRef,
  PointerEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Mic, Send } from "lucide-react";

type SpeechRecognitionAlternativeLike = { transcript?: string };
type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const VIDEO_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

const getSupportedVideoMimeType = () => {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return "video/webm";
  }
  for (const candidate of VIDEO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return null;
};

type ChatComposerProps = {
  onSend: (text: string, targetLanguage: ChatLanguageCode) => Promise<void>;
  onSendTranslatedVoice?: (
    text: string,
    targetLanguage: ChatLanguageCode
  ) => Promise<void>;
  onSendAttachment?: (file: File) => Promise<void>;
  onImprove?: (
    text: string,
    targetLanguage: ChatLanguageCode
  ) => Promise<{
    corrected: string;
    translation: string;
    note?: string;
  }>;
  onSendVoiceNote?: (blob: Blob, duration: number) => Promise<void>;
  targetLanguage: ChatLanguageCode;
  onTargetLanguageChange: (language: ChatLanguageCode) => void;
  disabled?: boolean;
};

export const CHAT_LANGUAGE_OPTIONS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "ar", label: "Arabe" },
  { code: "ar-ma", label: "Darija (Maghreb)" },
  { code: "zh", label: "Chinois" },
  { code: "pt", label: "Portugais" },
  { code: "pt-br", label: "Portugais (Brésil)" },
  { code: "hi", label: "Hindi" },
  { code: "ko", label: "Coréen" },
  { code: "tr", label: "Turc" },
  { code: "th", label: "Thaï" },
  { code: "es", label: "Espagnol" },
  { code: "de", label: "Allemand" },
  { code: "he", label: "Hébreu" },
  { code: "it", label: "Italien" },
  { code: "ja", label: "Japonais" },
  { code: "ru", label: "Russe" },
  { code: "la", label: "Latin" },
  { code: "fa", label: "Persan" },
] as const;

export type ChatLanguageCode = (typeof CHAT_LANGUAGE_OPTIONS)[number]["code"];

const CHAT_LANGUAGE_LABELS = Object.fromEntries(
  CHAT_LANGUAGE_OPTIONS.map((entry) => [entry.code, entry.label])
) as Record<ChatLanguageCode, string>;

const DICTATION_LOCALE_BY_LANGUAGE: Partial<Record<ChatLanguageCode, string>> = {
  fr: "fr-FR",
  en: "en-US",
  ar: "ar-SA",
  "ar-ma": "ar-MA",
  zh: "zh-CN",
  pt: "pt-PT",
  "pt-br": "pt-BR",
  hi: "hi-IN",
  ko: "ko-KR",
  tr: "tr-TR",
  th: "th-TH",
  es: "es-ES",
  de: "de-DE",
  he: "he-IL",
  it: "it-IT",
  ja: "ja-JP",
  ru: "ru-RU",
  fa: "fa-IR",
};

export type ChatComposerHandle = {
  startVoiceNote: () => void;
  openCamera: (mode: "photo" | "video") => void;
  openFilePicker: () => void;
};

function ChatComposerInner(
  {
    onSend,
    onSendTranslatedVoice,
    onSendAttachment,
    onImprove,
    onSendVoiceNote,
    targetLanguage,
    onTargetLanguageChange,
    disabled,
  }: ChatComposerProps,
  ref: ForwardedRef<ChatComposerHandle>
) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingFile, setSendingFile] = useState(false);
  const [improveLoading, setImproveLoading] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{
    corrected: string;
    translation: string;
    note?: string;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [voiceSending, setVoiceSending] = useState(false);
  const [translatedVoiceSending, setTranslatedVoiceSending] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [menuRecording, setMenuRecording] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraMode, setCameraMode] = useState<"photo" | "video">("photo");
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoRecordingError, setVideoRecordingError] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMimeType, setVideoMimeType] = useState("video/webm");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const photoStreamRef = useRef<MediaStream | null>(null);
  const photoVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldSendRef = useRef(true);
  const startTimeRef = useRef<number>(0);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoTimerRef = useRef<number | null>(null);
  const shouldSendVideoRef = useRef(true);
  const videoStartRef = useRef<number>(0);
  const pointerIdRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseMessageRef = useRef("");
  const dictationFinalTranscriptRef = useRef("");

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const cleanupCameraStream = () => {
    photoStreamRef.current?.getTracks().forEach((track) => track.stop());
    photoStreamRef.current = null;
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopVideoTimer = () => {
    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
  };

  const finalizeRecording = async (shouldSend: boolean) => {
    stopTimer();
    setIsRecording(false);
    setMenuRecording(false);
    const duration = Math.max(
      0,
      Math.round((Date.now() - startTimeRef.current) / 1000)
    );
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    recorderRef.current = null;
    chunksRef.current = [];
    cleanupStream();
    shouldSendRef.current = true;
    setRecordingSeconds(0);
    if (shouldSend && onSendVoiceNote && blob.size > 0) {
      setVoiceSending(true);
      try {
        await onSendVoiceNote(blob, duration || 1);
      } finally {
        setVoiceSending(false);
      }
    }
  };

  const handleStopRecording = (shouldSend: boolean) => {
    if (!recorderRef.current) return;
    shouldSendRef.current = shouldSend;
    recorderRef.current.stop();
  };

  const handleStartRecording = async () => {
    if (!onSendVoiceNote) return;
    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      shouldSendRef.current = true;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => finalizeRecording(shouldSendRef.current);
      recorder.start();
      startTimeRef.current = Date.now();
      stopTimer();
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(
          Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000))
        );
      }, 1000);
      setIsRecording(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible d’accéder au micro.";
      setRecordingError(message);
      cleanupStream();
    }
  };

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      stopTimer();
      cleanupStream();
      cleanupCameraStream();
      stopVideoTimer();
      videoRecorderRef.current?.stop();
      speechRecognitionRef.current?.stop();
    };
  }, []);

  const resolveSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
    if (typeof window === "undefined") return null;
    const candidate = (
      window as Window & {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    ).SpeechRecognition ||
      (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionCtor;
          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      ).webkitSpeechRecognition;
    return candidate || null;
  };

  const startDictation = () => {
    const Ctor = resolveSpeechRecognitionCtor();
    if (!Ctor) {
      setDictationError("Dictée vocale non supportée sur ce navigateur.");
      return;
    }
    setDictationError(null);
    dictationBaseMessageRef.current = message.trim();
    dictationFinalTranscriptRef.current = "";
    const recognition = new Ctor();
    recognition.lang = DICTATION_LOCALE_BY_LANGUAGE[targetLanguage] || "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = (event.results[i]?.[0]?.transcript || "").trim();
        if (!piece) continue;
        if (event.results[i]?.isFinal) {
          dictationFinalTranscriptRef.current = `${dictationFinalTranscriptRef.current} ${piece}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${piece}`.trim();
        }
      }
      const merged = [
        dictationBaseMessageRef.current,
        dictationFinalTranscriptRef.current,
        interimTranscript,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!merged) return;
      setMessage(merged);
    };
    recognition.onerror = (event) => {
      const reason = (event.error || "").trim();
      setDictationError(reason ? `Dictée indisponible: ${reason}` : "Erreur de dictée vocale.");
      setIsDictating(false);
    };
    recognition.onend = () => {
      setIsDictating(false);
      speechRecognitionRef.current = null;
      dictationFinalTranscriptRef.current = "";
      dictationBaseMessageRef.current = "";
    };
    speechRecognitionRef.current = recognition;
    recognition.start();
    setIsDictating(true);
  };

  const stopDictation = () => {
    speechRecognitionRef.current?.stop();
    setIsDictating(false);
  };

  useEffect(() => {
    if (!isRecording) {
      setMenuRecording(false);
    }
  }, [isRecording]);

  const releasePointerCapture = (target: HTMLButtonElement) => {
    if (pointerIdRef.current === null) return;
    if (
      typeof target.hasPointerCapture === "function" &&
      target.hasPointerCapture(pointerIdRef.current)
    ) {
      target.releasePointerCapture(pointerIdRef.current);
    }
    pointerIdRef.current = null;
  };

  const handleRecordPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (voiceSending || disabled) return;
    pointerIdRef.current = event.pointerId;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!isRecording) {
      handleStartRecording();
    }
  };

  const handleRecordPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    releasePointerCapture(event.currentTarget);
    if (isRecording && !voiceSending && !disabled) {
      handleStopRecording(true);
    }
  };

  const handleRecordPointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    releasePointerCapture(event.currentTarget);
    if (isRecording) {
      handleStopRecording(false);
    }
  };

  const openFilePicker = () => {
    if (!onSendAttachment || disabled) return;
    fileInputRef.current?.click();
  };

  const handleOpenCamera = async (mode: "photo" | "video" = "photo") => {
    if (disabled) return;
    setCameraMode(mode);
    setCameraError(null);
    setVideoRecordingError(null);
    setCameraLoading(true);
    cleanupCameraStream();
    stopVideoTimer();
    setIsVideoRecording(false);
    setVideoDuration(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: mode === "video",
      });
      photoStreamRef.current = stream;
      if (photoVideoRef.current) {
        photoVideoRef.current.srcObject = stream;
        photoVideoRef.current.play().catch(() => {});
      }
      setIsCameraActive(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Impossible d’accéder à la caméra.";
      setCameraError(message);
      cleanupCameraStream();
      setIsCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  };

  const handleSwitchCameraMode = async (mode: "photo" | "video") => {
    if (cameraMode === mode && photoStreamRef.current) {
      return;
    }
    await handleOpenCamera(mode);
  };

  const handleStopCamera = () => {
    if (isVideoRecording) {
      handleStopVideoRecording(false);
    }
    cleanupCameraStream();
    stopVideoTimer();
    setIsVideoRecording(false);
    setVideoDuration(0);
    setVideoRecordingError(null);
    setIsCameraActive(false);
  };

  const handleCapturePhoto = async () => {
    if (!photoVideoRef.current || cameraLoading || !onSendAttachment) {
      return;
    }
    const video = photoVideoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setCameraError("Impossible de capturer la photo.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Impossible de capturer la photo.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((data) => resolve(data), "image/png")
    );
    if (!blob) {
      setCameraError("Impossible de capturer la photo.");
      return;
    }
    const file = new File([blob], `photo-${Date.now()}.png`, {
      type: "image/png",
    });
    setCameraLoading(true);
    try {
      await onSendAttachment(file);
      handleStopCamera();
    } finally {
      setCameraLoading(false);
    }
  };

  const startVideoRecording = () => {
    if (!photoStreamRef.current || !onSendAttachment) return;
    setVideoRecordingError(null);
    const supportedMime = getSupportedVideoMimeType();
    if (!supportedMime) {
      setVideoRecordingError("Enregistrement vidéo non supporté dans ce navigateur.");
      return;
    }
    setVideoMimeType(supportedMime);
    videoChunksRef.current = [];
    shouldSendVideoRef.current = true;
    try {
      const recorder = new MediaRecorder(photoStreamRef.current, {
        mimeType: supportedMime,
      });
      videoRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => finalizeVideoRecording(shouldSendVideoRef.current);
      recorder.start();
      videoStartRef.current = Date.now();
      setVideoDuration(0);
      stopVideoTimer();
      videoTimerRef.current = window.setInterval(() => {
        setVideoDuration(
          Math.max(0, Math.round((Date.now() - videoStartRef.current) / 1000))
        );
      }, 1000);
      setIsVideoRecording(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Impossible de lancer la vidéo.";
      setVideoRecordingError(message);
    }
  };

  const finalizeVideoRecording = async (shouldSend: boolean) => {
    stopVideoTimer();
    setIsVideoRecording(false);
    const duration = Math.max(
      0,
      Math.round((Date.now() - videoStartRef.current) / 1000)
    );
    const mimeType = videoRecorderRef.current?.mimeType || videoMimeType || "video/webm";
    const blob = new Blob(videoChunksRef.current, {
      type: mimeType,
    });
    videoRecorderRef.current = null;
    videoChunksRef.current = [];
    if (shouldSend && onSendAttachment && blob.size > 0) {
      setCameraLoading(true);
      try {
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `video-${Date.now()}.${ext}`, {
          type: mimeType,
        });
        await onSendAttachment(file);
        handleStopCamera();
      } finally {
        setCameraLoading(false);
      }
    }
    setVideoDuration(duration);
  };

  const handleStopVideoRecording = (shouldSend: boolean) => {
    if (!videoRecorderRef.current) return;
    shouldSendVideoRef.current = shouldSend;
    if (!shouldSend) {
      videoChunksRef.current = [];
    }
    videoRecorderRef.current.stop();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSend = async () => {
    const text = message.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(text, targetLanguage);
      setMessage("");
      setSuggestion(null);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Impossible d’envoyer le message pour l’instant.";
      setSendError(msg);
    } finally {
      setSending(false);
    }
  };

  const startVoiceNoteFromMenu = () => {
    if (
      voiceSending ||
      disabled ||
      isRecording ||
      typeof onSendVoiceNote === "undefined"
    ) {
      return;
    }
    setMenuRecording(true);
    void handleStartRecording();
  };

  const stopVoiceNoteFromMenu = (shouldSend: boolean) => {
    if (!isRecording) {
      setMenuRecording(false);
      return;
    }
    handleStopRecording(shouldSend);
  };

  const openCameraFromMenu = (mode: "photo" | "video") => {
    if (disabled) return;
    void handleOpenCamera(mode);
  };

  useImperativeHandle(ref, () => ({
    startVoiceNote: startVoiceNoteFromMenu,
    openCamera: openCameraFromMenu,
    openFilePicker,
  }));

  const handleImprove = async () => {
    const text = message.trim();
    if (!text || !onImprove || improveLoading || disabled) return;
    setImproveLoading(true);
    setImproveError(null);
    try {
      const result = await onImprove(text, targetLanguage);
      setSuggestion(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erreur IA";
      setImproveError(msg);
    } finally {
      setImproveLoading(false);
    }
  };

  const handleUseAndSend = async (text: string) => {
    if (!text.trim() || sending || disabled) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(text.trim(), targetLanguage);
      setMessage("");
      setSuggestion(null);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Impossible d’envoyer le message corrigé.";
      setSendError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleSendTranslatedVoice = async () => {
    const text = message.trim();
    if (!text || !onSendTranslatedVoice || disabled || translatedVoiceSending) return;
    setTranslatedVoiceSending(true);
    setSendError(null);
    try {
      await onSendTranslatedVoice(text, targetLanguage);
      setMessage("");
      setSuggestion(null);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Impossible d'envoyer la voix traduite pour le moment.";
      setSendError(msg);
    } finally {
      setTranslatedVoiceSending(false);
    }
  };

  const targetLanguageLabel = CHAT_LANGUAGE_LABELS[targetLanguage] || targetLanguage;
  const messagePlaceholder = `Écris ton message... (traduction vers ${targetLanguageLabel})`;
  const sendButtonLabel = sending ? "Envoi..." : `Envoyer (${targetLanguage.toUpperCase()})`;

  return (
    <div className="border-t border-white/10 bg-white/5 p-4">
      {sendError && (
        <div className="mb-3 text-xs text-rose-200">{sendError}</div>
      )}
      {(suggestion || improveError) && (
        <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-gray-100">
          {improveError && <p className="text-red-300">{improveError}</p>}
          {suggestion && (
            <div className="space-y-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-amber-200">
                  Correction
                </p>
                <p className="text-sm text-white">{suggestion.corrected}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-emerald-200">
                  Traduction ({CHAT_LANGUAGE_LABELS[targetLanguage] || targetLanguage})
                </p>
                <p className="text-sm text-emerald-50">{suggestion.translation}</p>
              </div>
              {suggestion.note && (
                <p className="text-[11px] text-gray-300">{suggestion.note}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setMessage(suggestion.corrected)}
                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                >
                  Utiliser la correction
                </button>
                <button
                  onClick={() => setMessage(suggestion.translation)}
                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                >
                  Utiliser la traduction
                </button>
                <button
                  onClick={() => handleUseAndSend(suggestion.corrected)}
                  className="rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-1 text-xs text-white hover:bg-amber-500/30"
                >
                  Envoyer correction
                </button>
                <button
                  onClick={() => handleUseAndSend(suggestion.translation)}
                  className="rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-xs text-white hover:bg-emerald-500/30"
                >
                  Envoyer traduction
                </button>
                <button
                  onClick={() => setSuggestion(null)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300 hover:bg-white/10"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {menuRecording && (
        <div className="mb-3 rounded-2xl border border-rose-400/40 bg-black/70 p-3 text-sm text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-rose-200">
                Enregistrement vocal
              </p>
              <p className="text-sm text-white/80">
                Clique sur « Arrêter et envoyer » ou « Annuler » pour stopper.
              </p>
              <p className="text-xs text-white/60">
                {formatDuration(recordingSeconds)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => stopVoiceNoteFromMenu(true)}
                className="rounded-2xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
              >
                Arrêter et envoyer
              </button>
              <button
                onClick={() => stopVoiceNoteFromMenu(false)}
                className="rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
      {isCameraActive && (
        <div className="mb-3 rounded-2xl border border-white/10 bg-black/40 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => handleSwitchCameraMode("photo")}
                disabled={cameraLoading}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  cameraMode === "photo"
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                    : "border-white/10 text-white hover:border-white/30"
                }`}
              >
                Photo
              </button>
              <button
                onClick={() => handleSwitchCameraMode("video")}
                disabled={cameraLoading}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  cameraMode === "video"
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                    : "border-white/10 text-white hover:border-white/30"
                }`}
              >
                Vidéo
              </button>
            </div>
            {cameraMode === "video" && (
              <span className="text-[11px] text-white/70">
                {formatDuration(videoDuration)}
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
            <div className="relative h-65 w-full">
              <video
                ref={photoVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          </div>
          {cameraError && (
            <p className="mt-2 text-xs text-rose-200">{cameraError}</p>
          )}
          {videoRecordingError && (
            <p className="mt-2 text-xs text-rose-200">{videoRecordingError}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {cameraMode === "photo" ? (
              <button
                onClick={handleCapturePhoto}
                className="flex-1 rounded-2xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500/30 disabled:opacity-60"
                disabled={cameraLoading}
              >
                {cameraLoading ? "Capture..." : "Prendre la photo"}
              </button>
            ) : (
              <>
                <button
                  onClick={() =>
                    isVideoRecording
                      ? handleStopVideoRecording(true)
                      : startVideoRecording()
                  }
                  className={`flex-1 rounded-2xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500/30 disabled:opacity-60 ${
                    isVideoRecording ? "bg-rose-500/40 border-rose-400" : ""
                  }`}
                >
                  {isVideoRecording ? "⏹️ Arrêter" : "🎬 Enregistrer"}
                </button>
                {isVideoRecording && (
                  <button
                    onClick={() => handleStopVideoRecording(false)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white transition hover:bg-white/10"
                  >
                    Annuler
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleStopCamera}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white transition hover:bg-white/10"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      <div className="flex w-full flex-col gap-3">
        <div className="flex w-full flex-wrap items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            disabled={disabled || sendingFile}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !onSendAttachment) return;
              setSendingFile(true);
              try {
                await onSendAttachment(file);
              } finally {
                setSendingFile(false);
                event.target.value = "";
              }
            }}
          />
          <div className="flex flex-1 min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={messagePlaceholder}
              disabled={disabled || isRecording}
              rows={1}
              className="flex-1 min-w-0 rounded-2xl border border-transparent bg-white/5 px-2 py-2 text-sm text-white placeholder:text-gray-400 focus:border-amber-400/60 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={disabled || sending}
            className="flex h-11 items-center justify-center rounded-2xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {sendButtonLabel}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={isDictating ? stopDictation : startDictation}
            disabled={disabled || translatedVoiceSending || sending}
            className={`inline-flex items-center gap-1 rounded-2xl border px-3 py-2 text-xs font-semibold text-white transition disabled:opacity-60 ${
              isDictating
                ? "border-rose-400/50 bg-rose-500/20 hover:bg-rose-500/30"
                : "border-white/10 bg-white/10 hover:bg-white/20"
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            {isDictating ? "Stop dictée" : "Dicter"}
          </button>
          <select
            value={targetLanguage}
            onChange={(event) =>
              onTargetLanguageChange(event.target.value as ChatLanguageCode)
            }
            className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
            disabled={disabled}
          >
            {CHAT_LANGUAGE_OPTIONS.map((lang) => (
              <option key={lang.code} value={lang.code} className="text-black">
                {lang.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleImprove}
            disabled={disabled || improveLoading || !message.trim()}
            className="rounded-2xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500/30 disabled:opacity-60"
          >
            {improveLoading ? "Analyse..." : "Améliorer + Traduire"}
          </button>
          <button
            onClick={handleSendTranslatedVoice}
            disabled={disabled || !message.trim() || translatedVoiceSending || !onSendTranslatedVoice}
            className="rounded-2xl border border-sky-400/40 bg-sky-500/20 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500/30 disabled:opacity-60"
          >
            {translatedVoiceSending ? "Voix..." : "Envoyer voix traduite"}
          </button>
          <span className="text-[11px] text-gray-300">
            Traduction active vers <span className="font-semibold text-amber-200">{targetLanguageLabel}</span>
          </span>
        </div>
        {dictationError && <div className="text-xs text-rose-200">{dictationError}</div>}
        {recordingError && (
          <div className="text-xs text-rose-200">{recordingError}</div>
        )}
      </div>
    </div>
  );
}

const ChatComposer = forwardRef(ChatComposerInner);
export default ChatComposer;
