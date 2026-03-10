"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, Play, RefreshCw, Share2, Trash2 } from "lucide-react";
import {
  clearTranslationNotebookEntries,
  getTranslationNotebookEntries,
  TRANSLATION_NOTEBOOK_STORAGE_KEY,
  updateTranslationNotebookEntryStatus,
  type TranslationNotebookEntry,
  type TranslationNotebookStatus,
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

const NOTEBOOK_PHONETIC_CACHE_KEY = "bfzoom:translation-notebook-phonetic:v1";

const normalizeForCompare = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const createPhoneticCacheKey = (entry: TranslationNotebookEntry) =>
  `${(entry.targetLanguageCode || "").trim().toLowerCase()}::${normalizeForCompare(
    entry.translatedText || ""
  )}`;

const readPhoneticCache = () => {
  if (typeof window === "undefined") return {} as Record<string, string>;
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_PHONETIC_CACHE_KEY);
    if (!raw) return {} as Record<string, string>;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {} as Record<string, string>;
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (typeof value === "string") acc[key] = value;
        return acc;
      },
      {}
    );
  } catch {
    return {} as Record<string, string>;
  }
};

const writePhoneticCache = (cache: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTEBOOK_PHONETIC_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore private mode / quota errors.
  }
};

const NOTEBOOK_PDF_PAGE = { widthPt: 595.28, heightPt: 841.89 };
const NOTEBOOK_PDF_SCALE = 2;

const textEncoder = new TextEncoder();

const encodeText = (value: string) => textEncoder.encode(value);

const concatUint8 = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const buildPdfStreamObject = (dictionary: string, streamBytes: Uint8Array) =>
  concatUint8([
    encodeText(`${dictionary}\nstream\n`),
    streamBytes,
    encodeText("\nendstream"),
  ]);

type NotebookRenderedPage = {
  imageBytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
};

const wrapTextToLines = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) => {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const lines: string[] = [];
  let currentLine = "";
  for (const char of normalized) {
    const nextLine = `${currentLine}${char}`;
    if (!currentLine || context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      continue;
    }
    lines.push(currentLine);
    currentLine = char;
  }
  if (currentLine) lines.push(currentLine);
  return lines;
};

const canvasToJpegBytes = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  if (!blob) throw new Error("pdf_canvas_export_failed");
  return new Uint8Array(await blob.arrayBuffer());
};

