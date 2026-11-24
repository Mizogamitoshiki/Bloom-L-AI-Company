import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "@adapters/root";

export const dynamic = "force-dynamic";

export interface StoryItem {
  name: string;
  url: string;
  bytes: number;
  updatedAt: string;
}

/**
 * V8(D-18): Instagramストーリー画像の一覧。data/workspace/08_stories 配下の 1080x1920 PNG。
 * ストーリーはCanvaで作成し、代表者がここからダウンロードしてInstagramアプリで手動投稿する
 * (ストーリーはフィード投稿と違い24hで消える簡易メディアのため、承認パイプラインには載せない)。
 */
export function GET(): NextResponse {
  try {
    const dir = path.join(workspaceRoot(), "08_stories");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const items: StoryItem[] = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .map((name) => {
        const st = statSync(path.join(dir, name));
        return { name, url: `/api/stories/${encodeURIComponent(name)}`, bytes: st.size, updatedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "取得に失敗しました" }, { status: 500 });
  }
}
