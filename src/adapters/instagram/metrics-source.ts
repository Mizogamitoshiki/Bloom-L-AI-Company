/**
 * V6-H: 実績値の取得境界(MetricsSourcePort)。
 * - 現行の正: 代表者がInstagramインサイトからUIへ手動転記する(manual provider)
 * - 将来のInstagram Insights API取得は、公式ドキュメントと現在のInstagram Login権限を
 *   確認できるまで「未実装」。推測でエンドポイント・permissionを実装しない
 * - INSTAGRAM_INSIGHTS_MODE は既定disabled。V6ではdry_run/liveでもMetaへ一切通信しない(fail closed)
 * - permissionの追加・アプリレビュー・tokenの更新はコードから行わない(代表者の外部作業)
 */
import type { AnalysisWindow, PostMetricValues } from "../../core/analytics";

export type InsightsMode = "disabled" | "dry_run" | "live";

const INSIGHTS_MODES = new Set<InsightsMode>(["disabled", "dry_run", "live"]);

export function loadInsightsMode(env: NodeJS.ProcessEnv = process.env): InsightsMode {
  const raw = env.INSTAGRAM_INSIGHTS_MODE?.trim() || "disabled";
  // 不正値は黙ってliveへ倒さない(fail closed: disabled)
  return INSIGHTS_MODES.has(raw as InsightsMode) ? (raw as InsightsMode) : "disabled";
}

export interface MetricsFetchRequest {
  postId: string;
  instagramMediaId: string;
  windowDays: AnalysisWindow;
}

export interface MetricsFetchResult {
  provider: string;
  fetched: boolean;
  /** 取得できなかった理由(未実装・無効・権限未確認)。捏造しない */
  reason: string | null;
  metrics: PostMetricValues | null;
}

/** 実績値の取得境界。手動入力(現行)と将来のInsights APIを同じ形で扱う */
export interface MetricsSourcePort {
  readonly provider: "manual" | "instagram_insights";
  mode(): InsightsMode;
  isConfigured(): boolean;
  /** 外部通信の可否と実装状態を偽らずに返す。V6ではInsightsは常に未取得 */
  fetchPostMetrics(request: MetricsFetchRequest): Promise<MetricsFetchResult>;
}

/**
 * 現行の手動入力プロバイダー。
 * 実データは代表者が /publish の実績入力(post_metrics)へ転記する。この経路は常に有効。
 */
export class ManualMetricsSource implements MetricsSourcePort {
  readonly provider = "manual" as const;

  mode(): InsightsMode {
    return "disabled"; // 手動入力は「API取得なし」を意味する
  }

  isConfigured(): boolean {
    return true;
  }

  fetchPostMetrics(_request: MetricsFetchRequest): Promise<MetricsFetchResult> {
    return Promise.resolve({
      provider: this.provider,
      fetched: false,
      reason: "手動入力プロバイダーは自動取得しません。/publish の実績入力から代表者が転記してください",
      metrics: null,
    });
  }
}

/**
 * 将来のInstagram Insights取得プロバイダー(V6では境界のみ)。
 * 公式仕様(必要permission・アカウント種別・アプリレビュー要否)を確認できていないため、
 * どのモードでもMetaへ通信せず「未実装」を正直に返す。実装追加までliveは有効化できない。
 */
export class InstagramInsightsSource implements MetricsSourcePort {
  readonly provider = "instagram_insights" as const;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  mode(): InsightsMode {
    return loadInsightsMode(this.env);
  }

  isConfigured(): boolean {
    // 取得実装が存在しないため、設定値にかかわらず「未構成」を返す(偽装しない)
    return false;
  }

  fetchPostMetrics(_request: MetricsFetchRequest): Promise<MetricsFetchResult> {
    const mode = this.mode();
    if (mode === "disabled") {
      return Promise.resolve({
        provider: this.provider,
        fetched: false,
        reason: "INSTAGRAM_INSIGHTS_MODE=disabled(既定)。手動入力を使用してください",
        metrics: null,
      });
    }
    // dry_run / live いずれもV6では実装なし。Metaへの通信は発生しない(fail closed)
    return Promise.resolve({
      provider: this.provider,
      fetched: false,
      reason:
        "Instagram Insights取得はV6では未実装です(必要permission・アプリレビュー要否の公式確認が先)。" +
        "Metaへの通信は行っていません。手動入力を使用してください",
      metrics: null,
    });
  }
}

export function resolveMetricsSource(env: NodeJS.ProcessEnv = process.env): MetricsSourcePort {
  // V6の正は常にmanual。Insightsは実装完了+代表者の明示切替(将来)まで選択されない
  void env;
  return new ManualMetricsSource();
}