const renderNotebookPages = async (
  entries: TranslationNotebookEntry[],
  phoneticByEntryId: Record<string, string>
): Promise<NotebookRenderedPage[]> => {
  const canvasWidth = Math.round(NOTEBOOK_PDF_PAGE.widthPt * NOTEBOOK_PDF_SCALE);
  const canvasHeight = Math.round(NOTEBOOK_PDF_PAGE.heightPt * NOTEBOOK_PDF_SCALE);
  const marginX = 44 * NOTEBOOK_PDF_SCALE;
  const marginTop = 40 * NOTEBOOK_PDF_SCALE;
  const marginBottom = 40 * NOTEBOOK_PDF_SCALE;
  const maxTextWidth = canvasWidth - marginX * 2;
  const pageDate = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const pageCanvases: HTMLCanvasElement[] = [];
  let canvas = document.createElement("canvas");
  const initialContext = canvas.getContext("2d");
  if (!initialContext) throw new Error("pdf_context_unavailable");
  let context: CanvasRenderingContext2D = initialContext;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  let y = marginTop;

  const startPage = () => {
    canvas = document.createElement("canvas");
    const nextContext = canvas.getContext("2d");
    if (!nextContext) throw new Error("pdf_context_unavailable");
    context = nextContext;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    y = marginTop;

    context.fillStyle = "#0f172a";
    context.font = `bold ${20 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.fillText("BFZoom - Bloc-notes traduction", marginX, y);
    y += 28 * NOTEBOOK_PDF_SCALE;

    context.fillStyle = "#475569";
    context.font = `${12 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.fillText(`Export: ${pageDate}`, marginX, y);
    y += 24 * NOTEBOOK_PDF_SCALE;

    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 1 * NOTEBOOK_PDF_SCALE;
    context.beginPath();
    context.moveTo(marginX, y);
    context.lineTo(canvasWidth - marginX, y);
    context.stroke();
    y += 18 * NOTEBOOK_PDF_SCALE;
  };

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight <= canvasHeight - marginBottom) return;
    pageCanvases.push(canvas);
    startPage();
  };

  const drawLine = (text: string, options: { font: string; color: string; gapAfter?: number }) => {
    ensureSpace(22 * NOTEBOOK_PDF_SCALE);
    context.font = options.font;
    context.fillStyle = options.color;
    context.fillText(text, marginX, y);
    y += 18 * NOTEBOOK_PDF_SCALE + (options.gapAfter || 0);
  };

  const drawWrappedBlock = (
    text: string,
    options: { font: string; color: string; lineGap?: number; afterGap?: number }
  ) => {
    context.font = options.font;
    const lines = wrapTextToLines(context, text, maxTextWidth);
    for (const line of lines) {
      ensureSpace(22 * NOTEBOOK_PDF_SCALE);
      context.fillStyle = options.color;
      context.fillText(line, marginX, y);
      y += 18 * NOTEBOOK_PDF_SCALE + (options.lineGap || 0);
    }
    y += options.afterGap || 0;
  };

  startPage();

  entries.forEach((entry, index) => {
    const phonetic = (phoneticByEntryId[entry.id] || "").trim();
    const directionLabel = entry.direction === "outgoing" ? "Envoye" : "Recu";

    drawLine(`${index + 1}. ${formatEntryTime(entry.createdAt)} - ${directionLabel}`, {
      font: `bold ${12 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      color: "#0f172a",
      gapAfter: 2 * NOTEBOOK_PDF_SCALE,
    });

    drawWrappedBlock(
      `${entry.sourceLanguageName || "Source"} (${entry.sourceLanguageCode || "--"}) -> ${
        entry.targetLanguageName || "Cible"
      } (${entry.targetLanguageCode || "--"})`,
      {
        font: `${11 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
        color: "#334155",
        lineGap: 0,
        afterGap: 6 * NOTEBOOK_PDF_SCALE,
      }
    );

    drawLine("SOURCE", {
      font: `bold ${10 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      color: "#1e293b",
      gapAfter: 2 * NOTEBOOK_PDF_SCALE,
    });
    drawWrappedBlock(entry.sourceText || "-", {
      font: `${12 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      color: "#0f172a",
      lineGap: 0,
      afterGap: 6 * NOTEBOOK_PDF_SCALE,
    });

    drawLine("TRADUCTION", {
      font: `bold ${10 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      color: "#0f3b6d",
      gapAfter: 2 * NOTEBOOK_PDF_SCALE,
    });
    drawWrappedBlock(entry.translatedText || "-", {
      font: `${12 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      color: "#0c4a6e",
      lineGap: 0,
      afterGap: 6 * NOTEBOOK_PDF_SCALE,
    });

    if (phonetic) {
      drawLine("PHONETIQUE", {
        font: `bold ${10 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
        color: "#5b21b6",
        gapAfter: 2 * NOTEBOOK_PDF_SCALE,
      });
      drawWrappedBlock(phonetic, {
        font: `${11 * NOTEBOOK_PDF_SCALE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
        color: "#6d28d9",
        lineGap: 0,
        afterGap: 8 * NOTEBOOK_PDF_SCALE,
      });
    }

    ensureSpace(12 * NOTEBOOK_PDF_SCALE);
    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 1 * NOTEBOOK_PDF_SCALE;
    context.beginPath();
    context.moveTo(marginX, y);
    context.lineTo(canvasWidth - marginX, y);
    context.stroke();
    y += 16 * NOTEBOOK_PDF_SCALE;
  });

  pageCanvases.push(canvas);

  const renderedPages: NotebookRenderedPage[] = [];
  for (const pageCanvas of pageCanvases) {
    const imageBytes = await canvasToJpegBytes(pageCanvas);
    renderedPages.push({
      imageBytes,
      pixelWidth: pageCanvas.width,
      pixelHeight: pageCanvas.height,
    });
  }
  return renderedPages;
};

const buildNotebookPdfBlob = async (
  entries: TranslationNotebookEntry[],
  phoneticByEntryId: Record<string, string>
) => {
  const pages = await renderNotebookPages(entries, phoneticByEntryId);
  const catalogId = 1;
  const pagesRootId = 2;

  let objectId = 3;
  const pageIds: number[] = [];
  const imageIds: number[] = [];
  const contentIds: number[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    pageIds.push(objectId++);
    imageIds.push(objectId++);
    contentIds.push(objectId++);
  }

  const objects: Array<{ id: number; bytes: Uint8Array }> = [];
  objects.push({
    id: catalogId,
    bytes: encodeText(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`),
  });
  objects.push({
    id: pagesRootId,
    bytes: encodeText(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] >>`
    ),
  });

  for (let i = 0; i < pages.length; i += 1) {
    const pageId = pageIds[i];
    const imageId = imageIds[i];
    const contentId = contentIds[i];
    const imageAlias = `Im${i + 1}`;
    const contentStream = encodeText(
      `q\n${NOTEBOOK_PDF_PAGE.widthPt} 0 0 ${NOTEBOOK_PDF_PAGE.heightPt} 0 0 cm\n/${imageAlias} Do\nQ\n`
    );

    objects.push({
      id: pageId,
      bytes: encodeText(
        `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${NOTEBOOK_PDF_PAGE.widthPt} ${NOTEBOOK_PDF_PAGE.heightPt}] /Resources << /XObject << /${imageAlias} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      ),
    });
    objects.push({
      id: imageId,
      bytes: buildPdfStreamObject(
        `<< /Type /XObject /Subtype /Image /Width ${pages[i].pixelWidth} /Height ${pages[i].pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pages[i].imageBytes.length} >>`,
        pages[i].imageBytes
      ),
    });
    objects.push({
      id: contentId,
      bytes: buildPdfStreamObject(`<< /Length ${contentStream.length} >>`, contentStream),
    });
  }

  objects.sort((a, b) => a.id - b.id);
  const maxObjectId = objects.length ? objects[objects.length - 1].id : 0;
  const chunks: Uint8Array[] = [encodeText("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n")];
  const offsets: number[] = new Array(maxObjectId + 1).fill(0);
  let currentOffset = chunks[0].length;

  for (const object of objects) {
    offsets[object.id] = currentOffset;
    const objectStart = encodeText(`${object.id} 0 obj\n`);
    const objectEnd = encodeText("\nendobj\n");
    chunks.push(objectStart, object.bytes, objectEnd);
    currentOffset += objectStart.length + object.bytes.length + objectEnd.length;
  }

  const xrefStart = currentOffset;
  let xrefTable = `xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObjectId; id += 1) {
    xrefTable += `${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`;
  }

  chunks.push(
    encodeText(
      `${xrefTable}trailer\n<< /Size ${maxObjectId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
    )
  );

  return new Blob([concatUint8(chunks)], { type: "application/pdf" });
};

const downloadBlobFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.position = "absolute";
  anchor.style.left = "-9999px";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

function TranslationNotebookPageContent() {
  const [entries, setEntries] = useState<TranslationNotebookEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | TranslationNotebookStatus>("all");
  const [playbackError, setPlaybackError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [sharingPdf, setSharingPdf] = useState(false);
  const [playingKey, setPlayingKey] = useState("");
  const [phoneticByEntryId, setPhoneticByEntryId] = useState<Record<string, string>>({});
  const [phoneticLoadingByEntryId, setPhoneticLoadingByEntryId] = useState<
    Record<string, boolean>
  >({});
  const searchParams = useSearchParams();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const phoneticCacheRef = useRef<Record<string, string>>({});
  const phoneticCacheReadyRef = useRef(false);
  const phoneticResolvedIdsRef = useRef<Set<string>>(new Set());

  const returnTo = useMemo(() => {
    const candidate = (searchParams.get("returnTo") || "").trim();
    if (!candidate.startsWith("/videoconference")) return "/videoconference";
    return candidate;
  }, [searchParams]);
  const embedded = (searchParams.get("embedded") || "").trim() === "1";

  const loadEntries = useCallback(() => {
    setEntries(getTranslationNotebookEntries());
  }, []);

  const handleSetStatus = useCallback(
    (entryId: string, status: TranslationNotebookStatus) => {
      updateTranslationNotebookEntryStatus(entryId, status);
      setEntries((prev) =>
        prev.map((entry) => (entry.id === entryId ? { ...entry, status } : entry))
      );
    },
    []
  );

  const fetchPhonetic = useCallback(
    async (text: string, targetName: string, targetCode: string) => {
      const trimmed = text.trim();
      if (!trimmed) return "";
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) return "";
      const response = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You are a pronunciation assistant. Convert the input text written in ${targetName} (${targetCode.toUpperCase()}) into Latin-script phonetic pronunciation. Do not translate. Return only the phonetic text, preserving punctuation and sentence order.`,
            },
            { role: "user", content: trimmed },
          ],
        }),
      });
      if (!response.ok) return "";
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = JSON.parse(raw);
      } catch {
        return "";
      }
      const choice = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0];
      const candidate = choice?.message?.content?.trim() || "";
      if (!candidate) return "";
      return normalizeForCompare(candidate) === normalizeForCompare(trimmed) ? "" : candidate;
    },
    []
  );

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
    async (entry: TranslationNotebookEntry) => {
      const text = entry.translatedText.trim();
      if (!text) return;
      const langCode = (entry.targetLanguageCode || "").trim().toLowerCase();
      const currentKey = `${entry.id}:translation`;
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

  const handleSharePdf = useCallback(async () => {
    if (typeof window === "undefined" || !entries.length || sharingPdf) return;
    setSharingPdf(true);
    setShareNotice("Generation du PDF...");

    try {
      const pdfBlob = await buildNotebookPdfBlob(entries, phoneticByEntryId);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([pdfBlob], `bfzoom-traductions-${stamp}.pdf`, {
        type: "application/pdf",
      });

      const canShareFiles =
        typeof navigator.share === "function" &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      if (canShareFiles) {
        await navigator.share({
          title: "BFZoom - Traductions",
          text: `Export PDF des traductions (${entries.length}/10)`,
          files: [file],
        });
        setShareNotice("PDF partage avec succes.");
        return;
      }

      downloadBlobFile(file, file.name);
      setShareNotice("PDF telecharge. Tu peux maintenant le partager.");
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "name" in error &&
        (error as { name?: string }).name === "AbortError"
      ) {
        setShareNotice("");
      } else {
        setShareNotice("Impossible de generer le PDF pour le moment.");
      }
    } finally {
      setSharingPdf(false);
    }
  }, [entries, phoneticByEntryId, sharingPdf]);

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

  useEffect(() => {
    if (phoneticCacheReadyRef.current) return;
    phoneticCacheRef.current = readPhoneticCache();
    phoneticCacheReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!entries.length) return;
    const currentIds = new Set(entries.map((entry) => entry.id));
    setPhoneticByEntryId((prev) => {
      const next: Record<string, string> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (currentIds.has(id)) next[id] = value;
      }
      return next;
    });
    setPhoneticLoadingByEntryId((prev) => {
      const next: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (currentIds.has(id)) next[id] = value;
      }
      return next;
    });
    phoneticResolvedIdsRef.current = new Set(
      Array.from(phoneticResolvedIdsRef.current).filter((id) => currentIds.has(id))
    );
  }, [entries]);

  useEffect(() => {
    if (!entries.length) return;
    let cancelled = false;
    const resolvePhonetics = async () => {
      for (const entry of entries) {
        if (cancelled) return;
        if (phoneticResolvedIdsRef.current.has(entry.id)) continue;
        const translated = (entry.translatedText || "").trim();
        if (!translated) {
          phoneticResolvedIdsRef.current.add(entry.id);
          continue;
        }
        const cacheKey = createPhoneticCacheKey(entry);
        const cached = phoneticCacheRef.current[cacheKey];
        if (typeof cached === "string") {
          setPhoneticByEntryId((prev) => ({ ...prev, [entry.id]: cached }));
          phoneticResolvedIdsRef.current.add(entry.id);
          continue;
        }
        setPhoneticLoadingByEntryId((prev) => ({ ...prev, [entry.id]: true }));
        try {
          const targetCode = (entry.targetLanguageCode || "en").trim().toLowerCase();
          const targetName = (entry.targetLanguageName || targetCode || "Target").trim();
          const generated = await fetchPhonetic(translated, targetName, targetCode);
          if (cancelled) return;
          phoneticCacheRef.current[cacheKey] = generated;
          writePhoneticCache(phoneticCacheRef.current);
          setPhoneticByEntryId((prev) => ({ ...prev, [entry.id]: generated }));
        } catch {
          if (cancelled) return;
          setPhoneticByEntryId((prev) => ({ ...prev, [entry.id]: "" }));
        } finally {
          if (cancelled) return;
          setPhoneticLoadingByEntryId((prev) => {
            const next = { ...prev };
            delete next[entry.id];
            return next;
          });
          phoneticResolvedIdsRef.current.add(entry.id);
        }
      }
    };
    void resolvePhonetics();
    return () => {
      cancelled = true;
    };
  }, [entries, fetchPhonetic]);

  const hasEntries = entries.length > 0;
  const filteredEntries = useMemo(() => {
    if (statusFilter === "all") return entries;
    return entries.filter((entry) => entry.status === statusFilter);
  }, [entries, statusFilter]);
  const hasFilteredEntries = filteredEntries.length > 0;
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
              <button
                type="button"
                onClick={handleSharePdf}
                disabled={!hasEntries || sharingPdf}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/70 bg-emerald-900/60 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" />
                {sharingPdf ? "Generation PDF..." : "Partager PDF"}
              </button>
              {!embedded && (
                <Link
                  href={returnTo}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-400/70 bg-sky-900/60 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-800"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Retour visio
                </Link>
              )}
            </div>
          </div>
          {hasEntries && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  statusFilter === "all"
                    ? "border-sky-400/70 bg-sky-900/60 text-sky-100"
                    : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
              >
                Tous
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("to_review")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  statusFilter === "to_review"
                    ? "border-amber-400/70 bg-amber-900/50 text-amber-100"
                    : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
              >
                A revoir
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("mastered")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  statusFilter === "mastered"
                    ? "border-emerald-400/70 bg-emerald-900/50 text-emerald-100"
                    : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
              >
                Maitrise
              </button>
            </div>
          )}
        </div>
        {playbackError && (
          <div className="rounded-xl border border-amber-500/60 bg-amber-950/50 px-3 py-2 text-xs text-amber-200">
            {playbackError}
          </div>
        )}
        {shareNotice && (
          <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
            {shareNotice}
          </div>
        )}

        {!hasEntries && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
            Aucune traduction enregistree pour le moment.
            <br />
            Lance une session Exercice langue puis maintiens le bouton pour parler.
          </div>
        )}

        {hasEntries && hasFilteredEntries && (
          <div className="space-y-3">
            {filteredEntries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-semibold ${
                        entry.direction === "outgoing"
                          ? "border-emerald-400/60 bg-emerald-900/40 text-emerald-100"
                          : "border-amber-400/60 bg-amber-900/40 text-amber-100"
                      }`}
                    >
                      {entry.direction === "outgoing" ? "Envoye" : "Recu"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 font-semibold ${
                        entry.status === "mastered"
                          ? "border-emerald-400/60 bg-emerald-900/40 text-emerald-100"
                          : "border-amber-400/60 bg-amber-900/40 text-amber-100"
                      }`}
                    >
                      {entry.status === "mastered" ? "Maitrise" : "A revoir"}
                    </span>
                  </div>
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
                  </div>
                  <div className="rounded-xl border border-sky-500/40 bg-sky-950/30 px-3 py-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                      Traduction
                    </p>
                    <p className="text-sky-100">{entry.translatedText}</p>
                    {Boolean(phoneticLoadingByEntryId[entry.id]) && (
                      <p className="mt-1 text-[11px] text-violet-200/90">
                        Phonetique: generation...
                      </p>
                    )}
                    {Boolean(phoneticByEntryId[entry.id]) && (
                      <p className="mt-1 text-[11px] italic text-violet-200/90">
                        Phonetique: {phoneticByEntryId[entry.id]}
                      </p>
                    )}
                    <div className="mt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePlay(entry)}
                          className="inline-flex items-center gap-1 rounded-full border border-sky-500/70 bg-sky-900/40 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-800/50"
                        >
                          <Play className="h-3 w-3" />
                          {playingKey === `${entry.id}:translation`
                            ? "Lecture..."
                            : "Lire traduction"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetStatus(entry.id, "to_review")}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            entry.status === "to_review"
                              ? "border-amber-400/70 bg-amber-900/50 text-amber-100"
                              : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                          }`}
                        >
                          A revoir
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetStatus(entry.id, "mastered")}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            entry.status === "mastered"
                              ? "border-emerald-400/70 bg-emerald-900/50 text-emerald-100"
                              : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                          }`}
                        >
                          Maitrise
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {hasEntries && !hasFilteredEntries && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
            Aucune traduction pour ce filtre.
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
