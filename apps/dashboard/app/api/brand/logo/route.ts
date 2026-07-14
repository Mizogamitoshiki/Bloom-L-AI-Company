import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "@adapters/root";
import { loadBrandManifest } from "@adapters/config";

export const dynamic = "force-dynamic";

/**
 * 正式ブランドロゴの配信(V3 UI Polish)。
 * data/workspace/01_brand/ 配下の brand-manifest.json が指すロゴファイルのみを返す。
 * ロゴはgitignore下の実素材で、コード変更なしで差し替え可能(docs/13, V3-K)。
 */
export function GET(): NextResponse {
  try {
    const brandDir = path.join(findRepoRoot(), "data", "workspace", "01_brand");
    const manifest = loadBrandManifest();
    const file = manifest?.logo?.file ?? "logo.png";
    // マニフェスト由来のファイル名以外は配信しない(パストラバーサル防止)
    if (file.includes("/") || file.includes("\\") || file.includes("..")) {
      return NextResponse.json({ error: "invalid logo path" }, { status: 400 });
    }
    const abs = path.join(brandDir, file);
    if (!abs.startsWith(brandDir + path.sep)) {
      return NextResponse.json({ error: "invalid logo path" }, { status: 400 });
    }
    const buf = readFileSync(abs);
    const type = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  } catch {
    // 未配置時は404(UI側はテキストのプレースホルダーにフォールバックせず、ロゴ枠を空で扱う)
    return NextResponse.json({ error: "logo not found" }, { status: 404 });
  }
}
