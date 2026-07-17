/**
 * V6-A/B: 投稿後分析のファクトモデル(純関数・決定的)。
 * - 数値計算・率計算・欠損判定・中央値はすべてここ(通常コード)で行う。AIは再計算しない
 * - 未取得(null)と0を厳密に区別する。欠損の0埋め・推定補完はしない
 * - 率は分母(reach)が正の数のときだけ計算する。reachがnull/0なら率もnull
 * - 3日窓と7日窓を混ぜない(windowDaysごとに別のファクトを生成する)
 * - 計測済み投稿が10本未満の間は統計的断定を構造的に禁止する(exploratory/warnings/禁止語検査)
 * - Node/ブラウザ依存なし(hash計算・DBアクセスはadapters側)
 */
import { businessDateFromIso } from "./ids";

export const ANALYSIS_WINDOWS = [3, 7] as const;
export type AnalysisWindow = (typeof ANALYSIS_WINDOWS)[number];

/** 断定表現の下限。計測済み投稿がこれ未満の間、優劣・成功の断定を禁止する(docs/15 §5) */
export const MIN_POSTS_FOR_TREND = 10;

export const METRIC_KEYS = ["reach", "profileViews", "saves", "shares", "comments", "dmStarts", "followerCount"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const RATE_KEYS = ["saveRate", "shareRate", "profileViewRate", "dmStartRate", "commentRate"] as const;
export type RateKey = (typeof RATE_KEYS)[number];

export interface PostMetricValues {
  reach: number | null;
  profileViews: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  dmStarts: number | null;
  followerCount: number | null;
  measuredAt: string;
}

/** 分析入力(adaptersがDBから構築する)。公開済み(published/measured)投稿のみ */
export interface AnalyticsPostInput {
  postId: string;
  title: string;
  pillar: string;
  format: string;
  templateId: string;
  templateVersion: number | null;
  variant: string | null;
  /** 最新copy成果物のCTA文(なければnull)。AIが再構成しない生の値 */
  cta: string | null;
  publishedAt: string | null;
  /** この計測窓の入力期限(公開日+windowDays。JST業務日) */
  metricDueOn: string | null;
  /** この計測窓のpost_metrics(未入力ならnull。0で埋めない) */
  metrics: PostMetricValues | null;
}

export interface RateValues {
  saveRate: number | null;
  shareRate: number | null;
  profileViewRate: number | null;
  dmStartRate: number | null;
  commentRate: number | null;
}

export interface PerPostFact {
  postId: string;
  title: string;
  pillar: string;
  format: string;
  templateId: string;
  templateVersion: number | null;
  variant: string | null;
  cta: string | null;
  publishedAt: string | null;
  metricDueOn: string | null;
  measured: boolean;
  metrics: PostMetricValues | null;
  rates: RateValues | null;
  /** 計測済みでも値が未入力の指標名(0とは別) */
  missingMetrics: MetricKey[];
}

export interface GroupFact {
  axis: "pillar" | "format" | "template" | "templateVersion" | "variant" | "cta";
  key: string;
  label: string;
  sampleCount: number;
  evidencePostIds: string[];
  /** 指標ごとの取得件数(null除外後の件数) */
  coverage: Record<MetricKey, number>;
  totals: Record<MetricKey, number | null>;
  /** 主要表示: 投稿あたり中央値(取得できた値のみ。0件ならnull) */
  medians: Record<MetricKey, number | null> & Record<RateKey, number | null>;
  /** 参考表示: 平均(取得3件以上のときのみ。少数では出さない) */
  means: Record<MetricKey, number | null>;
  missingCount: Record<MetricKey, number>;
  /** サンプル不足(断定禁止)フラグ */
  exploratory: boolean;
}

export interface DataCoverage {
  publishedCount: number;
  measuredCount: number;
  /** 期限到来かつ未入力 */
  overdueCount: number;
  /** まだ期限が来ていない未入力 */
  notDueCount: number;
  overduePostIds: string[];
  notDuePostIds: string[];
  metricAvailability: Record<MetricKey, number>;
  missingFields: string[];
}

export interface AnalysisFacts {
  windowDays: AnalysisWindow;
  /** この事実を確定したJST業務日(期限判定の基準)。冪等hashの材料にも含まれる(P1-1) */
  asOfBusinessDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  dataCoverage: DataCoverage;
  totals: { entered: Record<MetricKey, number | null>; enteredCount: Record<MetricKey, number> };
  perPostFacts: PerPostFact[];
  groups: GroupFact[];
  insufficientData: string[];
  warnings: string[];
  evidencePostIds: string[];
}

/** 4桁丸め(決定的表示のため)。null保持 */
function round4(v: number | null): number | null {
  if (v === null) return null;
  return Math.round(v * 10_000) / 10_000;
}

/** 率: 分母が正の数のときだけ計算。分母null/0・分子nullはnull(0除算・欠損0埋め禁止) */
export function safeRate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round4(numerator / denominator);
}

