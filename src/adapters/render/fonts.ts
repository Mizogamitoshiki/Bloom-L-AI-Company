/**
 * 画像生成用フォント読み込み。
 * Noto Sans JP(SIL Open Font License 1.1)を @fontsource/noto-sans-jp のwoffから読み込む。
 * ライセンス・出所は docs/assets-license.md に記録(確定§13)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../root";

export interface FontEntry {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let cached: FontEntry[] | null = null;

export function loadFonts(): FontEntry[] {
  if (cached) return cached;
  const dir = path.join(findRepoRoot(), "node_modules", "@fontsource", "noto-sans-jp", "files");
  cached = [
    {
      name: "Noto Sans JP",
      data: readFileSync(path.join(dir, "noto-sans-jp-japanese-400-normal.woff")),
      weight: 400,
      style: "normal",
    },
    {
      name: "Noto Sans JP",
      data: readFileSync(path.join(dir, "noto-sans-jp-japanese-700-normal.woff")),
      weight: 700,
      style: "normal",
    },
  ];
  return cached;
}
