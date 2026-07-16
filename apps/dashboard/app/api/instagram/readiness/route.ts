import { NextResponse } from "next/server";
import { getInstagramReadiness } from "@adapters/instagram/publish";

export const dynamic = "force-dynamic";

/** 秘密値を含まないInstagram公式API接続状態。 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getInstagramReadiness(), {
    headers: { "Cache-Control": "no-store" },
  });
}
