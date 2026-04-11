import { NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { getVerifiedUser } from "@/lib/serverAuth";
import { getLivekitTranslatorOrchestrator } from "@/lib/livekitTranslatorOrchestrator";
import { canManageLivekitRoom, markLivekitRoomEnded } from "@/lib/livekitRoomRegistry";
import { revokeLivekitInvitesForRoom } from "@/lib/livekitInvites";

export const runtime = "nodejs";

type EndRoomRequest = {
  room: string;
};

const isRoomNotFoundError = (message: string) =>
  /not found|room.*does not exist|unknown room|no such room|room not exist/i.test(
    (message || "").toLowerCase()
  );

export async function POST(req: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl =
    process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || "";

  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json(
      { error: "LiveKit server config missing" },
      { status: 500 }
    );
  }

  let body: EndRoomRequest;
  try {
    body = (await req.json()) as EndRoomRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const room = (body.room || "").trim();
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

  const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);
  const orchestrator = getLivekitTranslatorOrchestrator();
  await markLivekitRoomEnded(room);
  const revokedInvites = await revokeLivekitInvitesForRoom(room);

  let roomClosed = false;
  try {
    await client.deleteRoom(room);
    roomClosed = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "LiveKit error";
    if (!isRoomNotFoundError(message)) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const translatorResult = orchestrator.stopRoom(room, "ended_by_host");

  return NextResponse.json({
    ok: true,
    room,
    roomClosed,
    revokedInvites,
    translator: translatorResult,
  });
}
