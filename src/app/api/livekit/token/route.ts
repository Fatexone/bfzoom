import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { canUseRoomFeatures } from "@/lib/roomAccess";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { addCorsHeaders, getAllowedOrigin } from "@/lib/cors";
import { buildTranslatorMetadata, isTranslatorIdentity } from "@/lib/livekitTranslator";
import { createGuestTtsToken } from "@/lib/guestTtsToken";
import { upsertLivekitRoomHost } from "@/lib/livekitRoomRegistry";

export const runtime = "nodejs";

type TokenRequest = {
  room: string;
  identity: string;
  name?: string;
  role?: "host" | "guest" | "translator";
  sessionMode?: "conference" | "chat";
  sourceLanguage?: string;
  targetLanguage?: string;
  voice?: string;
  includeGuestTtsToken?: boolean;
};

const buildHumanParticipantMetadata = (role: "host" | "guest", room: string) =>
  JSON.stringify({
    role,
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
  // Keep strict checks for browser origins, but don't block native app schemes.
  if (requestOrigin && isWebOrigin(requestOrigin) && !origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    const response = NextResponse.json({ error: "LiveKit server keys missing" }, { status: 500 });
    if (origin) {
      addCorsHeaders(response.headers, origin);
    }
    return response;
  }

  let body: TokenRequest;
  try {
    body = (await req.json()) as TokenRequest;
  } catch {
    const response = NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    if (origin) {
      addCorsHeaders(response.headers, origin);
    }
    return response;
  }

  const { room, identity, name } = body;
  if (!room || !identity) {
    const response = NextResponse.json({ error: "Missing room/identity" }, { status: 400 });
    if (origin) {
      addCorsHeaders(response.headers, origin);
    }
    return response;
  }

  const requestedRole = body.role || "guest";
  const sessionMode = body.sessionMode === "chat" ? "chat" : "conference";
  let verifiedUser:
    | {
        uid: string;
        email: string;
      }
    | null = null;

  if (requestedRole === "guest") {
    if (sessionMode !== "chat") {
      const response = NextResponse.json(
        { error: "Guests must join with a BFZoom invite." },
        { status: 403 }
      );
      if (origin) {
        addCorsHeaders(response.headers, origin);
      }
      return response;
    }
    const user = await getVerifiedUser(req);
    if (!user.ok) {
      const response = NextResponse.json({ error: user.error }, { status: user.status });
      if (origin) {
        addCorsHeaders(response.headers, origin);
      }
      return response;
    }
    verifiedUser = { uid: user.uid, email: user.email };
  }

  const workerSecret = (process.env.TRANSLATOR_WORKER_SECRET || "").trim();
  const workerAuthorized =
    requestedRole === "translator" &&
    Boolean(workerSecret) &&
    (req.headers.get("x-translator-worker-secret") || "").trim() === workerSecret;

  if (requestedRole === "host" || (requestedRole === "translator" && !workerAuthorized)) {
    const user = await getVerifiedUser(req);
    if (!user.ok) {
      const response = NextResponse.json({ error: user.error }, { status: user.status });
      if (origin) {
        addCorsHeaders(response.headers, origin);
      }
      return response;
    }
    const allowlisted = await isEmailAllowlisted(user.email);
    const allowed = canUseRoomFeatures(allowlisted);
    if (!allowed) {
      const response = NextResponse.json(
        { error: "Forbidden", detail: "Host account is not authorized for room creation." },
        { status: 403 }
      );
      if (origin) {
        addCorsHeaders(response.headers, origin);
      }
      return response;
    }
    verifiedUser = { uid: user.uid, email: user.email };
  }

  const metadata =
    requestedRole === "translator" || isTranslatorIdentity(identity)
      ? JSON.stringify(
          buildTranslatorMetadata({
            room,
            sourceLanguage: body.sourceLanguage,
            targetLanguage: body.targetLanguage || "en",
            voice: body.voice,
          })
        )
      : buildHumanParticipantMetadata(requestedRole === "host" ? "host" : "guest", room);

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    metadata,
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  if (requestedRole === "host") {
    token.addGrant({
      roomAdmin: true,
      room,
    });
  }

  const jwt = await token.toJwt();

  if (requestedRole === "host" && verifiedUser) {
    try {
      await upsertLivekitRoomHost({
        room,
        hostUid: verifiedUser.uid,
        hostEmail: verifiedUser.email,
        hostIdentity: identity,
      });
    } catch {
      const response = NextResponse.json(
        { error: "Unable to register room host ownership." },
        { status: 500 }
      );
      if (origin) {
        addCorsHeaders(response.headers, origin);
      }
      return response;
    }
  }

  if (body.includeGuestTtsToken) {
    const guestTtsToken =
      requestedRole === "translator"
        ? null
        : createGuestTtsToken({
            room,
            identity,
            role: requestedRole === "host" ? "host" : "guest",
          });

    const response = NextResponse.json(
      {
        token: jwt,
        guestTtsToken,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
    if (origin) {
      addCorsHeaders(response.headers, origin);
    }
    return response;
  }

  const response = new NextResponse(jwt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  if (origin) {
    addCorsHeaders(response.headers, origin);
  }
  return response;
}
