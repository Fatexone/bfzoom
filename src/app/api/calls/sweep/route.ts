import { NextResponse } from "next/server";
import { expireStaleRingingCalls } from "@/lib/callSweep";

export const runtime = "nodejs";

const isAuthorized = (req: Request) => {
  const cronSecret = (process.env.CRON_SECRET || process.env.CALL_SWEEP_SECRET || "").trim();
  const authHeader = (req.headers.get("authorization") || "").trim();
  const xSecret = (req.headers.get("x-call-sweep-secret") || "").trim();
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (!cronSecret) {
    if (process.env.NODE_ENV !== "production") return true;
    return isVercelCron;
  }

  if (xSecret && xSecret === cronSecret) return true;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  return false;
};

const readLimit = (req: Request) => {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get("limit") || "");
    if (!Number.isFinite(raw)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
};

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await expireStaleRingingCalls({
      limit: readLimit(req),
    });
    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Call sweep failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
