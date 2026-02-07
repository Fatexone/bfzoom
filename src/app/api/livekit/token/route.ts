import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";
import { addCorsHeaders, getAllowedOrigin } from "@/lib/cors";

export const runtime = "nodejs";

type TokenRequest = {
  room: string;
  identity: string;
  name?: string;
  role?: "host" | "guest";
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
  const origin = getAllowedOrigin(req.headers.get("origin"));
  if (!origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    const response = NextResponse.json({ error: "LiveKit server keys missing" }, { status: 500 });
    addCorsHeaders(response.headers, origin);
    return response;
  }

  let body: TokenRequest;
  try {
    body = (await req.json()) as TokenRequest;
  } catch {
    const response = NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    addCorsHeaders(response.headers, origin);
    return response;
  }

  const { room, identity, name } = body;
  if (!room || !identity) {
    const response = NextResponse.json({ error: "Missing room/identity" }, { status: 400 });
    addCorsHeaders(response.headers, origin);
    return response;
  }

  if (body.role === "host") {
    const user = await getVerifiedUser(req);
    if (!user.ok) {
      const response = NextResponse.json({ error: user.error }, { status: user.status });
      addCorsHeaders(response.headers, origin);
      return response;
    }
    const allowed = await isEmailAllowlisted(user.email);
    if (!allowed) {
      const response = NextResponse.json({ error: "Forbidden" }, { status: 403 });
      addCorsHeaders(response.headers, origin);
      return response;
    }
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  if (body.role === "host") {
    token.addGrant({
      roomAdmin: true,
      room,
    });
  }

  const jwt = await token.toJwt();
  const response = new NextResponse(jwt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  addCorsHeaders(response.headers, origin);
  return response;
}