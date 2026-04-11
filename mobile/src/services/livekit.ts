import type { LiveKitTokenRequest } from "../types/livekit";

type FetchLiveKitTokenInput = {
  apiBaseUrl: string;
  payload: LiveKitTokenRequest;
  bearerToken?: string;
  signal?: AbortSignal;
};

export type LiveKitTokenResult = {
  token: string;
  guestTtsToken?: string;
};

export type LiveKitInviteCreateResult = {
  inviteId: string;
  room: string;
  expiresAt?: string;
  maxUses?: number;
};

export type LiveKitInviteRedeemResult = {
  room: string;
  token: string;
  guestTtsToken?: string;
  inviteId?: string;
};

const LIVEKIT_REQUEST_TIMEOUT_MS = 15_000;

class LiveKitRequestAbortError extends Error {
  readonly reason: "cancelled" | "timeout";

  constructor(reason: "cancelled" | "timeout", message?: string) {
    super(
      message ||
        (reason === "timeout" ? "The request timed out." : "The request was cancelled.")
    );
    this.name = "LiveKitRequestAbortError";
    this.reason = reason;
  }
}

const isAbortLikeError = (error: unknown) => {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /abort|aborted/i.test(raw);
};

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  {
    signal,
    timeoutMs = LIVEKIT_REQUEST_TIMEOUT_MS,
  }: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }
) => {
  if (typeof AbortController === "undefined") {
    if (signal?.aborted) {
      throw new LiveKitRequestAbortError("cancelled");
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
        throw new LiveKitRequestAbortError(abortedByTimeout ? "timeout" : "cancelled");
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

const readAbortError = (error: unknown, timeoutMessage: string): never => {
  if (error instanceof LiveKitRequestAbortError) {
    if (error.reason === "timeout") {
      throw new Error(timeoutMessage);
    }
    throw error;
  }
  if (isAbortLikeError(error)) {
    throw new LiveKitRequestAbortError("cancelled");
  }
  throw error;
};

const sanitizeApiErrorMessage = (raw: string, fallback: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const looksLikeHtml =
    /^<!doctype html/i.test(trimmed) ||
    /^<html/i.test(trimmed) ||
    /<head[\s>]/i.test(trimmed) ||
    /<body[\s>]/i.test(trimmed);
  if (looksLikeHtml) {
    return fallback;
  }
  return trimmed;
};

const parseErrorMessage = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  const fallback = `${response.status} ${response.statusText}`.trim();
  if (!raw) return fallback;
  try {
    const json = JSON.parse(raw) as { error?: string };
    return sanitizeApiErrorMessage(json.error || raw, fallback);
  } catch {
    return sanitizeApiErrorMessage(raw, fallback);
  }
};

const parseLiveKitTokenResponse = (raw: string): LiveKitTokenResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty LiveKit token response.");
  }

  let token = trimmed;
  let guestTtsToken = "";

  if (trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed) as {
      token?: string;
      guestTtsToken?: string | null;
    };
    token = (json.token || "").trim();
    guestTtsToken = (json.guestTtsToken || "").trim();
  }

  if (!token || token.split(".").length !== 3) {
    throw new Error("Invalid LiveKit JWT returned by API.");
  }

  return {
    token,
    guestTtsToken: guestTtsToken || undefined,
  };
};

const parseLiveKitInviteCreateResponse = (raw: string): LiveKitInviteCreateResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty invite response.");
  }
  const json = JSON.parse(trimmed) as {
    inviteId?: string;
    room?: string;
    expiresAt?: string | null;
    maxUses?: number;
  };
  const inviteId = (json.inviteId || "").trim();
  const room = (json.room || "").trim();
  if (!inviteId || !room) {
    throw new Error("Invalid invite response.");
  }
  return {
    inviteId,
    room,
    expiresAt: (json.expiresAt || "").trim() || undefined,
    maxUses: typeof json.maxUses === "number" ? json.maxUses : undefined,
  };
};

const parseLiveKitInviteRedeemResponse = (raw: string): LiveKitInviteRedeemResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty invite redemption response.");
  }
  const json = JSON.parse(trimmed) as {
    inviteId?: string;
    room?: string;
    token?: string;
    guestTtsToken?: string | null;
  };
  const room = (json.room || "").trim();
  const token = (json.token || "").trim();
  const guestTtsToken = (json.guestTtsToken || "").trim();
  const inviteId = (json.inviteId || "").trim();
  if (!room || !token || token.split(".").length !== 3) {
    throw new Error("Invalid invite redemption payload.");
  }
  return {
    room,
    token,
    guestTtsToken: guestTtsToken || undefined,
    inviteId: inviteId || undefined,
  };
};

export const fetchLiveKitToken = async ({
  apiBaseUrl,
  payload,
  bearerToken,
  signal,
}: FetchLiveKitTokenInput): Promise<LiveKitTokenResult> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }

  let response: Response | undefined;
  try {
    response = await fetchWithTimeout(
      `${apiBaseUrl}/api/livekit/token`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
      { signal }
    );
  } catch (error) {
    readAbortError(
      error,
      "Live room authentication timed out. Check your connection and try again."
    );
  }
  const safeResponse = response as Response;

  if (!safeResponse.ok) {
    const message = await parseErrorMessage(safeResponse);
    throw new Error(message);
  }

  const raw = await safeResponse.text();
  return parseLiveKitTokenResponse(raw);
};

export const createLiveKitInvite = async ({
  apiBaseUrl,
  room,
  bearerToken,
  signal,
}: {
  apiBaseUrl: string;
  room: string;
  bearerToken: string;
  signal?: AbortSignal;
}): Promise<LiveKitInviteCreateResult> => {
  let response: Response | undefined;
  try {
    response = await fetchWithTimeout(
      `${apiBaseUrl}/api/livekit/invite`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken.trim()}`,
        },
        body: JSON.stringify({ room }),
      },
      { signal }
    );
  } catch (error) {
    readAbortError(error, "Invite creation timed out. Check your connection and try again.");
  }
  const safeResponse = response as Response;

  if (!safeResponse.ok) {
    const message = await parseErrorMessage(safeResponse);
    throw new Error(message);
  }

  const raw = await safeResponse.text();
  return parseLiveKitInviteCreateResponse(raw);
};

export const redeemLiveKitInvite = async ({
  apiBaseUrl,
  inviteId,
  identity,
  name,
  bearerToken,
  signal,
}: {
  apiBaseUrl: string;
  inviteId: string;
  identity: string;
  name?: string;
  bearerToken?: string;
  signal?: AbortSignal;
}): Promise<LiveKitInviteRedeemResult> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }

  let response: Response | undefined;
  try {
    response = await fetchWithTimeout(
      `${apiBaseUrl}/api/livekit/invite/redeem`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          invite: inviteId,
          identity,
          name,
          includeGuestTtsToken: true,
        }),
      },
      { signal }
    );
  } catch (error) {
    readAbortError(error, "Invite join timed out. Check your connection and try again.");
  }
  const safeResponse = response as Response;

  if (!safeResponse.ok) {
    const message = await parseErrorMessage(safeResponse);
    throw new Error(message);
  }

  const raw = await safeResponse.text();
  return parseLiveKitInviteRedeemResponse(raw);
};
