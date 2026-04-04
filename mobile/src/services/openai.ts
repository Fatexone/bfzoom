type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type RequestInput = {
  apiBaseUrl: string;
  bearerToken?: string;
  messages: OpenAiMessage[];
  jsonMode?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  // additional options such as intent, stream, etc. will be spread
  [key: string]: unknown;
};

const buildHeaders = (bearerToken?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }
  return headers;
};

const parseApiError = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return `${response.status} ${response.statusText}`.trim();
  }
  try {
    const data = JSON.parse(raw) as { error?: string };
    return data.error || raw;
  } catch {
    return raw;
  }
};

export const askOpenAi = async ({
  apiBaseUrl,
  bearerToken,
  messages,
  jsonMode = false,
  timeoutMs,
  maxTokens,
  temperature,
  ...extra
}: RequestInput): Promise<string> => {
  const body: Record<string, unknown> = { messages, jsonMode, ...extra };
  if (typeof timeoutMs === "number") body.timeoutMs = timeoutMs;
  if (typeof maxTokens === "number") body.maxTokens = maxTokens;
  if (typeof temperature === "number") body.temperature = temperature;

  const response = await fetch(`${apiBaseUrl}/api/openai`, {
    method: "POST",
    headers: buildHeaders(bearerToken),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
};

export type { OpenAiMessage };
