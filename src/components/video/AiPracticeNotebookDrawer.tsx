"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Download,
  Loader2,
  Pause,
  Play,
  Repeat2,
  Search,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useUiLocale } from "@/components/ui/UiLocaleProvider";
import { getAuthHeader } from "@/lib/authHeader";
import {
  AI_PRACTICE_NOTEBOOK_UPDATED_EVENT,
  type AiPracticeNotebookEntry,
} from "@/lib/aiPracticeNotebook";
import {
  buildNotebookAudioRequestUrl,
  DEFAULT_NOTEBOOK_VOICE,
  type NotebookPlaybackMode,
} from "@/lib/aiPracticeNotebookAudio";
import {
  NOTEBOOK_PODCAST_MAX_ESTIMATED_SECONDS,
  buildNotebookPodcastDraft,
  formatNotebookPodcastDuration,
  formatNotebookPodcastChargeMinutes,
} from "@/lib/aiPracticeNotebookPodcast";
import {
  deleteAiPracticeNotebookEntry,
  listAiPracticeNotebookEntries,
} from "@/lib/aiPracticeNotebookClient";

const COPY = {
  fr: {
    title: "Carnet AI Practice",
    subtitle: "Retrouve tes phrases, leur phonétique et relis-les quand tu veux.",
    searchPlaceholder: "Rechercher une phrase, une traduction, une phonétique...",
    loading: "Chargement du carnet...",
    empty: "Aucune phrase enregistrée pour le moment.",
    emptyHint: "Ajoute une traduction, une réponse du coach ou une suggestion utile depuis l'exercice.",
    listen: "Ecouter",
    remove: "Supprimer",
    target: "Phrase a memoriser",
    base: "Traduction",
    phonetic: "Phonetique",
    correction: "Correction",
    natural: "Version naturelle",
    familiar: "Version familiere",
    latest: "Recent",
    noAudio: "Lecture vocale BFZoom impossible pour le moment.",
    deleteError: "Suppression impossible pour le moment.",
    loadError: "Chargement impossible pour le moment.",
    listenNotebook: "Ecouter mon carnet",
    pauseNotebook: "Pause",
    resumeNotebook: "Reprendre",
    previousNotebook: "Precedent",
    nextNotebook: "Suivant",
    stopNotebook: "Arreter l'ecoute",
    playlistHint:
      "BFZoom lit toutes les phrases memorisees du carnet en continu, avec leur traduction quand elle existe.",
    playlistProgress: (current: number, total: number) => `Lecture ${current} / ${total}`,
    playlistCurrent: "En lecture",
    playlistEmpty: "Ajoute au moins une phrase au carnet pour lancer l'ecoute continue.",
    playbackMode: "Mode",
    modeTargetOnly: "Phrase seule",
    modeTargetBase: "Phrase + traduction",
    modeRepeat: "Repetition",
    loopNotebook: "Boucle",
    podcastTitle: "Podcast hors ligne",
    podcastHint:
      "Telecharge un fichier audio unique de ton carnet pour l'ecouter hors ligne sur ton appareil, jusqu'a environ 3 minutes.",
    podcastGenerate: (charge: string) => `Telecharger mon podcast (${charge})`,
    podcastGenerating: "Generation du podcast...",
    podcastDownloadAgain: "Telecharger a nouveau",
    podcastBillingHint:
      "Le telechargement n'est debite que lorsque BFZoom doit generer une nouvelle version du podcast.",
    podcastReadyHint:
      "Cette version est deja generee. Tu peux la retelecharger sans nouveau debit.",
    podcastEmpty: "Ajoute au moins une phrase au carnet pour generer ton podcast.",
    podcastTooLong:
      "Ton carnet depasse la duree maximale du podcast (environ 3 minutes). Supprime quelques notes puis reessaie.",
    podcastTooLongCta: "Podcast trop long",
    podcastTrimHint: (overrun: string) =>
      `Depassement estime: +${overrun}. Supprime quelques phrases du carnet pour revenir sous 3 minutes.`,
    podcastError: "Generation du podcast impossible pour le moment.",
    podcastStats: (count: number, estimated: string, max: string) =>
      `${count} phrase${count > 1 ? "s" : ""} · duree estimee ${estimated} / ${max}`,
  },
  en: {
    title: "AI Practice Notebook",
    subtitle: "Find your saved phrases, phonetics, and replay them anytime.",
    searchPlaceholder: "Search a phrase, translation, phonetic...",
    loading: "Loading notebook...",
    empty: "No saved phrase yet.",
    emptyHint: "Save a translation, a coach reply, or a useful suggestion from the exercise.",
    listen: "Listen",
    remove: "Delete",
    target: "Phrase to memorize",
    base: "Translation",
    phonetic: "Phonetic",
    correction: "Correction",
    natural: "Natural version",
    familiar: "Casual version",
    latest: "Recent",
    noAudio: "BFZoom voice playback is unavailable right now.",
    deleteError: "Unable to delete this note right now.",
    loadError: "Unable to load notebook right now.",
    listenNotebook: "Listen to my notebook",
    pauseNotebook: "Pause",
    resumeNotebook: "Resume",
    previousNotebook: "Previous",
    nextNotebook: "Next",
    stopNotebook: "Stop playback",
    playlistHint:
      "BFZoom plays every memorized notebook phrase continuously, including its translation when available.",
    playlistProgress: (current: number, total: number) => `Playing ${current} / ${total}`,
    playlistCurrent: "Now playing",
    playlistEmpty: "Add at least one saved phrase before starting continuous playback.",
    playbackMode: "Mode",
    modeTargetOnly: "Phrase only",
    modeTargetBase: "Phrase + translation",
    modeRepeat: "Repeat",
    loopNotebook: "Loop",
    podcastTitle: "Offline podcast",
    podcastHint:
      "Download a single audio file of your notebook to listen offline on your device, up to about 3 minutes.",
    podcastGenerate: (charge: string) => `Download my podcast (${charge})`,
    podcastGenerating: "Generating podcast...",
    podcastDownloadAgain: "Download again",
    podcastBillingHint:
      "The download is only billed when BFZoom has to generate a new podcast version.",
    podcastReadyHint:
      "This version is already generated. You can download it again without another charge.",
    podcastEmpty: "Add at least one saved phrase before generating your podcast.",
    podcastTooLong:
      "Your notebook is longer than the maximum podcast duration (about 3 minutes). Remove a few notes and try again.",
    podcastTooLongCta: "Podcast too long",
    podcastTrimHint: (overrun: string) =>
      `Estimated overrun: +${overrun}. Remove a few notebook phrases to get back under 3 minutes.`,
    podcastError: "Unable to generate the podcast right now.",
    podcastStats: (count: number, estimated: string, max: string) =>
      `${count} phrase${count > 1 ? "s" : ""} · estimated duration ${estimated} / ${max}`,
  },
} as const;

