import { NextResponse } from "next/server";
import { canUseRoomFeatures, getRoomAccessMode } from "@/lib/roomAccess";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const allowlisted = await isEmailAllowlisted(user.email);
  const allowed = canUseRoomFeatures(allowlisted);
  return NextResponse.json({
    allowed,
    allowlisted,
    accessMode: getRoomAccessMode(),
    email: user.email,
  });
}
