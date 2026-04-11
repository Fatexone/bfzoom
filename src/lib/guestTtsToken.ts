import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const TOKEN_SCOPE = "guest_tts";
const DEFAULT_GUEST_TTS_TTL_SECONDS = 60 * 60 * 12;

type GuestTtsRole = "guest" | "host";

type GuestTtsClaims = {
  v: typeof TOKEN_VERSION;
  scope: typeof TOKEN_SCOPE;
  room: string;
  identity: string;
  role: GuestTtsRole;
  iat: number;
  exp: number;
  nonce: string;
};

const getGuestTtsSecret = () =>
  (process.env.BFZOOM_GUEST_TTS_SECRET || process.env.LIVEKIT_API_SECRET || "").trim();

const base64UrlEncode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const base64UrlDecode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const signPayload = (payloadSegment: string, secret: string) =>
  createHmac("sha256", secret).update(payloadSegment).digest("base64url");

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isGuestTtsClaims = (value: unknown): value is GuestTtsClaims => {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<GuestTtsClaims>;
  return (
    claims.v === TOKEN_VERSION &&
    claims.scope === TOKEN_SCOPE &&
    isNonEmptyString(claims.room) &&
    isNonEmptyString(claims.identity) &&
    (claims.role === "guest" || claims.role === "host") &&
    typeof claims.iat === "number" &&
    Number.isFinite(claims.iat) &&
    typeof claims.exp === "number" &&
    Number.isFinite(claims.exp) &&
    isNonEmptyString(claims.nonce)
  );
};

export const createGuestTtsToken = ({
  room,
  identity,
  role = "guest",
  ttlSeconds = DEFAULT_GUEST_TTS_TTL_SECONDS,
}: {
  room: string;
  identity: string;
  role?: GuestTtsRole;
  ttlSeconds?: number;
}) => {
  const secret = getGuestTtsSecret();
  const normalizedRoom = room.trim();
  const normalizedIdentity = identity.trim();
  if (!secret || !normalizedRoom || !normalizedIdentity) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const safeTtlSeconds = Math.max(60, Math.min(Math.floor(ttlSeconds), 60 * 60 * 24));
  const claims: GuestTtsClaims = {
    v: TOKEN_VERSION,
    scope: TOKEN_SCOPE,
    room: normalizedRoom,
    identity: normalizedIdentity,
    role,
    iat: nowSeconds,
    exp: nowSeconds + safeTtlSeconds,
    nonce: randomBytes(8).toString("hex"),
  };
  const payloadSegment = base64UrlEncode(JSON.stringify(claims));
  const signatureSegment = signPayload(payloadSegment, secret);
  return `${payloadSegment}.${signatureSegment}`;
};

export type GuestTtsTokenVerification =
  | { ok: true; claims: GuestTtsClaims }
  | { ok: false; reason: string };

export const verifyGuestTtsToken = (token: string): GuestTtsTokenVerification => {
  const secret = getGuestTtsSecret();
  if (!secret) return { ok: false, reason: "Guest TTS secret missing" };
  const raw = token.trim();
  if (!raw) return { ok: false, reason: "Guest token missing" };

  const parts = raw.split(".");
  if (parts.length !== 2) return { ok: false, reason: "Guest token malformed" };

  const [payloadSegment, signatureSegment] = parts;
  if (!payloadSegment || !signatureSegment) {
    return { ok: false, reason: "Guest token malformed" };
  }

  const expectedSignature = signPayload(payloadSegment, secret);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signatureSegment, "utf8");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return { ok: false, reason: "Guest token signature mismatch" };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(base64UrlDecode(payloadSegment));
  } catch {
    return { ok: false, reason: "Guest token payload invalid" };
  }
  if (!isGuestTtsClaims(claims)) {
    return { ok: false, reason: "Guest token payload malformed" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    return { ok: false, reason: "Guest token expired" };
  }

  return { ok: true, claims };
};