export function computeRates(metrics: PostMetricValues | null): RateValues | null {
  if (!metrics) return null;
  return {
    saveRate: safeRate(metrics.saves, metrics.reach),
    shareRate: safeRate(metrics.shares, metrics.reach),
    profileViewRate: safeRate(metrics.profileViews, metrics.reach),
    dmStartRate: safeRate(metrics.dmStarts, metrics.reach),
    commentRate: safeRate(metrics.comments, metrics.reach),
  };
}

/** 中央値(nullを除外した値のみ。0件ならnull)。少数の外れ値に平均より頑健 */
export function median(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  const m = nums.length % 2 === 1 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
  return round4(m);
}

function meanIfEnough(values: (number | null)[], minCount = 3): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < minCount) return null;
  return round4(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function sumOrNull(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0);
}

function buildGroup(
  axis: GroupFact["axis"],
  key: string,
  label: string,
  posts: PerPostFact[],
): GroupFact {
  const measured = posts.filter((p) => p.measured);
  const coverage = {} as Record<MetricKey, number>;
  const totals = {} as Record<MetricKey, number | null>;
  const means = {} as Record<MetricKey, number | null>;
  const missingCount = {} as Record<MetricKey, number>;
  const medians = {} as GroupFact["medians"];
  for (const mk of METRIC_KEYS) {
    const values = measured.map((p) => p.metrics?.[mk] ?? null);
    coverage[mk] = values.filter((v) => v !== null).length;
    totals[mk] = sumOrNull(values);
    medians[mk] = median(values);
    means[mk] = meanIfEnough(values);
    missingCount[mk] = measured.length - coverage[mk];
  }
  for (const rk of RATE_KEYS) {
    medians[rk] = median(measured.map((p) => p.rates?.[rk] ?? null));
  }
  return {
    axis,
    key,
    label,
    sampleCount: measured.length,
    evidencePostIds: measured.map((p) => p.postId).sort(),
    coverage,
    totals,
    medians,
    means,
    missingCount,
    exploratory: measured.length < MIN_POSTS_FOR_TREND,
  };
}

