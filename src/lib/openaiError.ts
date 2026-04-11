type OpenAiErrorShape = {
  status?: number;
  statusCode?: number;
  code?: string;
  type?: string;
  message?: string;
  error?: {
    code?: string;
    type?: string;
    message?: string;
  };
};

type MappedOpenAiError = {
  status: number;
  message: string;
};

const extractStatus = (error: OpenAiErrorShape): number | null => {
  const status = Number(error.status ?? error.statusCode);
  if (Number.isFinite(status) && status >= 100 && status <= 599) {
    return status;
  }
  return null;
};

const firstNonEmpty = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

export const mapOpenAiError = (
  error: unknown,
  fallbackMessage: string
): MappedOpenAiError => {
  const raw = (error ?? {}) as OpenAiErrorShape;
  const status = extractStatus(raw);
  const code = firstNonEmpty(raw.code, raw.error?.code).toLowerCase();
  const type = firstNonEmpty(raw.type, raw.error?.type).toLowerCase();
  const message = firstNonEmpty(raw.error?.message, raw.message, String(error || ""));
  const normalized = `${code} ${type} ${message}`.toLowerCase();

  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("exceeded your current quota") ||
    normalized.includes("billing")
  ) {
    return {
      status: 429,
      message:
        "Quota API OpenAI epuise. Recharge le billing OpenAI pour reactiver traduction et voix.",
    };
  }

  if (status === 429 || normalized.includes("rate limit")) {
    return {
      status: 429,
      message: "Rate limit OpenAI atteint. Reessaie dans quelques secondes.",
    };
  }

  if (status === 401 || normalized.includes("invalid api key")) {
    return {
      status: 401,
      message: "Cle API OpenAI invalide ou manquante.",
    };
  }

  if (status === 403) {
    return {
      status: 403,
      message: "Acces OpenAI refuse pour cette operation.",
    };
  }

  if (status && status >= 400 && status <= 599) {
    return {
      status,
      message: message || fallbackMessage,
    };
  }

  return {
    status: 500,
    message: message || fallbackMessage,
  };
};

