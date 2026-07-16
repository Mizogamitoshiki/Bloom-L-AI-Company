/**
 * テンプレート版fingerprint(V4.5 v2 P0-1)。
 * レンダリングに影響する「実装コード・共通component・design-system・登録variant一覧・
 * schema version・brand token・logo hash」をすべてmaterialに含めてSHA-256する。
 * → レイアウト実装やcomponentやvariant集合が変われば、DESIGN_SYSTEM_VERSIONの手動更新に頼らず
 *   必ずfingerprintが変わる。読み込み失敗・digest失敗は fail closed(例外)。
 * materialの収集(fs依存)と digest(純関数)を分離し、テスト可能にする。
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { findRepoRoot } from "../root";
import { TEMPLATES } from "../../core/templates/index";
import {
  serializeTokens, DESIGN_SYSTEM_VERSION, CAROUSEL_SCHEMA_VERSION, type Theme,
} from "../../core/templates/design-system";
import { loadTheme } from "./theme";

export class FingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FingerprintError";
  }
}

/** レンダリングに影響する共通ソース(全テンプレート共通) */
const SHARED_SOURCES = ["design-system.ts", "components.ts", "index.ts", "family-util.ts"] as const;
/** テンプレートIDごとの実装ファイル */
const TEMPLATE_SOURCE: Record<string, string> = {
  "tpl-howto": "tpl-howto.ts",
  "tpl-news": "tpl-news.ts",
  "tpl-portfolio": "tpl-portfolio.ts",
  "tpl-compare": "tpl-compare.ts",
};
/** 系統固有のレンダリング依存。変更時は該当系統だけfingerprintを更新する。 */
const TEMPLATE_EXTRA_SOURCES: Record<string, readonly string[]> = {
  "tpl-portfolio": ["../../adapters/render/portfolio-media.ts"],
};

/** fingerprintのmaterial(この内容が変わればfingerprintが変わる)。純データ */
export interface FingerprintMaterial {
  designSystemVersion: string;
  schemaVersion: string;
  tokens: string;
  colors: Record<string, string>;
  logoSha: string;
  templateId: string;
  version: number;
  variants: string[];
  /** ソースファイル名 → 内容のSHA-256(実装コードの変更を検知) */
  sourceHashes: Record<string, string>;
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * fingerprint materialを収集する(fs依存)。対象ソースを読み込めない場合は fail closed。
 * templatesRoot は既定でリポジトリの src/core/templates。
 */
export function collectFingerprintMaterial(
  templateId: string,
  version: number,
  theme: Theme = loadTheme(),
  templatesRoot: string = path.join(findRepoRoot(), "src", "core", "templates"),
): FingerprintMaterial {
  const tpl = (TEMPLATES as Record<string, { variants: readonly string[] }>)[templateId];
  if (!tpl) throw new FingerprintError(`不明なテンプレートID: ${templateId}`);
  const templateFile = TEMPLATE_SOURCE[templateId];
  if (!templateFile) throw new FingerprintError(`テンプレート実装ファイルが未登録: ${templateId}`);

  const files = [...SHARED_SOURCES, templateFile, ...(TEMPLATE_EXTRA_SOURCES[templateId] ?? [])];
  const sourceHashes: Record<string, string> = {};
  for (const f of files) {
    try {
      sourceHashes[f] = sha256(readFileSync(path.join(templatesRoot, f)));
    } catch (err) {
      // fail closed: レンダリング実装を確認できない状態でfingerprintを算出しない
      throw new FingerprintError(`fingerprint material読込失敗(${f}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    schemaVersion: CAROUSEL_SCHEMA_VERSION,
    tokens: serializeTokens(),
    colors: { ...theme.colors } as Record<string, string>,
    logoSha: theme.logo?.sha256 ?? "no-logo",
    templateId,
    version,
    variants: [...tpl.variants].sort(),
    sourceHashes,
  };
}

/** ネストしたキーも再帰的にソートして安定化する(キー順に依存しない決定的シリアライズ) */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/** materialからfingerprintを算出する純関数(テスト用に分離)。materialが同じなら決定的に同一 */
export function computeFingerprintFromMaterial(material: FingerprintMaterial): string {
  if (!material.templateId || !material.tokens) throw new FingerprintError("fingerprint materialが不完全です");
  return sha256(stableStringify(material));
}

/** テンプレート版のfingerprint(material収集 → digest) */
export function computeFingerprint(templateId: string, version: number, theme: Theme = loadTheme()): string {
  return computeFingerprintFromMaterial(collectFingerprintMaterial(templateId, version, theme));
}