/** 決定的な分析ファクト生成。入力が同じなら出力も同じ(日時取得・乱数を使わない) */
export function buildAnalysisFacts(
  posts: AnalyticsPostInput[],
  windowDays: AnalysisWindow,
  options: { today: string },
): AnalysisFacts {
  const sorted = [...posts].sort((a, b) => a.postId.localeCompare(b.postId));
  const perPostFacts: PerPostFact[] = sorted.map((p) => {
    const rates = computeRates(p.metrics);
    const missingMetrics = p.metrics
      ? METRIC_KEYS.filter((mk) => p.metrics![mk] === null)
      : [];
    return {
      postId: p.postId,
      title: p.title,
      pillar: p.pillar,
      format: p.format,
      templateId: p.templateId,
      templateVersion: p.templateVersion,
      variant: p.variant,
      cta: p.cta,
      publishedAt: p.publishedAt,
      metricDueOn: p.metricDueOn,
      measured: p.metrics !== null,
      metrics: p.metrics,
      rates,
      missingMetrics,
    };
  });

  const measured = perPostFacts.filter((p) => p.measured);
  const unmeasured = perPostFacts.filter((p) => !p.measured);
  const overdue = unmeasured.filter((p) => p.metricDueOn !== null && p.metricDueOn <= options.today);
  const notDue = unmeasured.filter((p) => p.metricDueOn === null || p.metricDueOn > options.today);

  const metricAvailability = {} as Record<MetricKey, number>;
  const enteredTotals = {} as Record<MetricKey, number | null>;
  const enteredCount = {} as Record<MetricKey, number>;
  const missingFields: string[] = [];
  for (const mk of METRIC_KEYS) {
    const values = measured.map((p) => p.metrics?.[mk] ?? null);
    const n = values.filter((v) => v !== null).length;
    metricAvailability[mk] = n;
    enteredTotals[mk] = sumOrNull(values);
    enteredCount[mk] = n;
    if (measured.length > 0 && n < measured.length) {
      missingFields.push(`${mk}: ${measured.length - n}件未入力`);
    }
  }

  // グループ比較(取得できる軸のみ。値が無い軸キーは「不明」へまとめない — 除外して理由を記録)
  const groups: GroupFact[] = [];
  const insufficientData: string[] = [];
  const groupBy = (
    axis: GroupFact["axis"],
    keyOf: (p: PerPostFact) => string | null,
    labelOf: (key: string) => string,
  ): void => {
    const buckets = new Map<string, PerPostFact[]>();
    let skipped = 0;
    for (const p of perPostFacts) {
      const key = keyOf(p);
      if (key === null || key === "") {
        skipped += 1;
        continue;
      }
      const list = buckets.get(key) ?? [];
      list.push(p);
      buckets.set(key, list);
    }
    for (const [key, list] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      groups.push(buildGroup(axis, key, labelOf(key), list));
    }
    if (skipped > 0) insufficientData.push(`${axis}軸: ${skipped}件は分類キーが未取得のため対象外`);
  };
  groupBy("pillar", (p) => p.pillar, (k) => `柱${k}`);
  groupBy("format", (p) => p.format, (k) => k);
  groupBy("template", (p) => p.templateId, (k) => k);
  groupBy(
    "templateVersion",
    (p) => (p.templateVersion === null ? null : `${p.templateId}@v${p.templateVersion}`),
    (k) => k,
  );
  groupBy("variant", (p) => (p.variant === null ? null : `${p.templateId}/${p.variant}`), (k) => k);
  groupBy("cta", (p) => p.cta, (k) => k);

  const warnings: string[] = [];
  if (measured.length < MIN_POSTS_FOR_TREND) {
    warnings.push(
      `計測済み投稿が${measured.length}本(10本未満)のため、優劣・成功の断定はできません。すべて「傾向の可能性」「追加検証が必要」として扱ってください`,
    );
  }
  warnings.push("観察データであり、因果関係は断定できません(「関連が観察された」まで)");
  if (overdue.length > 0) warnings.push(`実績入力の期限到来・未入力が${overdue.length}件あります`);

  // P2-2: 期間はISO文字列のsliceではなく、JST業務日への変換で決める(UTC跨ぎの誤りを防ぐ)
  const publishedBusinessDates = sorted
    .map((p) => p.publishedAt)
    .filter((d): d is string => d !== null)
    .map((iso) => businessDateFromIso(iso))
    .sort();

  return {
    windowDays,
    asOfBusinessDate: options.today,
    periodStart: publishedBusinessDates[0] ?? null,
    periodEnd: publishedBusinessDates[publishedBusinessDates.length - 1] ?? null,
    dataCoverage: {
      publishedCount: perPostFacts.length,
      measuredCount: measured.length,
      overdueCount: overdue.length,
      notDueCount: notDue.length,
      overduePostIds: overdue.map((p) => p.postId).sort(),
      notDuePostIds: notDue.map((p) => p.postId).sort(),
      metricAvailability,
      missingFields,
    },
    totals: { entered: enteredTotals, enteredCount },
    perPostFacts,
    groups,
    insufficientData,
    warnings,
    evidencePostIds: measured.map((p) => p.postId).sort(),
  };
}

// ---- 表現ルール(V6-A 4.4)。AI出力の断定表現を通常コードで検査する ----

/** 計測済み10本未満で禁止する断定表現 */
export const FORBIDDEN_UNDER_MIN = [
  "勝ち",
  "勝者",
  "最強",
  "効果がある",
  "効果があった",
  "成功",
  "優れている",
  "優れた形式",
  "確実に",
  "間違いなく",
  "ベストな",
] as const;

/** 件数にかかわらず禁止する因果断定表現 */
export const FORBIDDEN_CAUSAL = [
  "が原因で",
  "のおかげで",
  "因果関係がある",
  "必ず増える",
  "必ず伸びる",
  "確実に増える",
] as const;

/**
 * 断定・因果表現の検出(決定的)。見つかった禁止語を返す(なければ空配列)。
 * measuredCount < MIN_POSTS_FOR_TREND のときは断定語も禁止対象になる。
 */
export function findForbiddenAssertions(text: string, measuredCount: number): string[] {
  const hits: string[] = [];
  for (const word of FORBIDDEN_CAUSAL) {
    if (text.includes(word)) hits.push(word);
  }
  if (measuredCount < MIN_POSTS_FOR_TREND) {
    for (const word of FORBIDDEN_UNDER_MIN) {
      if (text.includes(word)) hits.push(word);
    }
  }
  return [...new Set(hits)];
}

// ---- 構造化ファクト参照(V6再レビューP1-2) ----
// AIの自由文の数値を信用しない。提案はsnapshot内の事実を構造化IDで参照し、
// 通常コードが実在と値の完全一致を検査した上で、observation文字列自体を生成する。

