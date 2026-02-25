"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, Play, RefreshCw, Trash2 } from "lucide-react";
import {
  clearTranslationNotebookEntries,
  getTranslationNotebookEntries,
  TRANSLATION_NOTEBOOK_STORAGE_KEY,
  type TranslationNotebookEntry,
} from "@/lib/translationNotebook";
import { SPEECH_LANG_BY_TARGET } from "@/components/video/LiveKit/translationConfig";
import { getAuthHeader } from "@/lib/authHeader";

const formatEntryTime = (timestamp: number) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

function TranslationNotebookPageContent() {
  const [entries, setEntries] = useState<TranslationNotebookEntry[]>([]);
  const [playbackError, setPlaybackError] = useState("");
  const [playingKey, setPlayingKey] = useState("");
  const searchParams = useSearchParams();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");

  const returnTo = useMemo(() => {
    const candidate = (searchParams.get("returnTo") || "").trim();
    if (!candidate.startsWith("/videoconference")) return "/videoconference";
    return candidate;
  }, [searchParams]);

  const loadEntries = useCallback(() => {
    setEntries(getTranslationNotebookEntries());
  }, []);

  const stopPlayback = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setPlayingKey("");
  }, []);

  const speakWithLocalVoice = useCallback(
    async (text: string, langCode: string) => {
      if (typeof window === "undefined") return false;
      if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
        return false;
      }
      const speech = window.speechSynthesis;
      const locale = SPEECH_LANG_BY_TARGET[langCode] || "";
      const utterance = new SpeechSynthesisUtterance(text);
      if (locale) {
        utterance.lang = locale;
      }
      const voices = speech.getVoices();
      if (voices.length && locale) {
        const preferredLower = locale.toLowerCase();
        const preferredPrefix = preferredLower.split("-")[0];
        const preferredVoice =
          voices.find((voice) => voice.lang?.toLowerCase() === preferredLower) ||
          voices.find((voice) => voice.lang?.toLowerCase().startsWith(preferredPrefix));
        if (!preferredVoice) return false;
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang || utterance.lang;
      }
      stopPlayback();
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(ok);
        };
        const timeoutId = window.setTimeout(() => finish(false), 2800);
        utterance.onstart = () => finish(true);
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        speech.cancel();
        speech.speak(utterance);
      });
    },
    [stopPlayback]
  );

  const speakWithServerVoice = useCallback(
    async (text: string) => {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) return false;
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ text, voice: "alloy" }),
      });
      if (!response.ok) return false;
      const arrayBuffer = await response.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      stopPlayback();
      audioUrlRef.current = url;
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.preload = "auto";
      audio.setAttribute("playsinline", "true");
      audio.src = url;
      await audio.play();
      return true;
    },
    [stopPlayback]
  );

  const handlePlay = useCallback(
    async (entry: TranslationNotebookEntry, kind: "source" | "translation") => {
      const text = (kind === "source" ? entry.sourceText : entry.translatedText).trim();
      if (!text) return;
      const langCode = (kind === "source" ? entry.sourceLanguageCode : entry.targetLanguageCode)
        .trim()
        .toLowerCase();
      const currentKey = `${entry.id}:${kind}`;
      if (playingKey === currentKey) {
        stopPlayback();
        return;
      }
      setPlaybackError("");
      setPlayingKey(currentKey);
      try {
        const serverPlayed = await speakWithServerVoice(text);
        if (serverPlayed) return;
        const localPlayed = await speakWithLocalVoice(text, langCode);
        if (localPlayed) return;
        setPlaybackError("Lecture indisponible pour cette langue sur cet appareil.");
      } catch {
        setPlaybackError("Lecture indisponible temporairement.");
      } finally {
        setPlayingKey("");
      }
    },
    [playingKey, speakWithLocalVoice, speakWithServerVoice, stopPlayback]
  );

  useEffect(() => {
    loadEntries();
    const onFocus = () => loadEntries();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === TRANSLATION_NOTEBOOK_STORAGE_KEY) {
        loadEntries();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      stopPlayback();
    };
  }, [loadEntries, stopPlayback]);

  const hasEntries = entries.length > 0;
  const entryCountLabel = useMemo(() => `${entries.length}/10`, [entries.length]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-sky-300" />
              <div>
                <h1 className="text-lg font-semibold">Bloc-notes traduction</h1>
                <p className="text-xs text-slate-300">
                  Exercice langue: dernieres traductions memorisees ({entryCountLabel})
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadEntries}
                className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Actualiser
              </button>
              <button
                type="button"
                onClick={() => {
                  clearTranslationNotebookEntries();
                  loadEntries();
                }}
                disabled={!hasEntries}
                className="inline-flex items-center gap-2 rounded-full border border-rose-500/70 bg-rose-900/60 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vider
              </button>
              <Link
                href={returnTo}
                className="inline-flex items-center gap-2 rounded-full border border-sky-400/70 bg-sky-900/60 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Retour visio
              </Link>
            </div>
          </div>
        </div>
        {playbackError && (
          <div className="rounded-xl border border-amber-500/60 bg-amber-950/50 px-3 py-2 text-xs text-amber-200">
            {playbackError}
          </div>
        )}

        {!hasEntries && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
            Aucune traduction enregistree pour le moment.
            <br />
            Lance une session Exercice langue puis maintiens le bouton pour parler.
          </div>
        )}

        {hasEntries && (
          <div className="space-y-3">
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span
                    className={`rounded-full border px-2 py-0.5 font-semibold ${
                      entry.direction === "outgoing"
                        ? "border-emerald-400/60 bg-emerald-900/40 text-emerald-100"
                        : "border-amber-400/60 bg-amber-900/40 text-amber-100"
                    }`}
                  >
                    {entry.direction === "outgoing" ? "Envoye" : "Recu"}
                  </span>
                  <span className="text-slate-400">{formatEntryTime(entry.createdAt)}</span>
                </div>
                <div className="mb-3 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-300">
                  {entry.sourceLanguageName || "Source"} ({entry.sourceLanguageCode || "--"}) {"->"}{" "}
                  {entry.targetLanguageName || "Cible"} ({entry.targetLanguageCode || "--"})
                </div>
                <div className="space-y-2 text-sm">
                  <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Source
                    </p>
                    <p className="text-slate-100">{entry.sourceText}</p>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => handlePlay(entry, "source")}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-700"
                      >
                        <Play className="h-3 w-3" />
                        {playingKey === `${entry.id}:source` ? "Lecture..." : "Lire source"}
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-sky-500/40 bg-sky-950/30 px-3 py-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                      Traduction
                    </p>
                    <p className="text-sky-100">{entry.translatedText}</p>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => handlePlay(entry, "translation")}
                        className="inline-flex items-center gap-1 rounded-full border border-sky-500/70 bg-sky-900/40 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-800/50"
                      >
                        <Play className="h-3 w-3" />
                        {playingKey === `${entry.id}:translation`
                          ? "Lecture..."
                          : "Lire traduction"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function TranslationNotebookPageFallback() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-xl">
          <p className="text-sm text-slate-300">Chargement du bloc-notes...</p>
        </div>
      </div>
    </main>
  );
}

export default function TranslationNotebookPage() {
  return (
    <Suspense fallback={<TranslationNotebookPageFallback />}>
      <TranslationNotebookPageContent />
    </Suspense>
  );
}
