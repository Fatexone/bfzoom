"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User, getIdToken } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import { Languages, ArrowLeft, Play } from "lucide-react";
import { motion } from "framer-motion";

const LANGUAGE_OPTIONS = [
  "Arabe",
  "Anglais",
  "Chinois",
  "Espagnol",
  "Persan (Farsi)",
  "Hébreu",
  "Italien",
  "Russe",
];
const LEVEL_OPTIONS = ["Débutant", "Intermédiaire", "Avancé", "Fluent"];

export default function PracticePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState(LANGUAGE_OPTIONS[0] ?? "Anglais");
  const [level, setLevel] = useState(LEVEL_OPTIONS[0] ?? "Débutant");
  const [phraseCount, setPhraseCount] = useState(5);
  const [wordCount, setWordCount] = useState(8);
  const [mode, setMode] = useState<"setup" | "lesson" | "practice">("setup");
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [lesson, setLesson] = useState<{
    title: string;
    phrases: string[];
    words: string[];
  } | null>(null);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const [practiceLog, setPracticeLog] = useState<
    { id: string; phrase: string; userText: string; feedback: string; time: string }[]
  >([]);
  const [translateInput, setTranslateInput] = useState("");
  const [translateOutput, setTranslateOutput] = useState<string | null>(null);
  const [translatePhonetic, setTranslatePhonetic] = useState<string | null>(null);
  const [translateFrench, setTranslateFrench] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState<string | null>(null);
  const [recorderSupported, setRecorderSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsVoice, setTtsVoice] = useState("alloy");
  const [ttsVolume, setTtsVolume] = useState(0.8);
  const [ttsUnlocked, setTtsUnlocked] = useState(false);
  const [showFeedback, setShowFeedback] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const [messageExtras, setMessageExtras] = useState<
    Record<
      string,
      {
        translation?: string;
        phonetic?: string;
        loading?: boolean;
        mode?: "none" | "phonetic" | "fr" | "both";
        error?: string;
      }
    >
  >({});

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoading(false);
      } else {
        router.push("/");
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) return;
    setRecorderSupported(typeof MediaRecorder !== "undefined");

    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    const guarded = async (constraints: MediaStreamConstraints) => {
      if (constraints && typeof constraints === "object") {
        const video = (constraints as { video?: boolean | MediaTrackConstraints }).video;
        if (video) {
          throw new Error("Camera disabled in practice module.");
        }
      }
      return original(constraints);
    };

    (mediaDevices as { getUserMedia: typeof mediaDevices.getUserMedia }).getUserMedia = guarded;

    return () => {
      (mediaDevices as { getUserMedia: typeof mediaDevices.getUserMedia }).getUserMedia = original;
    };
  }, []);

  useEffect(() => {
    if (!ttsEnabled) {
      setTtsUnlocked(false);
    }
  }, [ttsEnabled, ttsVoice]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [practiceLog.length, transcriptStatus, isThinking]);

  const stopAudio = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    setTtsUnlocked(false);
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current.src = "";
    }
  };

  const getAuthToken = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("Utilisateur non connecté");
    }
    return getIdToken(currentUser, true);
  };

  const addPracticeLog = (phrase: string, userText: string, feedback: string) => {
    const time = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setPracticeLog((prev) => [
      ...prev,
      { id: `log-${Date.now()}-${Math.random()}`, phrase, userText, feedback, time },
    ]);
  };

  const buildLessonPrompt = () => {
    const levelRules: Record<string, string> = {
      "Débutant":
        "Phrases très simples (A1), vocabulaire quotidien, 6-10 mots par phrase.",
      "Intermédiaire":
        "Phrases complètes (A2-B1), vocabulaire de travail léger, 10-14 mots par phrase.",
      "Avancé":
        "Phrases complexes (B2-C1), connecteurs, vocabulaire spécifique, 12-18 mots.",
      "Fluent":
        "Niveau natif (C1-C2), nuances, idioms, vocabulaire élevé, 14-20 mots.",
    };
    return [
      "Tu es un coach de langue.",
      `Langue cible: ${language}. Niveau: ${level}.`,
      `Crée une leçon courte avec ${phraseCount} phrases et ${wordCount} mots.`,
      `Règles niveau: ${levelRules[level] ?? levelRules["Intermédiaire"]}`,
      "Chaque phrase doit être utile, réaliste et exigeante.",
      "Retourne un JSON strict avec les clés: title, phrases, words.",
      "phrases: tableau de phrases en langue cible.",
      "words: tableau de mots isolés en langue cible.",
    ].join(" ");
  };

  const buildFeedbackPrompt = (target: string, userText: string) => {
    return [
      "Tu es un coach de langue.",
      `Langue cible: ${language}. Niveau: ${level}.`,
      `Phrase cible: ${target}`,
      `Réponse utilisateur: ${userText}`,
      "Donne un feedback bref en français (max 20 mots) + correction en langue cible.",
      'Format STRICT: {"feedback":"...","correction":"..."}',
    ].join(" ");
  };

  const buildTranslatePrompt = (text: string) => {
    return [
      "Tu es un traducteur.",
      `Langue cible: ${language}.`,
      "Retourne un JSON strict avec les clés: translated, phonetic, french.",
      "translated: phrase dans la langue cible.",
      "phonetic: translittération en alphabet latin si la langue n'est pas latine.",
      "french: reformulation en français de la phrase traduite.",
      `Texte: ${text}`,
    ].join(" ");
  };

  const buildTranslationPrompt = (text: string) => {
    return [
      "Tu es un assistant de langue.",
      `Langue cible: ${language}.`,
      "Retourne un JSON strict avec les clés: phonetic, french.",
      "phonetic: translittération en alphabet latin si la langue n'est pas latine.",
      "french: traduction en français.",
      "Réponses courtes.",
      `Texte: ${text}`,
    ].join(" ");
  };

  const fetchTranslation = async (entryId: string, text: string) => {
    try {
      setMessageExtras((prev) => ({
        ...prev,
        [entryId]: { ...prev[entryId], loading: true, error: undefined },
      }));
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Utilisateur non connecté");
      }
      const token = await getIdToken(currentUser, true);
      const messages = [
        { role: "system", content: buildTranslationPrompt(text) },
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
      let parsed: { phonetic?: string; french?: string } = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        const phoneticMatch = content.match(/phonetic\s*[:=]\s*(.+)/i);
        const frenchMatch = content.match(/french\s*[:=]\s*(.+)/i);
        parsed = {
          phonetic: phoneticMatch?.[1]?.trim(),
          french: frenchMatch?.[1]?.trim(),
        };
      }
      setMessageExtras((prev) => ({
        ...prev,
        [entryId]: {
          ...prev[entryId],
          loading: false,
          phonetic: parsed.phonetic,
          translation: parsed.french,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur traduction";
      setMessageExtras((prev) => ({
        ...prev,
        [entryId]: { ...prev[entryId], loading: false, error: message },
      }));
    }
  };

  const transcribeAudio = async (blob: Blob) => {
    const token = await getAuthToken();
    const formData = new FormData();
    formData.append("file", new File([blob], "practice-audio.webm", { type: blob.type }));
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      const message = data?.error || "Erreur transcription";
      throw new Error(message);
    }
    return String(data?.text ?? "").trim();
  };

  const playNextTts = async () => {
    if (!ttsEnabled || !ttsUnlocked || ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;
    ttsPlayingRef.current = true;
    try {
      const token = await getAuthToken();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: next, voice: ttsVoice }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Erreur TTS");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioPlaybackRef.current ?? new Audio();
      audioPlaybackRef.current = audio;
      audio.src = url;
      audio.volume = ttsVolume;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        ttsPlayingRef.current = false;
        playNextTts();
      };
      await audio.play();
    } catch (error) {
      ttsPlayingRef.current = false;
      const message = error instanceof Error ? error.message : "Erreur TTS";
      setTranscriptStatus(`Erreur voix alter ego : ${message}`);
    }
  };

  const enqueueTts = (text: string) => {
    if (!ttsEnabled || !ttsUnlocked) return;
    ttsQueueRef.current.push(text);
    playNextTts();
  };

  const playTtsText = async (text: string) => {
    if (!ttsEnabled) {
      setTtsEnabled(true);
    }
    if (!ttsUnlocked) {
      await handleUnlockTts();
    }
    ttsQueueRef.current.push(text);
    playNextTts();
  };

  const handleUnlockTts = async () => {
    try {
      setTtsEnabled(true);
      const token = await getAuthToken();
      const sample = "Hello, let's practice together.";
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: sample, voice: ttsVoice }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Erreur TTS");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioPlaybackRef.current ?? new Audio();
      audioPlaybackRef.current = audio;
      audio.src = url;
      audio.volume = ttsVolume;
      audio.onended = () => {
        URL.revokeObjectURL(url);
      };
      await audio.play();
      setTtsUnlocked(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur TTS";
      setTranscriptStatus(`Erreur voix alter ego : ${message}`);
    }
  };

  const generateLesson = async () => {
    try {
      setLessonLoading(true);
      setLessonError(null);
      const token = await getAuthToken();
      const messages = [
        { role: "system", content: buildLessonPrompt() },
        { role: "user", content: "Génère la leçon." },
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
        throw new Error(data?.error || "Erreur génération leçon");
      }
      const content = data?.choices?.[0]?.message?.content ?? "";
      const cleaned = content.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(cleaned) as { title: string; phrases: string[]; words: string[] };
      if (!parsed?.phrases?.length) {
        throw new Error("Leçon vide");
      }
      const minWordsByLevel: Record<string, number> = {
        Débutant: 6,
        Intermédiaire: 10,
        Avancé: 12,
        Fluent: 14,
      };
      const minWords = minWordsByLevel[level] ?? 10;
      const filteredPhrases = parsed.phrases.filter(
        (phrase) => phrase.split(/\s+/).filter(Boolean).length >= minWords
      );
      parsed.phrases = filteredPhrases.length ? filteredPhrases : parsed.phrases;
      setLesson(parsed);
      setMode("lesson");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur génération leçon";
      setLessonError(message);
    } finally {
      setLessonLoading(false);
    }
  };

  const handleAcceptLesson = () => {
    if (!lesson) return;
    setPracticeLog([]);
    setCurrentPhraseIndex(0);
    setMode("practice");
  };

  const handleRegenerateLesson = () => {
    generateLesson();
  };

  const handleRegenerateByLevel = (direction: "easier" | "harder") => {
    const order = ["Débutant", "Intermédiaire", "Avancé", "Fluent"];
    const index = Math.max(0, order.indexOf(level));
    const nextIndex =
      direction === "easier" ? Math.max(0, index - 1) : Math.min(order.length - 1, index + 1);
    const nextLevel = order[nextIndex];
    setLevel(nextLevel);
    setTimeout(() => {
      generateLesson();
    }, 0);
  };

  const handleTranslate = async () => {
    const input = translateInput.trim();
    if (!input) return;
    try {
      setTranslateLoading(true);
      setTranslateError(null);
      const token = await getAuthToken();
      const messages = [
        { role: "system", content: buildTranslatePrompt(input) },
        { role: "user", content: input },
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
      const cleaned = content.replace(/```json|```/gi, "").trim();
      let parsed: { translated?: string; phonetic?: string; french?: string } = {};
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { translated: cleaned };
      }
      setTranslateOutput(parsed.translated?.trim() || cleaned.trim());
      setTranslatePhonetic(parsed.phonetic?.trim() || null);
      setTranslateFrench(parsed.french?.trim() || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur traduction";
      setTranslateError(message);
    } finally {
      setTranslateLoading(false);
    }
  };

  const startPushToTalk = async () => {
    if (isRecording) return;
    setTranscriptStatus(null);
    setIsRecording(true);
    try {
      if (!mediaStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        mediaStreamRef.current = stream;
      }
      if (typeof MediaRecorder === "undefined") {
        setRecorderSupported(false);
        setIsRecording(false);
        return;
      }
      const recorder = new MediaRecorder(mediaStreamRef.current);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.start();
    } catch (error) {
      console.warn("Practice mic error", error);
      setIsRecording(false);
    }
  };

  const stopPushToTalk = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.onstop = async () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (!chunks.length || !lesson) return;
      setTranscriptStatus("Transcription en cours…");
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      try {
        const userText = await transcribeAudio(blob);
        setTranscriptStatus(null);
        const phrase = lesson.phrases[currentPhraseIndex] ?? "";
        if (!userText) {
          addPracticeLog(phrase, "", "Transcription vide, réessaie.");
          return;
        }
        setIsThinking(true);
        const token = await getAuthToken();
        const messages = [
          { role: "system", content: buildFeedbackPrompt(phrase, userText) },
          { role: "user", content: userText },
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
          throw new Error(data?.error || "Erreur feedback");
        }
        const content = data?.choices?.[0]?.message?.content ?? "";
        const cleaned = content.replace(/```json|```/gi, "").trim();
        let feedbackText = "Bon travail.";
        try {
          const parsed = JSON.parse(cleaned) as { feedback?: string; correction?: string };
          feedbackText = `${parsed.feedback ?? "Bon travail."} ${parsed.correction ?? ""}`.trim();
        } catch {
          feedbackText = cleaned.trim();
        }
        addPracticeLog(phrase, userText, feedbackText);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur feedback";
        addPracticeLog(lesson?.phrases[currentPhraseIndex] ?? "", "", `Erreur: ${message}`);
      } finally {
        setIsThinking(false);
      }
    };
    recorder.stop();
  };

  const handleNextPhrase = () => {
    if (!lesson) return;
    setCurrentPhraseIndex((prev) =>
      Math.min(prev + 1, Math.max(lesson.phrases.length - 1, 0))
    );
  };

  const handlePrevPhrase = () => {
    setCurrentPhraseIndex((prev) => Math.max(prev - 1, 0));
  };

  useEffect(() => {
    return () => stopAudio();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-400 text-lg">
        ⏳ Chargement...
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-linear-to-br from-slate-950 via-slate-900 to-emerald-950 text-white px-6 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.12),transparent_60%)]" />

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition"
          >
            <ArrowLeft className="h-4 w-4" /> Retour au dashboard
          </button>
          <span className="text-xs text-slate-400">
            Connecté : {user?.email ?? "Utilisateur"}
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-10"
        >
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-2">
            Module d’entraînement
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl">
            Entraîne-toi avec un alter ego intelligent pour gagner en aisance avant
            tes rendez-vous, cours ou sessions de coaching.
          </p>
        </motion.div>

        {mode === "setup" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Languages className="h-6 w-6 text-sky-300" />
                <div>
                  <h2 className="text-xl font-semibold">Prépare ta leçon</h2>
                  <p className="text-xs text-slate-400">
                    Choisis la langue et le niveau, puis génère une leçon.
                  </p>
                </div>
              </div>
              <button
                onClick={generateLesson}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-700 hover:shadow-emerald-500/30 active:scale-95"
                disabled={lessonLoading}
              >
                <Play className="h-4 w-4" /> {lessonLoading ? "Création..." : "Générer"}
              </button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">Langue</label>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Niveau</label>
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                >
                  {LEVEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Nombre de phrases</label>
                <input
                  type="number"
                  min={3}
                  max={15}
                  value={phraseCount}
                  onChange={(event) => setPhraseCount(Number(event.target.value))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Nombre de mots</label>
                <input
                  type="number"
                  min={5}
                  max={20}
                  value={wordCount}
                  onChange={(event) => setWordCount(Number(event.target.value))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                />
              </div>
            </div>
            {lessonError && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {lessonError}
              </div>
            )}
          </motion.div>
        )}

        {mode === "lesson" && lesson && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{lesson.title || "Leçon"}</h3>
                <p className="text-xs text-slate-400">
                  {lesson.phrases.length} phrases • {lesson.words.length} mots
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleRegenerateByLevel("easier")}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30"
                >
                  Trop dur
                </button>
                <button
                  onClick={handleRegenerateLesson}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30"
                >
                  Regénérer
                </button>
                <button
                  onClick={() => handleRegenerateByLevel("harder")}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30"
                >
                  Trop facile
                </button>
                <button
                  onClick={handleAcceptLesson}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-emerald-700"
                >
                  Commencer
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
                <div className="text-slate-200 font-semibold mb-2">Phrases</div>
                <ol className="list-decimal list-inside space-y-1">
                  {lesson.phrases.map((phrase, index) => (
                    <li key={`${phrase}-${index}`}>{phrase}</li>
                  ))}
                </ol>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
                <div className="text-slate-200 font-semibold mb-2">Mots</div>
                <div className="flex flex-wrap gap-2">
                  {lesson.words.map((word, index) => (
                    <span
                      key={`${word}-${index}`}
                      className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-200"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {mode === "practice" && lesson && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-semibold">Pratique guidée</h3>
                <p className="text-xs text-slate-400">
                  Phrase {currentPhraseIndex + 1} / {lesson.phrases.length}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrevPhrase}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30"
                  disabled={currentPhraseIndex === 0}
                >
                  Précédent
                </button>
                <button
                  onClick={handleNextPhrase}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30"
                  disabled={currentPhraseIndex >= lesson.phrases.length - 1}
                >
                  Suivant
                </button>
              </div>
            </div>
            {currentPhraseIndex >= lesson.phrases.length - 1 && (
              <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                Leçon terminée. Tu peux recommencer, générer une nouvelle leçon ou
                retourner au dashboard.
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      setCurrentPhraseIndex(0);
                      setPracticeLog([]);
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
                  >
                    Recommencer la leçon
                  </button>
                  <button
                    onClick={() => {
                      setMode("setup");
                      setLesson(null);
                      setPracticeLog([]);
                      setCurrentPhraseIndex(0);
                    }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-white/30"
                  >
                    Nouvelle leçon
                  </button>
                  <button
                    onClick={() => router.push("/dashboard")}
                    className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-white/30"
                  >
                    Retour dashboard
                  </button>
                </div>
              </div>
            )}

            <details className="mb-5 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <summary className="cursor-pointer text-slate-200 font-semibold">
                Réglages
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-slate-400">Voix alter ego</label>
                  <select
                    value={ttsVoice}
                    onChange={(event) => setTtsVoice(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                  >
                    {["alloy", "echo", "fable", "nova", "onyx", "shimmer"].map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Volume alter ego</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ttsVolume}
                    onChange={(event) => setTtsVolume(Number(event.target.value))}
                    className="mt-2 w-full"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleUnlockTts}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
                >
                  Tester la voix
                </button>
                {!ttsUnlocked && (
                  <span className="text-[11px] text-amber-200">
                    Clique pour autoriser l’audio.
                  </span>
                )}
                {!recorderSupported && (
                  <span className="text-amber-200">
                    Enregistrement non supporté (Safari). Utilise Chrome/Edge.
                  </span>
                )}
              </div>
            </details>

            <div className="mb-5 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <div className="text-slate-200 font-semibold">Traduire une phrase</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  value={translateInput}
                  onChange={(event) => setTranslateInput(event.target.value)}
                  placeholder="Écris une phrase en français..."
                  className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                />
                <button
                  onClick={handleTranslate}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-700"
                  disabled={translateLoading}
                >
                  {translateLoading ? "Traduction..." : "Traduire"}
                </button>
              </div>
              {translateOutput && (
                <div className="mt-2 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{translateOutput}</span>
                    <button
                      onClick={() => playTtsText(translateOutput)}
                      className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-200 transition hover:border-white/30"
                    >
                      Répéter
                    </button>
                  </div>
                  {translatePhonetic && (
                    <div className="mt-2 text-[11px] text-slate-300">
                      Phonétique : {translatePhonetic}
                    </div>
                  )}
                  {translateFrench && (
                    <div className="mt-1 text-[11px] text-slate-300">
                      FR : {translateFrench}
                    </div>
                  )}
                </div>
              )}
              {translateError && (
                <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {translateError}
                </div>
              )}
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs text-slate-400 mb-2">Phrase cible</div>
                <div className="text-lg text-white">
                  {lesson.phrases[currentPhraseIndex]}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
                  <button
                    onClick={() => playTtsText(lesson.phrases[currentPhraseIndex])}
                    className="rounded-md border border-white/10 px-2 py-1 text-slate-200 transition hover:border-white/30"
                  >
                    Écouter
                  </button>
                  <button
                    onPointerDown={startPushToTalk}
                    onPointerUp={stopPushToTalk}
                    onPointerLeave={stopPushToTalk}
                    onPointerCancel={stopPushToTalk}
                    className={`rounded-md px-3 py-2 text-[11px] font-semibold text-white transition ${
                      isRecording ? "bg-emerald-600" : "bg-slate-800 hover:bg-slate-700"
                    }`}
                  >
                    {isRecording ? "Enregistrement..." : "Maintenir pour parler"}
                  </button>
                  <button
                    onClick={() => {
                      const key = `phrase-${currentPhraseIndex}`;
                      setMessageExtras((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], mode: "phonetic" },
                      }));
                      if (!messageExtras[key]?.translation && !messageExtras[key]?.phonetic) {
                        fetchTranslation(key, lesson.phrases[currentPhraseIndex]);
                      }
                    }}
                    className="rounded-md border border-white/10 px-2 py-1 text-slate-200 transition hover:border-white/30"
                  >
                    Phonétique
                  </button>
                  <button
                    onClick={() => {
                      const key = `phrase-${currentPhraseIndex}`;
                      setMessageExtras((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], mode: "fr" },
                      }));
                      if (!messageExtras[key]?.translation && !messageExtras[key]?.phonetic) {
                        fetchTranslation(key, lesson.phrases[currentPhraseIndex]);
                      }
                    }}
                    className="rounded-md border border-white/10 px-2 py-1 text-slate-200 transition hover:border-white/30"
                  >
                    Français
                  </button>
                </div>
                {(() => {
                  const key = `phrase-${currentPhraseIndex}`;
                  const extras = messageExtras[key];
                  if (!extras || extras.mode === "none") return null;
                  return (
                    <div className="mt-3 text-[11px] text-slate-300">
                      {extras.loading && <span>Chargement...</span>}
                      {extras.error && <span>{extras.error}</span>}
                      {!extras.loading && !extras.error && (
                        <>
                          {(extras.mode === "phonetic" || extras.mode === "both") &&
                            extras.phonetic && <div>Phonétique : {extras.phonetic}</div>}
                          {(extras.mode === "fr" || extras.mode === "both") &&
                            extras.translation && <div>FR : {extras.translation}</div>}
                        </>
                      )}
                    </div>
                  );
                })()}
                {transcriptStatus && (
                  <div className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">
                    {transcriptStatus}
                  </div>
                )}
                {isThinking && (
                  <div className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">
                    Feedback en cours…
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-3">
                  <span>Feedback</span>
                  <button
                    onClick={() => setShowFeedback((prev) => !prev)}
                    className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-200 transition hover:border-white/30"
                  >
                    {showFeedback ? "Masquer" : "Afficher"}
                  </button>
                </div>
                <div className="space-y-3 max-h-[45vh] overflow-auto pr-2">
                  {(showFeedback ? practiceLog : practiceLog.slice(-3)).map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-slate-200"
                    >
                      <div className="text-[10px] text-slate-400">{entry.time}</div>
                      <div className="mt-1 text-slate-300">{entry.phrase}</div>
                      <div className="mt-1">Toi: {entry.userText || "—"}</div>
                      <div className="mt-1 text-emerald-200">{entry.feedback}</div>
                    </div>
                  ))}
                  {practiceLog.length === 0 && (
                    <div className="text-xs text-slate-500">
                      Parle pour recevoir un feedback.
                    </div>
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}