export type StructuredFactRef =
  | { scope: "post"; postId: string; metric: MetricKey | RateKey; value: number | null }
  | {
      scope: "group";
      axis: GroupFact["axis"];
      groupKey: string;
      stat: "median" | "mean" | "total";
      metric: MetricKey | RateKey;
      value: number | null;
    }
  | { scope: "group"; axis: GroupFact["axis"]; groupKey: string; stat: "sampleCount"; value: number }
  | { scope: "coverage"; field: "publishedCount" | "measuredCount" | "overdueCount" | "notDueCount"; value: number };

export interface FactRefResolution {
  ok: boolean;
  /** snapshot側の実際の値(参照先が存在した場合) */
  actual?: number | null;
  /** 人間可読の参照ラベル(observation生成に使う) */
  label: string;
  error?: string;
}

const RATE_KEY_SET = new Set<string>(RATE_KEYS);

/** 参照先の実在と値をsnapshotから解決する(決定的)。存在しない参照はerrorを返す */
export function resolveStructuredFactRef(facts: AnalysisFacts, ref: StructuredFactRef): FactRefResolution {
  if (ref.scope === "post") {
    const post = facts.perPostFacts.find((p) => p.postId === ref.postId);
    if (!post) return { ok: false, label: `投稿 ${ref.postId}`, error: `投稿 ${ref.postId} はsnapshotに存在しません` };
    const label = `投稿「${post.title}」の${ref.metric}(${facts.windowDays}日窓)`;
    const actual = RATE_KEY_SET.has(ref.metric)
      ? (post.rates?.[ref.metric as RateKey] ?? null)
      : (post.metrics?.[ref.metric as MetricKey] ?? null);
    return { ok: true, actual, label };
  }
  if (ref.scope === "group") {
    const group = facts.groups.find((g) => g.axis === ref.axis && g.key === ref.groupKey);
    if (!group) {
      return { ok: false, label: `${ref.axis}「${ref.groupKey}」`, error: `グループ ${ref.axis}「${ref.groupKey}」はsnapshotに存在しません` };
    }
    if (ref.stat === "sampleCount") {
      return { ok: true, actual: group.sampleCount, label: `${group.label}のsampleCount` };
    }
    const label = `${group.label}の${ref.metric}の${ref.stat}(${facts.windowDays}日窓・sampleCount=${group.sampleCount})`;
    if (ref.stat === "median") return { ok: true, actual: group.medians[ref.metric] ?? null, label };
    if (RATE_KEY_SET.has(ref.metric)) {
      return { ok: false, label, error: `率(${ref.metric})に${ref.stat}はありません(中央値のみ)` };
    }
    if (ref.stat === "mean") return { ok: true, actual: group.means[ref.metric as MetricKey], label };
    return { ok: true, actual: group.totals[ref.metric as MetricKey], label };
  }
  // coverage
  return { ok: true, actual: facts.dataCoverage[ref.field], label: `データ充足状況の${ref.field}(${facts.windowDays}日窓)` };
}

/**
 * 参照の検証(実在+値の完全一致)。エラー配列を返す(空なら合格)。
 * AIが申告したvalueとsnapshotの実際の値が一致しない場合(架空の数値)は拒否する。
 */
export function verifyStructuredFactRefs(facts: AnalysisFacts, refs: StructuredFactRef[]): string[] {
  const errors: string[] = [];
  for (const ref of refs) {
    const r = resolveStructuredFactRef(facts, ref);
    if (!r.ok) {
      errors.push(r.error ?? `参照を解決できません: ${r.label}`);
      continue;
    }
    if (r.actual !== ref.value) {
      errors.push(`${r.label} の値が一致しません(snapshot: ${r.actual === null ? "null(未取得)" : r.actual} / 提案の申告: ${ref.value === null ? "null" : ref.value})`);
    }
  }
  return errors;
}

/** observation本文を通常コードが生成する(AIの自由文の数値を保存しない) */
export function renderStructuredFactRefs(facts: AnalysisFacts, refs: StructuredFactRef[]): string {
  const lines = refs.map((ref) => {
    const r = resolveStructuredFactRef(facts, ref);
    const value = r.actual === null || r.actual === undefined ? "未取得" : String(r.actual);
    return `${r.label}: ${value}`;
  });
  return `【${facts.windowDays}日窓・${facts.asOfBusinessDate}時点の事実(通常コード生成)】 ${lines.join(" / ")}`;
}

/** 決定的なJSON文字列化(キーを再帰ソート)。sourceDataHashの入力に使う */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",");
  return `{${body}}`;
}
