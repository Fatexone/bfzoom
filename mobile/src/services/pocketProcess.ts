import { TranslationRequestAbortError, type TtsAudioFormat } from "./translation";

type RequestControl = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type ClientPocketMetrics = {
  recordingMs?: number;
  recorderStopMs?: number;
  postStopSettleMs?: number;
  resolveUriMs?: number;
  stabilizeMs?: number;
  preUploadMs?: number;
};

type PocketProcessMetrics = {
  totalMs: number;
  authMs: number;
  formDataMs: number;
  entitlementMs: number;
  transcribeMs: number;
  translateMs: number;
  consumeMs: number;
  consumeTransactionMs?: number;
  consumeReadMs?: number;
  consumePlanMs?: number;
  consumeAttempts?: number;
  consumeMode?: "unlimited" | "locked" | "free" | "paid" | "mixed";
  consumeWriteMode?: "none" | "meter" | "meter+wallet";
  grantMs?: number;
  ttsMs: number;
  audioBase64Ms: number;
  audioBytes: number;
  clientFetchMs?: number;
  clientJsonMs?: number;
  clientTransportMs?: number;
  responseContentLength?: number;
  vercelId?: string;
};

export type PocketProcessSuccess = {
  ok: true;
  sourceText: string;
  translatedText: string;
  ttsBase64: string;
  ttsAvailable: boolean;
  ttsError: string;
  ttsFormat: TtsAudioFormat;
  ttsMimeType: string;
  ttsVoice: string;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
  isAdmin: boolean;
  isPremium: boolean;
  metrics: PocketProcessMetrics;
};

export type PocketProcessLocked = {
  ok: false;
  enabled: false;
  lockReason: string;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
  isAdmin: boolean;
  isPremium: boolean;
  metrics?: Partial<PocketProcessMetrics>;
};

export type PocketProcessResult = PocketProcessSuccess | PocketProcessLocked;

export class PocketProcessFallbackError extends Error {
  constructor(message = "Pocket unified pipeline unavailable.") {
    super(message);
    this.name = "PocketProcessFallbackError";
  }
}

const PROCESS_TIMEOUT_MS = 30_000;

const buildHeaders = (bearerToken?: string) => {
  const headers: Record<string, string> = {};
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }
  return headers;
};

const buildClientMetricHeaders = (metrics?: ClientPocketMetrics) => {
  if (!metrics) return {};
  return Object.entries(metrics).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return acc;
    acc[`x-bfzoom-client-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`] = String(
      Math.max(0, Math.round(value))
    );
    return acc;
  }, {});
};

const parseApiError = async (res: Response) => {
  const raw = await res.text().catch(() => "");
  if (!raw) return `${res.status} ${res.statusText}`.trim();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
};

const isAbortLikeError = (error: unknown) => {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /abort|aborted/i.test(raw);
};

const readAbort = (error: unknown, timeoutMessage: string): never => {
  if (error instanceof TranslationRequestAbortError) {
    if (error.reason === "timeout") {
      throw new Error(timeoutMessage);
    }
    throw error;
  }
  if (isAbortLikeError(error)) {
    throw new TranslationRequestAbortError("cancelled");
  }
  throw error;
};

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  { signal, timeoutMs }: RequestControl
) => {
  if (typeof AbortController === "undefined") {
    if (signal?.aborted) {
      throw new TranslationRequestAbortError("cancelled");
    }
    return fetch(input, { ...init, signal });
  }
  const controller = new AbortController();
  let abortedByTimeout = false;
  const abortFromExternalSignal = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else if (signal) {
    signal.addEventListener("abort", abortFromExternalSignal, { once: true });
  }
  const timeoutId = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, timeoutMs ?? PROCESS_TIMEOUT_MS);

  try {
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new TranslationRequestAbortError(abortedByTimeout ? "timeout" : "cancelled");
      }
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", abortFromExternalSignal);
    }
  }
};

const inferAudioMeta = (audioUri: string, mimeType?: string) => {
  const clean = audioUri.split("?")[0] || audioUri;
  const detectedExt = (clean.match(/\.([a-z0-9]+)$/i)?.[1] || "m4a").toLowerCase();
  const mimeByExt: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    caf: "audio/x-caf",
    aac: "audio/aac",
    oga: "audio/ogg",
    ogg: "audio/ogg",
  };
  const ext = detectedExt || "m4a";
  return {
    name: `mobile-${Date.now()}.${ext}`,
    mimeType: mimeType || mimeByExt[ext] || "audio/mp4",
  };
};

