type AuthInput = {
  apiBaseUrl: string;
  bearerToken?: string;
  guestTtsToken?: string;
};

type RequestControl = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type PocketFlowControl = {
  pocketFlow?: boolean;
};

type ClientTranscribeMetrics = {
  recordingMs?: number;
  recorderStopMs?: number;
  postStopSettleMs?: number;
  resolveUriMs?: number;
  stabilizeMs?: number;
  preUploadMs?: number;
};

export type TranslationConsumeResult = {
  ok: boolean;
  enabled: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  lockReason?: string;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
};

export type TranslationEntitlementResult = {
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
  enabled: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  lockReason?: string;
};

export type TtsAudioFormat = "wav" | "mp3";

const TRANSLATION_TIMEOUT_MS = 12_000;
const TRANSLATION_TEMPERATURE = 0.1;
const TRANSLATION_REQUEST_TIMEOUT_MS = 14_000;
const PHONETIC_TIMEOUT_MS = 10_000;
const PHONETIC_MAX_TOKENS = 140;
const PHONETIC_TEMPERATURE = 0.0;
const PHONETIC_REQUEST_TIMEOUT_MS = 12_000;
const TRANSCRIBE_REQUEST_TIMEOUT_MS = 15_000;
const CONSUME_REQUEST_TIMEOUT_MS = 8_000;
const ENTITLEMENT_REQUEST_TIMEOUT_MS = 8_000;
const TTS_REQUEST_TIMEOUT_MS = 12_000;

export class TranslationRequestAbortError extends Error {
  readonly reason: "cancelled" | "timeout";

  constructor(reason: "cancelled" | "timeout", message?: string) {
    super(
      message
        || (reason === "timeout"
          ? "The request timed out."
          : "The request was cancelled.")
    );
    this.name = "TranslationRequestAbortError";
    this.reason = reason;
  }
}

const buildHeaders = ({
  bearerToken,
  guestTtsToken,
}: {
  bearerToken?: string;
  guestTtsToken?: string;
}) => {
  const headers: Record<string, string> = {};
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }
  if (guestTtsToken?.trim()) {
    headers["x-bfzoom-guest-tts-token"] = guestTtsToken.trim();
  }
  return headers;
};

const buildPocketFlowHeaders = (pocketFlow?: boolean): Record<string, string> =>
  pocketFlow ? { "x-bfzoom-pocket-flow": "1" } : {};

const buildClientTranscribeHeaders = (metrics?: ClientTranscribeMetrics) => {
  if (!metrics) return {};
  const normalized = Object.entries(metrics).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return acc;
    acc[`x-bfzoom-client-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`] = String(
      Math.max(0, Math.round(value))
    );
    return acc;
  }, {});
  return normalized;
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

