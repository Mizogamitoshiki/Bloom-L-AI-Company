/**
 * 公開コンテンツの通常コード検査(V3-A)。AIの自己申告に依存しない。
 * - 禁止語・禁止表現(config/forbidden-phrases.yaml)
 * - 「最新」・統計系表現のsource要求判定(config/qa-rules.yaml)
 */
import { z } from "zod";
import type { Copy, NewsCopy, PortfolioCopy, CompareCopy, SampleCopy } from "./schemas";

export const forbiddenConfigSchema = z.object({
  categories: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      patterns: z.array(z.string().min(1)),
    }),
  ),
});
export type ForbiddenConfig = z.infer<typeof forbiddenConfigSchema>;

export const qaRulesSchema = z.object({
  pass_requires_all_checklist_ok: z.boolean(),
  pass_requires_no_issues: z.boolean(),
  require_sources_for_pillars: z.array(z.string()),
  latest_phrases: z.array(z.string()),
  source_required_patterns: z.array(z.string()),
  min_sources_for_strong_claims: z.number().int().min(1),
});
export type QaRules = z.infer<typeof qaRulesSchema>;

export interface ForbiddenHit {
  category: string;
  label: string;
  pattern: string;
  sample: string;
}

/** 公開されるテキストを全コピー種別から抽出する */
export function collectPublicText(copy: Copy | NewsCopy | PortfolioCopy | CompareCopy | SampleCopy): string {
  const parts: string[] = [copy.headline, copy.body, copy.cta, ...copy.hashtags];
  const s = copy.slides as Record<string, unknown>;
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(s);
  return parts.join("\n");
}

export function scanForbidden(text: string, config: ForbiddenConfig): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const cat of config.categories) {
    for (const pattern of cat.patterns) {
      const re = new RegExp(pattern, "u");
      const m = re.exec(text);
      if (m) {
        hits.push({ category: cat.key, label: cat.label, pattern, sample: m[0].slice(0, 40) });
      }
    }
  }
  return hits;
}

/** 「最新」等の語が含まれるか(source日付要求の判定に使用) */
export function containsLatestPhrase(text: string, rules: QaRules): string | null {
  for (const phrase of rules.latest_phrases) {
    if (text.includes(phrase)) return phrase;
  }
  return null;
}

/** 統計・調査系のsource必須パターンに一致するか */
export function matchesSourceRequiredPattern(text: string, rules: QaRules): string | null {
  for (const pattern of rules.source_required_patterns) {
    if (new RegExp(pattern, "u").test(text)) return pattern;
  }
  return null;
}

/**
 * 無根拠な成果断定の検出(V4.5 v2 §4)。許可済みtestimonial・入力済みmetric等の根拠がない場合、
 * 「増えた・減った・改善した・成果が出た・向上した」等の断定を禁止する。
 * 根拠がある場合(hasEvidence=true)は許容する。根拠がなければ実装内容・設計意図として表現させる。
 */
export const UNSUPPORTED_CLAIM_PATTERNS: RegExp[] = [
  /増え(た|ました|ています)/u,
  /減(った|りました|っています)/u,
  /改善(した|しました|されました)/u,
  /成果が出(た|ました|ています)/u,
  /向上(した|しました)/u,
  /アップ(した|しました)/u,
  /(売上|集客|問い合わせ|予約|反響|来店|フォロワー)が(増|伸)/u,
  /効果が(あった|ありました|出た)/u,
];

export function scanUnsupportedClaims(text: string, hasEvidence: boolean): string[] {
  if (hasEvidence) return [];
  const hits: string[] = [];
  for (const re of UNSUPPORTED_CLAIM_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}
