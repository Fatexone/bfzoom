import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { addCorsHeaders, getAllowedOrigin } from "@/lib/cors";
import { createGuestTtsToken } from "@/lib/guestTtsToken";
import {
  LivekitInviteExpiredError,
  LivekitInviteNotFoundError,
  LivekitInviteRevokedError,
  LivekitInviteUsageExceededError,
  getLivekitInvite,
  redeemLivekitInvite,
} from "@/lib/livekitInvites";
import {
  hasActiveLivekitRoomSession,
} from "@/lib/livekitRoomRegistry";

export const runtime = "nodejs";

type RedeemInviteRequest = {
  invite?: string;
  identity?: string;
  name?: string;
  includeGuestTtsToken?: boolean;
};

const MAX_IDENTITY_LENGTH = 128;
const MAX_NAME_LENGTH = 80;

const buildGuestParticipantMetadata = (room: string) =>
  JSON.stringify({
    role: "guest",
    room,
  });

const isWebOrigin = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const extractRequestHost = (req: Request) => {
  const forwardedHost = req.headers.get("x-forwarded-host")?.trim();
  if (forwardedHost) {
    return forwardedHost.split(",")[0]?.trim().toLowerCase() || "";
  }
  return (req.headers.get("host") || "").trim().toLowerCase();
};

const isSameHostOrigin = (req: Request, requestOrigin: string) => {
  try {
    const originHost = new URL(requestOrigin).host.trim().toLowerCase();
    if (!originHost) return false;
    const requestHost = extractRequestHost(req);
    if (!requestHost) return false;
    return originHost === requestHost;
  } catch {
    return false;
  }
};

const jsonWithCors = (
  payload: Record<string, unknown>,
  status: number,
  origin: string | null,
  headers?: Record<string, string>
) => {
  const response = NextResponse.json(payload, {
    status,
    headers,
  });
  if (origin) {
    addCorsHeaders(response.headers, origin);
  }
  return response;
};

export async function OPTIONS(req: Request) {
  const origin = getAllowedOrigin(req.headers.get("origin"));
  if (!origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  addCorsHeaders(response.headers, origin);
  return response;
}

export async function POST(req: Request) {
  const requestOrigin = req.headers.get("origin");
  const sameHostOrigin =
    requestOrigin && isWebOrigin(requestOrigin) && isSameHostOrigin(req, requestOrigin)
      ? requestOrigin
      : null;
  const origin = sameHostOrigin || (requestOrigin ? getAllowedOrigin(requestOrigin) : null);
  if (requestOrigin && isWebOrigin(requestOrigin) && !origin) {
    return new Response("Forbidden", { status: 403 });
  }

  const apiKey = (process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = (process.env.LIVEKIT_API_SECRET || "").trim();
  if (!apiKey || !apiSecret) {
    return jsonWithCors({ error: "LiveKit server keys missing" }, 500, origin);
  }

  let body: RedeemInviteRequest;
  try {
    body = (await req.json()) as RedeemInviteRequest;
  } catch {
    return jsonWithCors({ error: "Invalid JSON" }, 400, origin);
  }

  const inviteId = (body.invite || "").trim();
  const identity = (body.identity || "").trim().slice(0, MAX_IDENTITY_LENGTH);
  const displayName = (body.name || "").trim().slice(0, MAX_NAME_LENGTH);
  if (!inviteId || !identity) {
    return jsonWithCors({ error: "Missing invite/identity" }, 400, origin);
  }

  try {
    const inviteRecord = await getLivekitInvite(inviteId);
    if (!inviteRecord) {
      return jsonWithCors({ error: "Invite not found." }, 404, origin);
    }
    if (inviteRecord.revokedAt) {
      return jsonWithCors({ error: "Invite revoked." }, 410, origin);
    }
    if (inviteRecord.expiresAt && inviteRecord.expiresAt.getTime() <= Date.now()) {
      return jsonWithCors({ error: "Invite expired." }, 410, origin);
    }

    const room = inviteRecord.room.trim();
    if (!room) {
      return jsonWithCors({ error: "Invite room is missing." }, 500, origin);
    }

    const activeSession = await hasActiveLivekitRoomSession(room);
    if (!activeSession) {
      return jsonWithCors({ error: "Invite is no longer active." }, 410, origin);
    }

    const invite = await redeemLivekitInvite(inviteId, identity);
    const redeemedRoom = invite.room.trim();
    if (!redeemedRoom) {
      return jsonWithCors({ error: "Invite room is missing." }, 500, origin);
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName || undefined,
      metadata: buildGuestParticipantMetadata(redeemedRoom),
    });
    token.addGrant({
      roomJoin: true,
      room: redeemedRoom,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();
    const guestTtsToken = body.includeGuestTtsToken
      ? createGuestTtsToken({
          room: redeemedRoom,
          identity,
          role: "guest",
        })
      : null;

    return jsonWithCors(
      {
        inviteId: invite.inviteId,
        room: redeemedRoom,
        token: jwt,
        guestTtsToken,
      },
      200,
      origin,
      {
        "Cache-Control": "no-store",
      }
    );
  } catch (error) {
    if (error instanceof LivekitInviteNotFoundError) {
      return jsonWithCors({ error: "Invite not found." }, 404, origin);
    }
    if (error instanceof LivekitInviteExpiredError) {
      return jsonWithCors({ error: "Invite expired." }, 410, origin);
    }
    if (error instanceof LivekitInviteRevokedError) {
      return jsonWithCors({ error: "Invite revoked." }, 410, origin);
    }
    if (error instanceof LivekitInviteUsageExceededError) {
      return jsonWithCors({ error: "Invite usage limit reached." }, 410, origin);
    }
    return jsonWithCors(
      {
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Unable to redeem invite.",
      },
      500,
      origin
    );
  }
}
