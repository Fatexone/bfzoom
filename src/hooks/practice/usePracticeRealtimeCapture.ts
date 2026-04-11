"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
};

type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type UsePracticeRealtimeCaptureOptions = {
  lang: string;
  onFinalTranscript: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
};

const resolveSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const maybeWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return maybeWindow.SpeechRecognition || maybeWindow.webkitSpeechRecognition || null;
};

const normalizeTranscript = (value: string) => value.replace(/\s+/g, " ").trim();

const getFriendlySpeechRecognitionError = (reason: string) => {
  switch (reason) {
    case "aborted":
      return "Capture vocale arretee.";
    case "audio-capture":
      return "Impossible d'acceder au micro du navigateur.";
    case "network":
      return "Reconnaissance vocale indisponible temporairement.";
    case "no-speech":
      return "Aucune voix detectee.";
    case "not-allowed":
    case "service-not-allowed":
      return "Acces micro refuse.";
    case "language-not-supported":
      return "Langue non supportee par la reconnaissance vocale du navigateur.";
    default:
      return reason ? `Reconnaissance vocale: ${reason}` : "Reconnaissance vocale indisponible.";
  }
};

export function usePracticeRealtimeCapture({
  lang,
  onFinalTranscript,
  onInterimTranscript,
  onError,
}: UsePracticeRealtimeCaptureOptions) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionIdRef = useRef(0);
  const liveTranscriptRef = useRef("");
  const emitFinalOnEndRef = useRef(false);
  const callbacksRef = useRef({
    lang,
    onFinalTranscript,
    onInterimTranscript,
    onError,
  });
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    callbacksRef.current = {
      lang,
      onFinalTranscript,
      onInterimTranscript,
      onError,
    };
  }, [lang, onError, onFinalTranscript, onInterimTranscript]);

  const supported = useMemo(() => Boolean(resolveSpeechRecognitionCtor()), []);

  const resetState = useCallback(() => {
    setIsListening(false);
    setTranscript("");
    liveTranscriptRef.current = "";
    emitFinalOnEndRef.current = false;
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      resetState();
      return false;
    }
    emitFinalOnEndRef.current = true;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort?.();
      } catch {}
    }
    return true;
  }, [resetState]);

  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      resetState();
      return false;
    }
    emitFinalOnEndRef.current = false;
    try {
      recognition.abort?.();
    } catch {
      try {
        recognition.stop();
      } catch {}
    }
    return true;
  }, [resetState]);

  const start = useCallback(() => {
    const Ctor = resolveSpeechRecognitionCtor();
    if (!Ctor) {
      const message = "La reconnaissance vocale web n'est pas supportee sur ce navigateur.";
      setError(message);
      callbacksRef.current.onError?.(message);
      return false;
    }

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    if (recognitionRef.current) {
      void cancel();
    }

    const recognition = new Ctor();
    recognition.lang = callbacksRef.current.lang || "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    liveTranscriptRef.current = "";
    emitFinalOnEndRef.current = true;
    setIsListening(true);
    setTranscript("");
    setError("");

    recognition.onresult = (event) => {
      if (sessionId !== sessionIdRef.current) return;
      let interimTranscript = "";
      let finalTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const piece = normalizeTranscript(String(result?.[0]?.transcript || ""));
        if (!piece) continue;
        if (result?.isFinal) {
          finalTranscript = normalizeTranscript(`${finalTranscript} ${piece}`);
        } else {
          interimTranscript = normalizeTranscript(`${interimTranscript} ${piece}`);
        }
      }

      if (finalTranscript) {
        liveTranscriptRef.current = normalizeTranscript(
          `${liveTranscriptRef.current} ${finalTranscript}`
        );
      }

      const nextTranscript = normalizeTranscript(
        `${liveTranscriptRef.current} ${interimTranscript}`
      );
      liveTranscriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
      callbacksRef.current.onInterimTranscript?.(nextTranscript);
    };

    recognition.onerror = (event) => {
      if (sessionId !== sessionIdRef.current) return;
      const reason = normalizeTranscript(String(event?.error || ""));
      if (reason === "aborted") return;
      const message = getFriendlySpeechRecognitionError(reason);
      emitFinalOnEndRef.current = false;
      recognitionRef.current = null;
      resetState();
      setError(message);
      callbacksRef.current.onError?.(message);
    };

    recognition.onend = () => {
      if (sessionId !== sessionIdRef.current) return;
      recognitionRef.current = null;
      setIsListening(false);
      const finalTranscript = normalizeTranscript(liveTranscriptRef.current);
      const shouldEmit = emitFinalOnEndRef.current;
      emitFinalOnEndRef.current = false;
      setTranscript("");
      liveTranscriptRef.current = "";
      if (shouldEmit && finalTranscript) {
        callbacksRef.current.onFinalTranscript(finalTranscript);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      return true;
    } catch (err) {
      recognitionRef.current = null;
      resetState();
      const message = err instanceof Error ? err.message : "Reconnaissance vocale indisponible.";
      setError(message);
      callbacksRef.current.onError?.(message);
      return false;
    }
  }, [cancel, resetState]);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      emitFinalOnEndRef.current = false;
      liveTranscriptRef.current = "";
      try {
        recognition?.abort?.();
      } catch {
        try {
          recognition?.stop();
        } catch {}
      }
    };
  }, []);

  return {
    supported,
    isListening,
    transcript,
    error,
    start,
    stop,
    cancel,
    setError,
  } as const;
}
