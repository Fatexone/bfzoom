import { NextResponse } from "next/server";
import { getAppleAppSiteAssociationPayload } from "@/lib/appleAppSiteAssociation";

export const revalidate = 3600;

export async function GET() {
  return new NextResponse(JSON.stringify(getAppleAppSiteAssociationPayload()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
