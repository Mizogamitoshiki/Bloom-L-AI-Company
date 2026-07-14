import { NextResponse } from "next/server";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "@adapters/root";
import { EVIDENCE_DIR } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * 証跡ファイルの一覧(V3再レビューP1-3)。
 * 代表者が既存の証跡を安全に「選択」できるよう、07_customer-permissions/直下の
 * 通常ファイル名のみを返す(内容は配信しない)。
 */
export function GET(): NextResponse {
  try {
    const dir = path.join(findRepoRoot(), "data", "workspace", EVIDENCE_DIR);
    let files: string[] = [];
    try {
      files = readdirSync(dir)
        .filter((name) => {
          if (name.startsWith(".")) return false;
          try {
            return statSync(path.join(dir, name)).isFile();
          } catch {
            return false;
          }
        })
        .map((name) => `${EVIDENCE_DIR}/${name}`);
    } catch {
      files = []; // フォルダ未作成
    }
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
