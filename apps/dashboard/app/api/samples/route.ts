import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { listSampleRequests, createSampleRequest } from "@adapters/db/samples";
import { sampleRequestInputSchema } from "@core/schemas";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V10.2: サンプル依頼(intake)一覧。?status= で絞り込み可(new|building|qa|ready|posted|declined) */
export function GET(req: Request): NextResponse {
  try {
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(listSampleRequests(db, status || undefined));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}

/**
 * 代表者専用: サンプル依頼の登録。attest=true(素材の権利宣言)が無いものは構造的に拒否する。
 * Zodの生エラーは出さず、項目名付きの日本語メッセージへ変換して返す。
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertOwnerRequest(req);
    const parsed = sampleRequestInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || "入力"}: ${i.message}`).join(" / "));
    }
    const { db, sqlite } = openDb();
    try {
      const row = createSampleRequest(db, parsed.data, "owner");
      return NextResponse.json({ ok: true, requestId: row.id });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
