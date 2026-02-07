import { NextResponse } from "next/server";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";

export const runtime = "nodejs";

type ModerateRequest = {
  room: string;
  identity: string;
  action: "mute" | "kick";
};

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

  let body: ModerateRequest;
  try {
    body = (await req.json()) as ModerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.room || !body.identity || !body.action) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }
  const allowed = await isEmailAllowlisted(user.email);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);

  try {
    if (body.action === "kick") {
      await client.removeParticipant(body.room, body.identity);
      return NextResponse.json({ ok: true });
    }

    const participants = await client.listParticipants(body.room);
    const target = participants.find((p) => p.identity === body.identity);
    if (!target) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    const audioTracks = target.tracks.filter(
      (track) => track.source === TrackSource.MICROPHONE
    );
    for (const track of audioTracks) {
      await client.mutePublishedTrack(body.room, body.identity, track.sid, true);
    }

    return NextResponse.json({ ok: true, muted: audioTracks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LiveKit error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}