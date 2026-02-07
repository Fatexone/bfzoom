import { NextResponse } from "next/server";
import { getVerifiedUser, isEmailAllowlisted } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getVerifiedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const allowed = await isEmailAllowlisted(user.email);
  return NextResponse.json({ allowed, email: user.email });
}