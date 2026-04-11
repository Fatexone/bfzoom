import { NextResponse } from "next/server";
import { getIosIapPackConfigs } from "@/lib/iapIosConfig";
import { getAuthenticatedUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user.ok) {
    return NextResponse.json({ error: user.error }, { status: user.status });
  }

  const packs = getIosIapPackConfigs().map((pack) => ({
    productId: pack.productId,
    minutes: pack.minutes,
    seconds: pack.seconds,
  }));

  return NextResponse.json(
    {
      ok: true,
      packs,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
