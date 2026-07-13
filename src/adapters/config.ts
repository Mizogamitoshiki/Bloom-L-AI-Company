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

export function loadBrandTokens(root: string = findRepoRoot()): BrandTokens {
  const raw = readFileSync(path.join(root, "config", "brand-tokens.json"), "utf8");
  const parsed = JSON.parse(raw) as BrandTokens;
  return { placeholder: parsed.placeholder !== false, colors: parsed.colors ?? {} };
}
