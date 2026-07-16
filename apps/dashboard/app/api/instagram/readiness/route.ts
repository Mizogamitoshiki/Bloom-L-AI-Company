import { NextResponse } from "next/server";
import { getInstagramReadiness } from "@adapters/instagram/publish";
import { VercelBlobStorage } from "@adapters/storage/vercel-blob";

export const dynamic = "force-dynamic";

/** 秘密値を含まないInstagram公式API接続状態(V5.2: ストレージ設定状態を含む)。 */
export async function GET(): Promise<NextResponse> {
  const storage = new VercelBlobStorage();
  return NextResponse.json(
    { ...getInstagramReadiness(), storageProvider: storage.provider, storageConfigured: storage.isConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
