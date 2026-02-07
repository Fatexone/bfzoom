import { NextRequest, NextResponse } from "next/server";
import { addCorsHeaders, getAllowedOrigin } from "./src/lib/cors";

export function middleware(req: NextRequest) {
  const origin = getAllowedOrigin(req.headers.get("origin"));
  if (!origin) {
    return NextResponse.next();
  }

  if (req.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    addCorsHeaders(response.headers, origin);
    return response;
  }

  const response = NextResponse.next();
  addCorsHeaders(response.headers, origin);
  return response;
}

export const config = {
  matcher: ["/:path*"],
};