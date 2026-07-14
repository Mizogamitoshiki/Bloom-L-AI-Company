/**
 * 設定ファイル読み込み(config/limits.yaml, config/brand-tokens.json)。
 * 検証はZod(不正な設定で起動しない)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { limitsSchema, type Limits } from "../core/schemas";
import { findRepoRoot } from "./root";

let cachedLimits: Limits | null = null;

export function loadLimits(root: string = findRepoRoot()): Limits {
  if (cachedLimits) return cachedLimits;
  const raw = readFileSync(path.join(root, "config", "limits.yaml"), "utf8");
  cachedLimits = limitsSchema.parse(parseYaml(raw));
  return cachedLimits;
}

export interface BrandTokens {
  placeholder: boolean;
  colors: Record<string, string>;
}

/**
 * ブランドトークン。brand-manifest.json(01_brand/)にcolorsがあればコード変更なしでそれを使い、
 * なければ config/brand-tokens.json(プレースホルダー)にフォールバックする(V3-K)。
 */
export function loadBrandTokens(root: string = findRepoRoot()): BrandTokens {
  try {
    const manifest = loadBrandManifest(root);
    if (manifest?.colors && Object.keys(manifest.colors).length > 0) {
      return { placeholder: false, colors: manifest.colors };
    }
  } catch {
    // 不正なmanifestはフォールバック(doctorが警告する)
  }
  const raw = readFileSync(path.join(root, "config", "brand-tokens.json"), "utf8");
  const parsed = JSON.parse(raw) as BrandTokens;
  return { placeholder: parsed.placeholder !== false, colors: parsed.colors ?? {} };
}

// ---- V3: 禁止語・QAルール(キャッシュ付き) ----
import {
  forbiddenConfigSchema,
  qaRulesSchema,
  type ForbiddenConfig,
  type QaRules,
} from "../core/guards";

let cachedForbidden: ForbiddenConfig | null = null;
let cachedQaRules: QaRules | null = null;

export function loadForbiddenPhrases(root: string = findRepoRoot()): ForbiddenConfig {
  if (cachedForbidden) return cachedForbidden;
  cachedForbidden = forbiddenConfigSchema.parse(
    parseYaml(readFileSync(path.join(root, "config", "forbidden-phrases.yaml"), "utf8")),
  );
  return cachedForbidden;
}

export function loadQaRules(root: string = findRepoRoot()): QaRules {
  if (cachedQaRules) return cachedQaRules;
  cachedQaRules = qaRulesSchema.parse(parseYaml(readFileSync(path.join(root, "config", "qa-rules.yaml"), "utf8")));
  return cachedQaRules;
}

// ---- V3-K: ブランドマニフェスト ----
// data/workspace/01_brand/brand-manifest.json を配置すると、コード変更なしで
// ブランドカラー・ロゴ・フォント・利用ルールが読み込まれる(未配置時はプレースホルダーで動作)。
import { readdirSync, existsSync } from "node:fs";
import { z } from "zod";

export const brandManifestSchema = z
  .object({
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rights: z.string().min(1).max(500), // 権利情報(例: 「Bloom-L所有。第三者素材なし」)
    logo: z
      .object({
        file: z.string().min(1).max(100), // 01_brand/ 内の相対ファイル名(logo.svg等)
        usage: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
    colors: z.record(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
    fonts: z
      .array(z.object({ name: z.string().max(60), license: z.string().max(120), file: z.string().max(100).optional() }).strict())
      .optional(),
    rules: z.array(z.string().max(300)).default([]),
  })
  .strict();
export type BrandManifest = z.infer<typeof brandManifestSchema>;

export function loadBrandManifest(root: string = findRepoRoot()): BrandManifest | null {
  const file = path.join(root, "data", "workspace", "01_brand", "brand-manifest.json");
  if (!existsSync(file)) return null;
  return brandManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export interface BrandStatus {
  placeholder: boolean;
  logoPresent: boolean;
  manifest: BrandManifest | null;
}

/** ブランド素材の受け入れ状態(V3-K)。manifestがあればそれを正とする */
export function brandStatus(root: string = findRepoRoot()): BrandStatus {
  let manifest: BrandManifest | null = null;
  try {
    manifest = loadBrandManifest(root);
  } catch {
    manifest = null; // 不正なmanifestはプレースホルダー扱い(doctorが警告する)
  }
  const brandDir = path.join(root, "data", "workspace", "01_brand");
  let logoPresent = false;
  try {
    const files = readdirSync(brandDir);
    const logoFile = manifest?.logo?.file;
    logoPresent = logoFile ? files.includes(logoFile) : files.some((f) => /^logo\.(png|svg)$/i.test(f));
  } catch {
    logoPresent = false;
  }
  const tokens = loadBrandTokensRaw(root);
  return { placeholder: !manifest?.colors && tokens.placeholder, logoPresent, manifest };
}

function loadBrandTokensRaw(root: string): BrandTokens {
  const raw = readFileSync(path.join(root, "config", "brand-tokens.json"), "utf8");
  const parsed = JSON.parse(raw) as BrandTokens;
  return { placeholder: parsed.placeholder !== false, colors: parsed.colors ?? {} };
}