const toFriendlyAuthError = (status: number, message: string) => {
  if (status === 401) {
    return "Session expirée. Reconnecte-toi puis réessaie.";
  }
  if (status === 403) {
    return "Accès refusé à la traduction pour ce compte.";
  }
  return message;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isAbortLikeError = (error: unknown) => {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /abort|aborted/i.test(raw);
};

export const isTranslationAbortError = (
  error: unknown
): error is TranslationRequestAbortError => error instanceof TranslationRequestAbortError;

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
  }, timeoutMs);
  try {
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new TranslationRequestAbortError(
          abortedByTimeout ? "timeout" : "cancelled"
        );
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

const readTranslationAbort = (
  error: unknown,
  timeoutMessage: string
) : never => {
  if (isTranslationAbortError(error)) {
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

export const fetchTranslationEntitlement = async ({
  apiBaseUrl,
  bearerToken,
  guestTtsToken,
  signal,
  timeoutMs = ENTITLEMENT_REQUEST_TIMEOUT_MS,
}: AuthInput & RequestControl): Promise<TranslationEntitlementResult> => {
  let res: Response | undefined;
  try {
    res = await fetchWithTimeout(
      `${apiBaseUrl}/api/translation/entitlement`,
      {
        method: "GET",
        headers: buildHeaders({ bearerToken, guestTtsToken }),
      },
      {
        signal,
        timeoutMs,
      }
    );
  } catch (error) {
    readTranslationAbort(error, "Credits check timed out. Check your connection and try again.");
  }
  const safeResponse = assertResponse(res);
  if (!safeResponse.ok) {
    const apiError = await parseApiError(safeResponse);
    throw new Error(toFriendlyAuthError(safeResponse.status, apiError || "Credits unavailable."));
  }
  const payload = (await safeResponse.json()) as Partial<TranslationEntitlementResult> & {
    error?: string;
  };
  return {
    totalSecondsRemaining:
      typeof payload.totalSecondsRemaining === "number" ? payload.totalSecondsRemaining : 0,
    freeSecondsRemaining:
      typeof payload.freeSecondsRemaining === "number" ? payload.freeSecondsRemaining : 0,
    paidSecondsRemaining:
      typeof payload.paidSecondsRemaining === "number" ? payload.paidSecondsRemaining : 0,
    enabled: payload.enabled !== false,
    isAdmin: payload.isAdmin === true,
    isPremium: payload.isPremium === true,
    lockReason: payload.lockReason || "",
  };
};

const assertResponse = (response: Response | undefined): Response => {
  if (response) return response;
  throw new Error("Missing response.");
};

export const transcribeAudio = async ({
  apiBaseUrl,
  bearerToken,
  guestTtsToken,
  audioUri,
  mimeType,
  language,
  clientMetrics,
  pocketFlow,
  signal,
  timeoutMs = TRANSCRIBE_REQUEST_TIMEOUT_MS,
}: AuthInput & {
  audioUri: string;
  mimeType?: string;
  language?: string;
  clientMetrics?: ClientTranscribeMetrics;
} & RequestControl & PocketFlowControl) => {
  let lastError = "Erreur transcription audio.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body = new FormData();
    const forceMpeg4 = attempt > 0;
    const meta = inferAudioMeta(audioUri, mimeType, forceMpeg4);
    const file = {
      uri: audioUri,
      name: meta.name,
      type: meta.mimeType,
    } as unknown as File;
    body.append("file", file);
    const normalizedLanguage = (language || "").trim().toLowerCase();
    if (normalizedLanguage) {
      body.append("language", normalizedLanguage);
    }

    let res: Response | undefined;
    try {
      res = await fetchWithTimeout(
        `${apiBaseUrl}/api/transcribe`,
        {
          method: "POST",
          headers: {
            ...buildHeaders({ bearerToken, guestTtsToken }),
            ...buildPocketFlowHeaders(pocketFlow),
            ...buildClientTranscribeHeaders(clientMetrics),
          },
          body,
        },
        {
          signal,
          timeoutMs,
        }
      );
    } catch (error) {
      readTranslationAbort(error, "Transcription timed out. Check your connection and try again.");
    }
    const safeResponse = assertResponse(res);
    if (safeResponse.ok) {
      const data = (await safeResponse.json()) as { text?: string };
      return (data.text || "").trim();
    }

    const apiError = await parseApiError(safeResponse);
    lastError = toFriendlyAuthError(safeResponse.status, apiError);

    if (
      attempt === 0 &&
      safeResponse.status === 400 &&
      isCorruptedAudioError(apiError)
    ) {
      await wait(220);
      continue;
    }
    break;
  }

  if (isCorruptedAudioError(lastError)) {
    throw new Error("Audio invalide ou trop court. Parle 1-2 secondes puis réessaie.");
  }
  throw new Error(lastError);
};
const SUPPORTED_TRANSCRIBE_EXTENSIONS = new Set([
  "m4a",
  "mp4",
  "mp3",
  "wav",
  "webm",
  "ogg",
  "mpeg",
  "mpga",
  "aac",
]);

const inferAudioMeta = (
  audioUri: string,
  fallbackMimeType?: string,
  forceMpeg4 = false
) => {
  const cleanUri = audioUri.split("?")[0] || audioUri;
  const detectedExt = (cleanUri.match(/\.([a-z0-9]+)$/i)?.[1] || "m4a").toLowerCase();
  const mimeByExt: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    caf: "audio/x-caf",
    aac: "audio/aac",
    webm: "audio/webm",
    ogg: "audio/ogg",
  };
  const ext = forceMpeg4
    ? "m4a"
    : SUPPORTED_TRANSCRIBE_EXTENSIONS.has(detectedExt)
      ? detectedExt
      : "m4a";
  const mimeType = fallbackMimeType || mimeByExt[ext] || "audio/mp4";
  return {
    name: `mobile-${Date.now()}.${ext}`,
    mimeType,
  };
};

const isCorruptedAudioError = (message: string) =>
  /corrupt|unsupported|decode|invalid|audio file|audio format|unrecognized/i.test(message);


export const consumeTranslationSeconds = async ({
  apiBaseUrl,
  bearerToken,
  guestTtsToken,
  seconds,
  origin,
  roomId,
  preview,
  signal,
  timeoutMs = CONSUME_REQUEST_TIMEOUT_MS,
}: AuthInput & {
  seconds: number;
  origin: string;
  roomId?: string;
  preview?: boolean;
} & RequestControl): Promise<TranslationConsumeResult> => {
  const safeSeconds = Math.max(1, Math.min(300, Math.floor(seconds || 1)));
  let res: Response | undefined;
  try {
    res = await fetchWithTimeout(
      `${apiBaseUrl}/api/translation/consume`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders({ bearerToken, guestTtsToken }),
        },
        body: JSON.stringify({
          seconds: safeSeconds,
          origin: origin.trim().slice(0, 80),
          roomId: (roomId || "").trim().slice(0, 80),
          preview: preview === true,
        }),
      },
      {
        signal,
        timeoutMs,
      }
    );
  } catch (error) {
    readTranslationAbort(error, "Credits check timed out. Check your connection and try again.");
  }

  const safeResponse = assertResponse(res);
  const payload = (await safeResponse.json().catch(() => ({}))) as Partial<TranslationConsumeResult> & {
    error?: string;
  };

  if (safeResponse.status === 402) {
    return {
      ok: false,
      enabled: false,
      isAdmin: payload.isAdmin === true,
      isPremium: payload.isPremium === true,
      lockReason: payload.lockReason || "",
      totalSecondsRemaining:
        typeof payload.totalSecondsRemaining === "number" ? payload.totalSecondsRemaining : 0,
      freeSecondsRemaining:
        typeof payload.freeSecondsRemaining === "number" ? payload.freeSecondsRemaining : 0,
      paidSecondsRemaining:
        typeof payload.paidSecondsRemaining === "number" ? payload.paidSecondsRemaining : 0,
    };
  }

  if (!safeResponse.ok) {
    throw new Error(toFriendlyAuthError(safeResponse.status, payload.error || "Credits unavailable."));
  }

  return {
    ok: payload.ok !== false,
    enabled: payload.enabled !== false,
    isAdmin: payload.isAdmin === true,
    isPremium: payload.isPremium === true,
    lockReason: payload.lockReason || "",
    totalSecondsRemaining:
      typeof payload.totalSecondsRemaining === "number" ? payload.totalSecondsRemaining : 0,
    freeSecondsRemaining:
      typeof payload.freeSecondsRemaining === "number" ? payload.freeSecondsRemaining : 0,
    paidSecondsRemaining:
      typeof payload.paidSecondsRemaining === "number" ? payload.paidSecondsRemaining : 0,
  };
};

