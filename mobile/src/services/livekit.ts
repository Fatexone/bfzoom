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

  const response = await fetch(`${apiBaseUrl}/api/livekit/token`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(message);
  }

  const raw = await response.text();
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
  const response = await fetch(`${apiBaseUrl}/api/livekit/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken.trim()}`,
    },
    body: JSON.stringify({ room }),
    signal,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(message);
  }

  const raw = await response.text();
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

  const response = await fetch(`${apiBaseUrl}/api/livekit/invite/redeem`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      invite: inviteId,
      identity,
      name,
      includeGuestTtsToken: true,
    }),
    signal,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(message);
  }

  const raw = await response.text();
  return parseLiveKitInviteRedeemResponse(raw);
};
