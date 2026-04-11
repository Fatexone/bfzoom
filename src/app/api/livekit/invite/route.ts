import { NextResponse } from "next/server";
import { canManageLivekitRoom, getLivekitRoomHost } from "@/lib/livekitRoomRegistry";
import { createLivekitInvite } from "@/lib/livekitInvites";
import { getVerifiedUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

type CreateInviteRequest = {
  room: string;
};

export async function POST(req: Request) {
  let body: CreateInviteRequest;
  try {
    body = (await req.json()) as CreateInviteRequest;
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

  try {
    const roomHost = await getLivekitRoomHost(room);
    const invite = await createLivekitInvite({
      room,
      hostUid: user.uid,
      hostEmail: user.email,
      hostIdentity: roomHost?.hostIdentity || "",
    });
    return NextResponse.json({
      ok: true,
      inviteId: invite.inviteId,
      room: invite.room,
      expiresAt: invite.expiresAt?.toISOString() || null,
      maxUses: invite.maxUses,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Unable to create invite.",
      },
      { status: 500 }
    );
  }
}