export const translateText = async ({
  apiBaseUrl,
  bearerToken,
  guestTtsToken,
  text,
  fromLanguage,
  toLanguage,
  pocketFlow,
  signal,
  timeoutMs = TRANSLATION_REQUEST_TIMEOUT_MS,
}: AuthInput & {
  text: string;
  fromLanguage: string;
  toLanguage: string;
} & RequestControl & PocketFlowControl) => {
  const messages = [
    {
      role: "system",
      content: `Translate ${fromLanguage} to ${toLanguage}. Return only the translation.`,
    },
    {
      role: "user",
      content: text,
    },
  ];
  let res: Response | undefined;
  try {
    res = await fetchWithTimeout(
      `${apiBaseUrl}/api/openai`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders({ bearerToken, guestTtsToken }),
          ...buildPocketFlowHeaders(pocketFlow),
        },
        body: JSON.stringify({
          messages,
          intent: "translation",
          timeoutMs: TRANSLATION_TIMEOUT_MS,
          temperature: TRANSLATION_TEMPERATURE,
        }),
      },
      {
        signal,
        timeoutMs,
      }
    );
  } catch (error) {
    readTranslationAbort(error, "Translation timed out. Check your connection and try again.");
  }
  const safeResponse = assertResponse(res);
  if (!safeResponse.ok) {
    const apiError = await parseApiError(safeResponse);
    throw new Error(toFriendlyAuthError(safeResponse.status, apiError));
  }
  const data = (await safeResponse.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
};