const NOTEBOOK_TTS_CACHE_NAME = "bfzoom-ai-practice-tts-v1";
const PODCAST_CHARGE_LABEL = formatNotebookPodcastChargeMinutes();

const kindLabel = (entry: AiPracticeNotebookEntry, locale: "fr" | "en") => {
  const isFr = locale === "fr";
  switch (entry.kind) {
    case "coach_reply":
      return isFr ? "Reponse coach" : "Coach reply";
    case "coach_suggestion":
      return isFr ? "Suggestion coach" : "Coach suggestion";
    case "draft_review":
      return isFr ? "Correction avant envoi" : "Pre-send correction";
    default:
      return isFr ? "Ta traduction" : "Your translation";
  }
};

const formatNotebookDate = (value: string, locale: "fr" | "en") => {
  try {
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const getBaseLabel = (entry: AiPracticeNotebookEntry, locale: "fr" | "en") => {
  const base = COPY[locale].base;
  const languageName = entry.baseLanguageName.trim();
  if (!languageName) return base;
  return `${base} (${languageName})`;
};

const buildNotebookQueue = (entries: AiPracticeNotebookEntry[]) =>
  [...entries].sort((left, right) => left.createdAtMs - right.createdAtMs);

type NotebookPodcastStatus = {
  ready: boolean;
  eligible: boolean;
  reason: "empty" | "too_long" | null;
  podcastHash: string | null;
  downloadUrl: string | null;
  filename: string | null;
};

const DEFAULT_PODCAST_STATUS: NotebookPodcastStatus = {
  ready: false,
  eligible: false,
  reason: "empty",
  podcastHash: null,
  downloadUrl: null,
  filename: null,
};

export default function AiPracticeNotebookDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<AiPracticeNotebookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [playlistActive, setPlaylistActive] = useState(false);
  const [playlistPaused, setPlaylistPaused] = useState(false);
  const [playlistCurrentIndex, setPlaylistCurrentIndex] = useState(0);
  const [playlistPosition, setPlaylistPosition] = useState(0);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const [playbackMode, setPlaybackMode] = useState<NotebookPlaybackMode>("repeat");
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [podcastStatus, setPodcastStatus] = useState<NotebookPodcastStatus>(DEFAULT_PODCAST_STATUS);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastSubmitting, setPodcastSubmitting] = useState(false);
  const [podcastError, setPodcastError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const playlistRunRef = useRef(0);
  const playlistQueueRef = useRef<AiPracticeNotebookEntry[]>([]);
  const playlistSeenIdsRef = useRef<Set<string>>(new Set());
  const playlistCurrentIndexRef = useRef(0);
  const playlistPausedRef = useRef(false);
  const playbackModeRef = useRef<NotebookPlaybackMode>("repeat");
  const loopEnabledRef = useRef(false);
  const entryRefs = useRef(new Map<string, HTMLElement>());
  const audioBlobCacheRef = useRef(new Map<string, Blob>());
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const nextEntries = await listAiPracticeNotebookEntries();
      setEntries(nextEntries);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.loadError]);

  useEffect(() => {
    if (!open) return;
    void loadEntries();
  }, [loadEntries, open]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdated = () => {
      if (!open) return;
      void loadEntries();
    };
    window.addEventListener(AI_PRACTICE_NOTEBOOK_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(AI_PRACTICE_NOTEBOOK_UPDATED_EVENT, handleUpdated);
  }, [loadEntries, open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  const stopPlayback = useCallback(() => {
    playlistRunRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
      audio.src = "";
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setPlayingId("");
    setPlaylistActive(false);
    setPlaylistPaused(false);
    setPlaylistCurrentIndex(0);
    setPlaylistPosition(0);
    setPlaylistTotal(0);
    playlistQueueRef.current = [];
    playlistSeenIdsRef.current = new Set();
  }, []);

  useEffect(() => {
    if (open) return;
    stopPlayback();
  }, [open, stopPlayback]);

  useEffect(() => stopPlayback, [stopPlayback]);

  useEffect(() => {
    playlistCurrentIndexRef.current = playlistCurrentIndex;
  }, [playlistCurrentIndex]);

  useEffect(() => {
    playlistPausedRef.current = playlistPaused;
  }, [playlistPaused]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  useEffect(() => {
    loopEnabledRef.current = loopEnabled;
  }, [loopEnabled]);

  useEffect(() => {
    if (!playlistActive) return;
    const currentSeen = playlistSeenIdsRef.current;
    const additions = buildNotebookQueue(entries).filter((entry) => !currentSeen.has(entry.id));
    if (additions.length === 0) return;
    for (const entry of additions) {
      currentSeen.add(entry.id);
      playlistQueueRef.current.push(entry);
    }
    setPlaylistTotal(playlistQueueRef.current.length);
  }, [entries, playlistActive]);

  useEffect(() => {
    if (!playlistActive || !playingId) return;
    const target = entryRefs.current.get(playingId);
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playingId, playlistActive]);

  const filteredEntries = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [
        entry.targetText,
        entry.baseText,
        entry.phoneticText,
        entry.correctedText,
        entry.naturalText,
        entry.familiarText,
        entry.contextLabel,
      ]
        .join("\n")
        .toLowerCase()
        .includes(needle)
    );
  }, [deferredSearch, entries]);

  const podcastDraft = useMemo(
    () =>
      buildNotebookPodcastDraft({
        entries,
        mode: playbackMode,
        voice: DEFAULT_NOTEBOOK_VOICE,
      }),
    [entries, playbackMode]
  );
  const podcastTooLong =
    podcastDraft.entryCount > 0 && podcastDraft.estimatedSeconds > NOTEBOOK_PODCAST_MAX_ESTIMATED_SECONDS;
  const podcastOverrunLabel = formatNotebookPodcastDuration(
    Math.max(0, podcastDraft.estimatedSeconds - NOTEBOOK_PODCAST_MAX_ESTIMATED_SECONDS)
  );

  const readCachedAudioBlob = useCallback(async (memoryKey: string, requestUrl: string) => {
    const inMemory = audioBlobCacheRef.current.get(memoryKey);
    if (inMemory) return inMemory;
    if (typeof window === "undefined" || typeof window.caches === "undefined") {
      return null;
    }
    try {
      const cache = await window.caches.open(NOTEBOOK_TTS_CACHE_NAME);
      const response = await cache.match(requestUrl);
      if (!response) return null;
      const blob = await response.blob();
      if (!blob.size) return null;
      audioBlobCacheRef.current.set(memoryKey, blob);
      return blob;
    } catch {
      return null;
    }
  }, []);

  const persistCachedAudioBlob = useCallback(
    async (memoryKey: string, requestUrl: string, blob: Blob) => {
      if (!blob.size) return;
      audioBlobCacheRef.current.set(memoryKey, blob);
      if (typeof window === "undefined" || typeof window.caches === "undefined") {
        return;
      }
      try {
        const cache = await window.caches.open(NOTEBOOK_TTS_CACHE_NAME);
        await cache.put(
          requestUrl,
          new Response(blob, {
            headers: {
              "Content-Type": blob.type || "audio/mpeg",
              "Cache-Control": "max-age=31536000, immutable",
            },
          })
        );
      } catch {
        // Keep the in-memory copy even if durable browser caching fails.
      }
    },
    []
  );

  const playNotebookAudio = useCallback(
    async ({
      id,
      entryId,
      mode,
      voice,
      onEnded,
    }: {
      id: string;
      entryId: string;
      mode: NotebookPlaybackMode;
      voice?: string;
      onEnded?: () => void;
    }) => {
      if (typeof window === "undefined") {
        setError(t.noAudio);
        return;
      }

      const resolvedVoice = voice || DEFAULT_NOTEBOOK_VOICE;
      const requestUrl = buildNotebookAudioRequestUrl({
        entryId,
        mode,
        voice: resolvedVoice,
      });
      const memoryKey = requestUrl;

      const previousAudio = audioRef.current;
      if (previousAudio) {
        previousAudio.pause();
        previousAudio.currentTime = 0;
        previousAudio.onended = null;
        previousAudio.onerror = null;
        previousAudio.src = "";
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = "";
      }

      setPlayingId(id);
      setError("");

      try {
        const attachBlobToAudio = async (blob: Blob) => {
          const audioUrl = URL.createObjectURL(blob);
          audioUrlRef.current = audioUrl;
          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          audio.preload = "auto";
          audio.autoplay = false;
          audio.muted = false;
          audio.volume = 1;
          audio.setAttribute("playsinline", "true");
          audio.setAttribute("webkit-playsinline", "true");
          audio.src = audioUrl;
          audio.currentTime = 0;
          audio.onended = () => {
            if (audioUrlRef.current === audioUrl) {
              URL.revokeObjectURL(audioUrl);
              audioUrlRef.current = "";
            }
            onEnded?.();
          };
          audio.onerror = () => {
            if (audioUrlRef.current === audioUrl) {
              URL.revokeObjectURL(audioUrl);
              audioUrlRef.current = "";
            }
            stopPlayback();
            setError(t.noAudio);
          };
          await audio.play();
        };

        const cachedBlob = await readCachedAudioBlob(memoryKey, requestUrl);
        if (cachedBlob) {
          await attachBlobToAudio(cachedBlob);
          return;
        }

        const response = await fetch(requestUrl, {
          method: "GET",
          headers: {
            ...(await getAuthHeader()),
          },
          credentials: "same-origin",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(String(payload.error || t.noAudio));
        }

        const blob = await response.blob();
        await persistCachedAudioBlob(memoryKey, requestUrl, blob);
        await attachBlobToAudio(blob);
      } catch (err) {
        stopPlayback();
        setError(err instanceof Error ? err.message : t.noAudio);
      }
    },
    [persistCachedAudioBlob, readCachedAudioBlob, stopPlayback, t.noAudio]
  );

  const playEntry = useCallback(
    async (entry: AiPracticeNotebookEntry) => {
      stopPlayback();
      await playNotebookAudio({
        id: entry.id,
        entryId: entry.id,
        mode: "target_only",
        voice: entry.voice || DEFAULT_NOTEBOOK_VOICE,
        onEnded: () => {
          setPlayingId("");
        },
      });
    },
    [playNotebookAudio, stopPlayback]
  );

  const playPlaylistFromIndex = useCallback(
    async (requestedIndex: number, sourceQueue?: AiPracticeNotebookEntry[]) => {
      const queue =
        sourceQueue ?? playlistQueueRef.current.filter((entry) => Boolean(entry.targetText.trim()));
      if (queue.length === 0) {
        setError(t.playlistEmpty);
        stopPlayback();
        return;
      }

      let nextIndex = requestedIndex;
      if (nextIndex < 0) {
        nextIndex = loopEnabledRef.current ? queue.length - 1 : 0;
      }
      if (nextIndex >= queue.length) {
        if (loopEnabledRef.current) {
          nextIndex = 0;
        } else {
          stopPlayback();
          return;
        }
      }

      const currentEntry = queue[nextIndex];
      if (!currentEntry) {
        stopPlayback();
        return;
      }

      playlistRunRef.current += 1;
      const runId = playlistRunRef.current;
      if (sourceQueue) {
        playlistQueueRef.current = queue;
        playlistSeenIdsRef.current = new Set(queue.map((entry) => entry.id));
      }
      setPlaylistActive(true);
      setPlaylistPaused(false);
      setPlaylistCurrentIndex(nextIndex);
      setPlaylistPosition(nextIndex + 1);
      setPlaylistTotal(queue.length);
      await playNotebookAudio({
        id: currentEntry.id,
        entryId: currentEntry.id,
        mode: playbackModeRef.current,
        voice: currentEntry.voice || DEFAULT_NOTEBOOK_VOICE,
        onEnded: () => {
          if (playlistRunRef.current !== runId) return;
          if (playlistPausedRef.current) return;
          void playPlaylistFromIndex(nextIndex + 1);
        },
      });
    },
    [playNotebookAudio, stopPlayback, t.playlistEmpty]
  );

  const playNotebook = useCallback(async () => {
    const queue = buildNotebookQueue(entries).filter((entry) => Boolean(entry.targetText.trim()));
    if (queue.length === 0) {
      setError(t.playlistEmpty);
      return;
    }
    stopPlayback();
    await playPlaylistFromIndex(0, queue);
  }, [entries, playPlaylistFromIndex, stopPlayback, t.playlistEmpty]);

  useEffect(() => {
    if (!open || loading) return;
    setPodcastError("");

    if (!podcastDraft.entryCount) {
      setPodcastStatus({
        ...DEFAULT_PODCAST_STATUS,
        reason: "empty",
      });
      return;
    }

    if (!podcastDraft.eligible) {
      setPodcastStatus({
        ready: false,
        eligible: false,
        reason: "too_long",
        podcastHash: podcastDraft.podcastHash,
        downloadUrl: null,
        filename: null,
      });
      return;
    }

    let cancelled = false;
    setPodcastLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/ai-practice/notebook/podcast?mode=${encodeURIComponent(playbackMode)}&voice=${encodeURIComponent(DEFAULT_NOTEBOOK_VOICE)}`,
          {
            method: "GET",
            headers: {
              ...(await getAuthHeader()),
            },
            credentials: "same-origin",
          }
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          ready?: boolean;
          eligible?: boolean;
          reason?: "empty" | "too_long" | null;
          podcastHash?: string | null;
          downloadUrl?: string | null;
          filename?: string | null;
        };
        if (!response.ok) {
          throw new Error(String(payload.error || t.podcastError));
        }
        if (cancelled) return;
        setPodcastStatus({
          ready: Boolean(payload.ready),
          eligible: payload.eligible !== false,
          reason:
            payload.reason === "too_long" || payload.reason === "empty"
              ? payload.reason
              : null,
          podcastHash: payload.podcastHash || null,
          downloadUrl: payload.downloadUrl || null,
          filename: payload.filename || null,
        });
      } catch (err) {
        if (cancelled) return;
        setPodcastStatus({
          ready: false,
          eligible: true,
          reason: null,
          podcastHash: podcastDraft.podcastHash,
          downloadUrl: null,
          filename: null,
        });
        setPodcastError(err instanceof Error ? err.message : t.podcastError);
      } finally {
        if (!cancelled) {
          setPodcastLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, open, playbackMode, podcastDraft.eligible, podcastDraft.entryCount, podcastDraft.podcastHash, t.podcastError]);

  const downloadPodcastAsset = useCallback(
    async ({ downloadUrl, filename }: { downloadUrl: string; filename: string }) => {
      const response = await fetch(downloadUrl, {
        method: "GET",
        headers: {
          ...(await getAuthHeader()),
        },
        credentials: "same-origin",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(String(payload.error || t.podcastError));
      }

      const blob = await response.blob();
      if (!blob.size) {
        throw new Error(t.podcastError);
      }

      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    },
    [t.podcastError]
  );

  const handlePodcastDownload = useCallback(async () => {
    setPodcastError("");

    if (!podcastDraft.entryCount) {
      setPodcastError(t.podcastEmpty);
      return;
    }

    if (!podcastDraft.eligible) {
      setPodcastError(t.podcastTooLong);
      return;
    }

    setPodcastSubmitting(true);
    try {
      if (podcastStatus.ready && podcastStatus.downloadUrl && podcastStatus.filename) {
        await downloadPodcastAsset({
          downloadUrl: podcastStatus.downloadUrl,
          filename: podcastStatus.filename,
        });
        return;
      }

      const response = await fetch("/api/ai-practice/notebook/podcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getAuthHeader()),
        },
        credentials: "same-origin",
        body: JSON.stringify({
          mode: playbackMode,
          voice: DEFAULT_NOTEBOOK_VOICE,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        ready?: boolean;
        eligible?: boolean;
        reason?: "empty" | "too_long" | null;
        podcastHash?: string | null;
        downloadUrl?: string | null;
        filename?: string | null;
      };
      if (!response.ok) {
        throw new Error(String(payload.error || t.podcastError));
      }

      const nextStatus: NotebookPodcastStatus = {
        ready: Boolean(payload.ready),
        eligible: payload.eligible !== false,
        reason:
          payload.reason === "too_long" || payload.reason === "empty"
            ? payload.reason
            : null,
        podcastHash: payload.podcastHash || null,
        downloadUrl: payload.downloadUrl || null,
        filename: payload.filename || null,
      };
      setPodcastStatus(nextStatus);

      if (nextStatus.ready && nextStatus.downloadUrl && nextStatus.filename) {
        await downloadPodcastAsset({
          downloadUrl: nextStatus.downloadUrl,
          filename: nextStatus.filename,
        });
        return;
      }

      throw new Error(t.podcastError);
    } catch (err) {
      setPodcastError(err instanceof Error ? err.message : t.podcastError);
    } finally {
      setPodcastSubmitting(false);
    }
  }, [
    downloadPodcastAsset,
    playbackMode,
    podcastDraft.eligible,
    podcastDraft.entryCount,
    podcastStatus.downloadUrl,
    podcastStatus.filename,
    podcastStatus.ready,
    t.podcastEmpty,
    t.podcastError,
    t.podcastTooLong,
  ]);

  const pauseNotebook = useCallback(() => {
    if (!playlistActive) return;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    setPlaylistPaused(true);
  }, [playlistActive]);

  const resumeNotebook = useCallback(() => {
    if (!playlistActive) return;
    const audio = audioRef.current;
    setPlaylistPaused(false);
    if (audio && audio.src && audio.paused && !audio.ended) {
      void audio.play().catch(() => {
        setError(t.noAudio);
      });
      return;
    }
    void playPlaylistFromIndex(playlistCurrentIndexRef.current);
  }, [playPlaylistFromIndex, playlistActive, t.noAudio]);

  const goToPreviousEntry = useCallback(() => {
    if (!playlistActive) return;
    void playPlaylistFromIndex(playlistCurrentIndexRef.current - 1);
  }, [playPlaylistFromIndex, playlistActive]);

  const goToNextEntry = useCallback(() => {
    if (!playlistActive) return;
    void playPlaylistFromIndex(playlistCurrentIndexRef.current + 1);
  }, [playPlaylistFromIndex, playlistActive]);

  const deleteEntry = useCallback(
    async (entryId: string) => {
      setDeletingId(entryId);
      try {
        const entry = entries.find((item) => item.id === entryId);
        await deleteAiPracticeNotebookEntry(entryId, entry?.fingerprint);
        setEntries((current) => current.filter((entry) => entry.id !== entryId));
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : t.deleteError);
      } finally {
        setDeletingId("");
      }
    },
    [entries, t.deleteError]
  );

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="chat-scroll fixed inset-0 isolate h-[100dvh] overflow-y-auto bg-[#ede6d8] text-slate-900"
      style={{
        zIndex: 10000,
        WebkitOverflowScrolling: "touch",
        overscrollBehaviorY: "contain",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-practice-notebook-title"
        className="relative flex min-h-[100dvh] w-full flex-col bg-[linear-gradient(180deg,#f8f4ec_0%,#efe7da_100%)]"
      >
        <div className="border-b border-slate-200 bg-[#f8f4ec]">
          <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-sky-700" />
                <h2
                  id="ai-practice-notebook-title"
                  className="text-base font-semibold text-slate-900 sm:text-lg"
                >
                  {t.title}
                </h2>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-200 bg-[#f8f4ec]">
          <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
            <label className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 shadow-sm">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t.searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500"
              />
            </label>
            <div className="mt-3 rounded-3xl border border-sky-200 bg-sky-50 px-4 py-4 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{t.listenNotebook}</p>
                  <p className="mt-1 text-sm text-slate-600">{t.playlistHint}</p>
                  {playlistActive && playlistTotal > 0 ? (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                      {t.playlistProgress(playlistPosition, playlistTotal)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={goToPreviousEntry}
                      disabled={!playlistActive}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <SkipBack className="h-4 w-4" />
                      {t.previousNotebook}
                    </button>
                    {playlistActive ? (
                      <button
                        type="button"
                        onClick={playlistPaused ? resumeNotebook : pauseNotebook}
                        className="inline-flex items-center gap-2 rounded-full border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
                      >
                        {playlistPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        {playlistPaused ? t.resumeNotebook : t.pauseNotebook}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void playNotebook()}
                        disabled={loading || entries.length === 0}
                        className="inline-flex items-center gap-2 rounded-full border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Play className="h-4 w-4" />
                        {t.listenNotebook}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={goToNextEntry}
                      disabled={!playlistActive}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t.nextNotebook}
                      <SkipForward className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={stopPlayback}
                      disabled={!playlistActive}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Square className="h-4 w-4" />
                      {t.stopNotebook}
                    </button>
                  </div>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {t.playbackMode}
                      </span>
                      {([
                        ["target_only", t.modeTargetOnly],
                        ["target_base", t.modeTargetBase],
                        ["repeat", t.modeRepeat],
                      ] as const).map(([mode, label]) => {
                        const active = playbackMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => {
                              playbackModeRef.current = mode;
                              setPlaybackMode(mode);
                              if (playlistActive) {
                                void playPlaylistFromIndex(playlistCurrentIndexRef.current);
                              }
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              active
                                ? "border-sky-700 bg-sky-700 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setLoopEnabled((current) => {
                          const next = !current;
                          loopEnabledRef.current = next;
                          return next;
                        })
                      }
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        loopEnabled
                          ? "border-sky-700 bg-sky-100 text-sky-800"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <Repeat2 className="h-3.5 w-3.5" />
                      {t.loopNotebook}
                    </button>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{t.podcastTitle}</p>
                        <p className="mt-1 text-sm text-slate-600">{t.podcastHint}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {podcastStatus.ready
                            ? t.podcastReadyHint
                            : podcastDraft.entryCount === 0
                            ? t.podcastEmpty
                            : podcastTooLong
                            ? t.podcastTooLong
                            : t.podcastBillingHint}
                        </p>
                        {podcastTooLong ? (
                          <p className="mt-2 text-xs font-medium text-amber-800">
                            {t.podcastTrimHint(podcastOverrunLabel)}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handlePodcastDownload()}
                        disabled={
                          podcastSubmitting ||
                          podcastLoading ||
                          podcastDraft.entryCount === 0 ||
                          !podcastDraft.eligible
                        }
                        className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                          podcastTooLong
                            ? "border-slate-300 bg-slate-200 text-slate-600"
                            : "border-amber-500 bg-amber-500 text-slate-950 hover:bg-amber-400"
                        }`}
                      >
                        {podcastSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t.podcastGenerating}
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            {podcastTooLong
                              ? t.podcastTooLongCta
                              : podcastStatus.ready
                              ? t.podcastDownloadAgain
                              : t.podcastGenerate(PODCAST_CHARGE_LABEL)}
                          </>
                        )}
                      </button>
                    </div>
                    {podcastDraft.entryCount > 0 ? (
                      <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        {t.podcastStats(
                          podcastDraft.entryCount,
                          formatNotebookPodcastDuration(podcastDraft.estimatedSeconds),
                          formatNotebookPodcastDuration(NOTEBOOK_PODCAST_MAX_ESTIMATED_SECONDS)
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
            {podcastError && <p className="mt-2 text-xs text-rose-700">{podcastError}</p>}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
            {loading ? (
              <p className="text-sm text-slate-600">{t.loading}</p>
            ) : filteredEntries.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-6 text-sm text-slate-600 shadow-sm">
                <p className="font-semibold text-slate-900">{t.empty}</p>
                <p className="mt-1 text-sm text-slate-500">{t.emptyHint}</p>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredEntries.map((entry, index) => (
                  <article
                    key={entry.id}
                    ref={(node) => {
                      if (node) {
                        entryRefs.current.set(entry.id, node);
                      } else {
                        entryRefs.current.delete(entry.id);
                      }
                    }}
                    className={`rounded-3xl border bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition sm:p-5 ${
                      playlistActive && playingId === entry.id
                        ? "border-sky-400 ring-2 ring-sky-200"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                        {kindLabel(entry, locale)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {entry.mode}
                      </span>
                      {index === 0 && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          {t.latest}
                        </span>
                      )}
                      {playlistActive && playingId === entry.id ? (
                        <span className="rounded-full border border-sky-300 bg-sky-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                          {t.playlistCurrent}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t.target}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                      {entry.targetText}
                    </p>

                    {entry.baseText && (
                      <>
                        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {getBaseLabel(entry, locale)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                          {entry.baseText}
                        </p>
                      </>
                    )}

                    {entry.phoneticText && (
                      <>
                        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                          {t.phonetic}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-violet-950">
                          {entry.phoneticText}
                        </p>
                      </>
                    )}

                    {entry.correctedText && (
                      <>
                        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {t.correction}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                          {entry.correctedText}
                        </p>
                      </>
                    )}

                    {entry.naturalText && (
                      <>
                        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {t.natural}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                          {entry.naturalText}
                        </p>
                      </>
                    )}

                    {entry.familiarText && (
                      <>
                        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {t.familiar}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                          {entry.familiarText}
                        </p>
                      </>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>{formatNotebookDate(entry.createdAtIso, locale)}</span>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void playEntry(entry)}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        {playingId === entry.id ? `${t.listen}...` : t.listen}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteEntry(entry.id)}
                        disabled={deletingId === entry.id}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === entry.id ? `${t.remove}...` : t.remove}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
