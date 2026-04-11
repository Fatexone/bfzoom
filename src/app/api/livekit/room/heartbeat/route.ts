import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/serverAuth";
import {
  canManageLivekitRoom,
  touchLivekitRoomHeartbeat,
} from "@/lib/livekitRoomRegistry";

export const runtime = "nodejs";

type RoomHeartbeatRequest = {
  room?: string;
};

export async function POST(req: Request) {
  let body: RoomHeartbeatRequest;
  try {
    body = (await req.json()) as RoomHeartbeatRequest;
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

  const heartbeatStatus = await touchLivekitRoomHeartbeat(room);
  if (heartbeatStatus === "missing") {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }
  if (heartbeatStatus === "ended") {
    return NextResponse.json({ error: "Room already ended." }, { status: 410 });
  }
  return NextResponse.json({ ok: true, room });
}