export const phoneticText = async ({
  apiBaseUrl,
  bearerToken,
  guestTtsToken,
  text,
  languageName,
  signal,
  timeoutMs = PHONETIC_REQUEST_TIMEOUT_MS,
}: AuthInput & {
  text: string;
  languageName: string;
} & RequestControl) => {
  const content = text.trim();
  if (!content) return "";

  const messages = [
    {
      role: "system",
      content:
        `Generate a Latin-script phonetic transliteration for ${languageName}. ` +
        "Return only the transliteration text, no explanation.",
    },
    {
      role: "user",
      content,
    },
  ];

  let res: Response | undefined;
  try {
    res = await fetchWithTimeout(
      `${apiBaseUrl}/api/openai`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders({ bearerToken, guestTtsToken }),
        },
        body: JSON.stringify({
          messages,
          intent: "phonetic",
          timeoutMs: PHONETIC_TIMEOUT_MS,
          maxTokens: PHONETIC_MAX_TOKENS,
          temperature: PHONETIC_TEMPERATURE,
        }),
      },
      {
        signal,
        timeoutMs,
      }
    );
  } catch (error) {
    readTranslationAbort(error, "Phonetic request timed out. Check your connection and try again.");
  }
  const safeResponse = assertResponse(res);
  if (!safeResponse.ok) {
    const apiError = await parseApiError(safeResponse);
    throw new Error(toFriendlyAuthError(safeResponse.status, apiError));
  }
  const data = (await safeResponse.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
};

export const fetchTtsAudio = async ({
  apiBaseUrl,
  bearerToken,
  guestTtsToken,
  text,
  voice,
  format,
  language,
  locale,
  instructions,
  pocketFlow,
  signal,
  timeoutMs = TTS_REQUEST_TIMEOUT_MS,
}: AuthInput & RequestControl & PocketFlowControl & {
  text: string;
  voice: string;
  format: TtsAudioFormat;
  language?: string;
  locale?: string;
  instructions?: string;
}) => {
  let res: Response | undefined;
  try {
    res = await fetchWithTimeout(
      `${apiBaseUrl}/api/tts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders({ bearerToken, guestTtsToken }),
          ...buildPocketFlowHeaders(pocketFlow),
        },
        body: JSON.stringify({
          text,
          voice,
          format,
          language,
          locale,
          instructions,
        }),
      },
      {
        signal,
        timeoutMs,
      }
    );
  } catch (error) {
    readTranslationAbort(error, "AI voice request timed out. Check your connection and try again.");
  }
  const safeResponse = assertResponse(res);
  if (!safeResponse.ok) {
    const apiError = await parseApiError(safeResponse);
    throw new Error(toFriendlyAuthError(safeResponse.status, apiError));
  }
  return safeResponse.blob();
};
