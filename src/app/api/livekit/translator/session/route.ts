import { NextResponse } from "next/server";
import { getLivekitTranslatorOrchestrator } from "@/lib/livekitTranslatorOrchestrator";
import { canManageLivekitRoom } from "@/lib/livekitRoomRegistry";
import { getVerifiedUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

type TranslatorSessionRequest = {
  action?: "ensure" | "release";
  room?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  voice?: string;
};

const DEFAULT_PUBLIC_APP_URL = "https://www.bfzoom.fr";

const resolveApiBaseUrl = (req: Request) => {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  try {
    return new URL(req.url).origin.trim().replace(/\/+$/, "");
  } catch {
    return DEFAULT_PUBLIC_APP_URL;
  }
};

const isInfrastructureIssue = (message: string) =>
  /missing|not found|unable to start|config/i.test((message || "").toLowerCase());

export async function POST(req: Request) {
  let body: TranslatorSessionRequest;
  try {
    body = (await req.json()) as TranslatorSessionRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = (body.action || "").trim().toLowerCase();
  const room = (body.room || "").trim();
  if (action !== "ensure" && action !== "release") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (!room) {
    return NextResponse.json({ error: "Missing room" }, { status: 400 });
  }

  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const roomAccess = await canManageLivekitRoom({
    room,
    uid: user.uid,
    email: user.email,
  });
  if (!roomAccess.ok) {
    return NextResponse.json(
      { error: "Forbidden", detail: roomAccess.reason },
      { status: 403 }
    );
  }

  const orchestrator = getLivekitTranslatorOrchestrator();
  const ownerKey = `${user.uid}:${room}`;

  if (action === "release") {
    return NextResponse.json({
      ok: true,
      room,
      action,
      translator: orchestrator.release(ownerKey, room),
    });
  }

  const sourceLanguage = (body.sourceLanguage || "").trim().toLowerCase();
  const targetLanguage = (body.targetLanguage || "").trim().toLowerCase();
  const voice = (body.voice || "alloy").trim().toLowerCase();
  const livekitUrl =
    (process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || "")
      .trim()
      .replace(/\/+$/, "");

  if (!sourceLanguage || !targetLanguage) {
    return NextResponse.json(
      { error: "Missing sourceLanguage/targetLanguage" },
      { status: 400 }
    );
  }
  if (!livekitUrl) {
    return NextResponse.json(
      { error: "LiveKit server config missing" },
      { status: 500 }
    );
  }

  try {
    const translator = orchestrator.ensure(ownerKey, {
      room,
      sourceLanguage,
      targetLanguage,
      voice,
      apiBaseUrl: resolveApiBaseUrl(req),
      livekitUrl,
    });
    return NextResponse.json({
      ok: true,
      room,
      action,
      translator,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Translator worker unavailable.";
    return NextResponse.json(
      {
        error: "Translator worker unavailable.",
        detail,
      },
      { status: isInfrastructureIssue(detail) ? 503 : 500 }
    );
  }
}
