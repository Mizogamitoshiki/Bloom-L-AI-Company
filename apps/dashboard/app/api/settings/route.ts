import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { getOperationSettings, updateOperationSettings } from "@adapters/db/store";
import { loadLimits, loadModelProfilesRaw, brandStatus } from "@adapters/config";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";
import { getInstagramReadiness } from "@adapters/instagram/publish";

export const dynamic = "force-dynamic";

/** 運用設定 + 参照情報(limits/model-profiles/brand)。参照はUIから直接編集しない(V4-D) */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json({
        operation: getOperationSettings(db),
        refs: {
          limits: loadLimits(),
          modelProfiles: loadModelProfilesRaw(),
          brand: brandStatus(),
          apiEnabled: false, // Anthropic APIは引き続き無効
          instagram: getInstagramReadiness(), // 秘密値を含まない接続状態だけ返す
        },
      });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}

/** 運用設定の更新(owner専用・Zod検証・audit setting_changed) */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertOwnerRequest(req);
    const body: unknown = await req.json();
    const { db, sqlite } = openDb();
    try {
      const next = updateOperationSettings(db, body, "owner");
      return NextResponse.json({ ok: true, operation: next });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