export const isPocketProcessFallbackError = (
  error: unknown
): error is PocketProcessFallbackError => error instanceof PocketProcessFallbackError;

export const processPocketAudio = async ({
  apiBaseUrl,
  bearerToken,
  audioUri,
  mimeType,
  sourceLanguage,
  targetLanguage,
  fromLanguage,
  toLanguage,
  usageSeconds,
  voice,
  format,
  locale,
  instructions,
  requestId,
  clientMetrics,
  signal,
  timeoutMs = PROCESS_TIMEOUT_MS,
}: RequestControl & {
  apiBaseUrl: string;
  bearerToken: string;
  audioUri: string;
  mimeType?: string;
  sourceLanguage: string;
  targetLanguage: string;
  fromLanguage: string;
  toLanguage: string;
  usageSeconds: number;
  voice: string;
  format: TtsAudioFormat;
  locale?: string;
  instructions?: string;
  requestId: string;
  clientMetrics?: ClientPocketMetrics;
}): Promise<PocketProcessResult> => {
  const requestStartedAt = Date.now();
  const body = new FormData();
  const meta = inferAudioMeta(audioUri, mimeType);
  const file = {
    uri: audioUri,
    name: meta.name,
    type: meta.mimeType,
  } as unknown as File;

  body.append("file", file);
  body.append("sourceLanguage", sourceLanguage.trim().toLowerCase());
  body.append("targetLanguage", targetLanguage.trim().toLowerCase());
  body.append("fromLanguage", fromLanguage.trim());
  body.append("toLanguage", toLanguage.trim());
  body.append("usageSeconds", String(Math.max(1, Math.min(300, Math.floor(usageSeconds || 1)))));
  body.append("voice", voice.trim());
  body.append("format", format);
  if (locale?.trim()) {
    body.append("locale", locale.trim());
  }
  if (instructions?.trim()) {
    body.append("instructions", instructions.trim());
  }
  body.append("requestId", requestId.trim());

  let res: Response | undefined;
  try {
    res = await fetchWithTimeout(
      `${apiBaseUrl}/api/pocket/process`,
      {
        method: "POST",
        headers: {
          ...buildHeaders(bearerToken),
          ...buildClientMetricHeaders(clientMetrics),
          "x-bfzoom-pocket-request-id": requestId.trim(),
        },
        body,
      },
      {
        signal,
        timeoutMs,
      }
    );
  } catch (error) {
    readAbort(error, "Pocket processing timed out. Check your connection and try again.");
  }

  const safeResponse = res as Response;
  const fetchCompletedAt = Date.now();
  const responseContentLengthHeader = safeResponse.headers.get("content-length");
  const responseContentLength = (() => {
    const parsed = Number(responseContentLengthHeader || "");
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
  })();
  const vercelId = (safeResponse.headers.get("x-vercel-id") || "").trim() || undefined;
  if (
    safeResponse.status === 404 ||
    safeResponse.status === 405 ||
    safeResponse.status === 501 ||
    (safeResponse.status === 503 &&
      (safeResponse.headers.get("x-bfzoom-pocket-fallback") || "").trim() === "1")
  ) {
    throw new PocketProcessFallbackError();
  }

  if (safeResponse.status === 402) {
    const jsonStartedAt = Date.now();
    const payload = (await safeResponse.json().catch(() => ({}))) as Partial<PocketProcessLocked> & {
      error?: string;
    };
    const jsonCompletedAt = Date.now();
    return {
      ok: false,
      enabled: false,
      lockReason: payload.lockReason || payload.error || "",
      totalSecondsRemaining:
        typeof payload.totalSecondsRemaining === "number" ? payload.totalSecondsRemaining : 0,
      freeSecondsRemaining:
        typeof payload.freeSecondsRemaining === "number" ? payload.freeSecondsRemaining : 0,
      paidSecondsRemaining:
        typeof payload.paidSecondsRemaining === "number" ? payload.paidSecondsRemaining : 0,
      isAdmin: payload.isAdmin === true,
      isPremium: payload.isPremium === true,
      metrics: payload.metrics
        ? {
            ...payload.metrics,
            clientFetchMs: fetchCompletedAt - requestStartedAt,
            clientJsonMs: jsonCompletedAt - jsonStartedAt,
            clientTransportMs:
              typeof payload.metrics.totalMs === "number"
                ? Math.max(0, fetchCompletedAt - requestStartedAt - payload.metrics.totalMs)
                : undefined,
            responseContentLength,
            vercelId,
          }
        : undefined,
    };
  }

  if (!safeResponse.ok) {
    const apiError = await parseApiError(safeResponse);
    throw new Error(apiError || "Pocket processing failed.");
  }

  const jsonStartedAt = Date.now();
  const payload = (await safeResponse.json()) as Partial<PocketProcessSuccess> & {
    error?: string;
  };
  const jsonCompletedAt = Date.now();
  const clientFetchMs = fetchCompletedAt - requestStartedAt;
  const clientJsonMs = jsonCompletedAt - jsonStartedAt;

  return {
    ok: true,
    sourceText: String(payload.sourceText || "").trim(),
    translatedText: String(payload.translatedText || "").trim(),
    ttsBase64: String(payload.ttsBase64 || "").trim(),
    ttsAvailable: payload.ttsAvailable !== false,
    ttsError: String(payload.ttsError || "").trim(),
    ttsFormat: payload.ttsFormat === "wav" ? "wav" : "mp3",
    ttsMimeType: String(payload.ttsMimeType || ""),
    ttsVoice: String(payload.ttsVoice || ""),
    totalSecondsRemaining:
      typeof payload.totalSecondsRemaining === "number" ? payload.totalSecondsRemaining : 0,
    freeSecondsRemaining:
      typeof payload.freeSecondsRemaining === "number" ? payload.freeSecondsRemaining : 0,
    paidSecondsRemaining:
      typeof payload.paidSecondsRemaining === "number" ? payload.paidSecondsRemaining : 0,
    isAdmin: payload.isAdmin === true,
    isPremium: payload.isPremium === true,
    metrics: {
      totalMs: typeof payload.metrics?.totalMs === "number" ? payload.metrics.totalMs : 0,
      authMs: typeof payload.metrics?.authMs === "number" ? payload.metrics.authMs : 0,
      formDataMs: typeof payload.metrics?.formDataMs === "number" ? payload.metrics.formDataMs : 0,
      entitlementMs:
        typeof payload.metrics?.entitlementMs === "number" ? payload.metrics.entitlementMs : 0,
      transcribeMs:
        typeof payload.metrics?.transcribeMs === "number" ? payload.metrics.transcribeMs : 0,
      translateMs:
        typeof payload.metrics?.translateMs === "number" ? payload.metrics.translateMs : 0,
      consumeMs: typeof payload.metrics?.consumeMs === "number" ? payload.metrics.consumeMs : 0,
      consumeTransactionMs:
        typeof payload.metrics?.consumeTransactionMs === "number"
          ? payload.metrics.consumeTransactionMs
          : undefined,
      consumeReadMs:
        typeof payload.metrics?.consumeReadMs === "number"
          ? payload.metrics.consumeReadMs
          : undefined,
      consumePlanMs:
        typeof payload.metrics?.consumePlanMs === "number"
          ? payload.metrics.consumePlanMs
          : undefined,
      consumeAttempts:
        typeof payload.metrics?.consumeAttempts === "number"
          ? payload.metrics.consumeAttempts
          : undefined,
      consumeMode:
        payload.metrics?.consumeMode === "unlimited" ||
        payload.metrics?.consumeMode === "locked" ||
        payload.metrics?.consumeMode === "free" ||
        payload.metrics?.consumeMode === "paid" ||
        payload.metrics?.consumeMode === "mixed"
          ? payload.metrics.consumeMode
          : undefined,
      consumeWriteMode:
        payload.metrics?.consumeWriteMode === "none" ||
        payload.metrics?.consumeWriteMode === "meter" ||
        payload.metrics?.consumeWriteMode === "meter+wallet"
          ? payload.metrics.consumeWriteMode
          : undefined,
      grantMs: typeof payload.metrics?.grantMs === "number" ? payload.metrics.grantMs : undefined,
      ttsMs: typeof payload.metrics?.ttsMs === "number" ? payload.metrics.ttsMs : 0,
      audioBase64Ms:
        typeof payload.metrics?.audioBase64Ms === "number" ? payload.metrics.audioBase64Ms : 0,
      audioBytes: typeof payload.metrics?.audioBytes === "number" ? payload.metrics.audioBytes : 0,
      clientFetchMs,
      clientJsonMs,
      clientTransportMs:
        typeof payload.metrics?.totalMs === "number"
          ? Math.max(0, clientFetchMs - payload.metrics.totalMs)
          : undefined,
      responseContentLength,
      vercelId,
    },
  };
};
