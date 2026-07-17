/**
 * V6-I: Cron-ready基盤(本番稼働はしない)。
 * - 処理本体: 決定的なscheduled analytics(分析スナップショットの冪等生成)。Meta・AI・Blobを一切呼ばない
 * - 入口: /api/cron/analytics(Authorization: Bearer CRON_SECRET)。secret未設定・不一致は401
 * - production以外では書き込み拒否。DBがVercelで使えない間(SQLite/PG未実装)は503 not_ready
 * - 結果としてV6時点ではどの環境でも書き込みへ到達しない(fail closed)。ローカル検証はCLIのdry-run
 * - Vercel CronはUTCで実行される。JST業務日はcore/ids(+9時間)の通常コードで変換する(docs/27)
 * - ログ・応答へ秘密値(CRON_SECRET等)を出さない
 */
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { createAllWindowSnapshots, computeSourceDataHash, gatherAnalyticsInput } from "../db/analytics";
import { ANALYSIS_WINDOWS } from "../../core/analytics";
import { resolveDatabaseProvider } from "../db/provider";
import { resolveDeployTarget, resolveRuntimeMode } from "../../core/runtime";
import { businessDate } from "../../core/ids";

export interface ScheduledAnalyticsResult {
  businessDate: string;
  dryRun: boolean;
  windows: {
    windowDays: number;
    sourceDataHash: string;
    /** 既存スナップショットと同一入力ならfalse(冪等) */
    wouldCreate: boolean;
    created: boolean;
    snapshotId: string | null;
    publishedCount: number;
    measuredCount: number;
  }[];
  /** 構造的保証の明示(テストで検証) */
  metaApiCalled: false;
  aiInvoked: false;
}

/**
 * 決定的なscheduled analyticsユースケース。
 * dryRun=true ではDBへ一切書き込まず、生成した場合の結果だけを返す。
 * 同一JST業務日・同一入力なら何度実行しても結果は同じ(sourceDataHash冪等)。
 */
export function runScheduledAnalytics(
  db: Db,
  options: { today?: string; dryRun: boolean; actor?: string },
): ScheduledAnalyticsResult {
  const today = options.today ?? businessDate();
  if (options.dryRun) {
    const windows = ANALYSIS_WINDOWS.map((w) => {
      const input = gatherAnalyticsInput(db, w);
      // P1-1: createAnalysisSnapshotと完全に同じhash関数・同じ材料(入力+JST業務日)を使う
      const hash = computeSourceDataHash(input, today);
      const measured = input.filter((p) => p.metrics !== null).length;
      const existing = db
        .select({ id: t.analysisSnapshots.id })
        .from(t.analysisSnapshots)
        .where(and(eq(t.analysisSnapshots.windowDays, w), eq(t.analysisSnapshots.sourceDataHash, hash)))
        .get();
      return {
        windowDays: w,
        sourceDataHash: hash,
        wouldCreate: !existing, // 同一入力のスナップショットが既にあれば新規作成されない(冪等)
        created: false,
        snapshotId: existing?.id ?? null,
        publishedCount: input.length,
        measuredCount: measured,
      };
    });
    return { businessDate: today, dryRun: true, windows, metaApiCalled: false, aiInvoked: false };
  }
  const results = createAllWindowSnapshots(db, options.actor ?? "system", { today });
  return {
    businessDate: today,
    dryRun: false,
    windows: results.map((r) => ({
      windowDays: r.windowDays,
      sourceDataHash: r.sourceDataHash,
      wouldCreate: r.created,
      created: r.created,
      snapshotId: r.snapshotId,
      publishedCount: r.facts.dataCoverage.publishedCount,
      measuredCount: r.facts.dataCoverage.measuredCount,
    })),
    metaApiCalled: false,
    aiInvoked: false,
  };
}

export interface CronHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function bearerMatches(authorizationHeader: string | null, secret: string): boolean {
  if (!authorizationHeader) return false;
  const expected = `Bearer ${secret}`;
  const given = Buffer.from(authorizationHeader);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/**
 * /api/cron/analytics の本体(純関数に近い形でテスト可能)。
 * 認証→環境ゲート→DB準備状態の順に検査し、V6時点では書き込みへ到達しない。
 * 応答・例外に秘密値を含めない。
 */
export function handleAnalyticsCron(
  authorizationHeader: string | null,
  env: Record<string, string | undefined>,
  deps: { openDbForWrite?: () => { db: Db; close: () => void } } = {},
): CronHandlerResult {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) {
    return { status: 401, body: { ok: false, error: "CRON_SECRETが未設定のため認証できません" } };
  }
  if (!bearerMatches(authorizationHeader, secret)) {
    return { status: 401, body: { ok: false, error: "Cron認証に失敗しました(Authorization Bearerが一致しません)" } };
  }

  const deployTarget = resolveDeployTarget(env);
  if (deployTarget !== "production") {
    return {
      status: 403,
      body: { ok: false, error: "production以外の環境ではCronの書き込みを拒否します", deployTarget },
    };
  }

  // DB準備状態(V5.4境界)。Vercel上のSQLiteは使用不可、PostgreSQLは未実装 → not_ready
  let provider: string;
  try {
    provider = resolveDatabaseProvider(env).provider;
  } catch (err) {
    return { status: 503, body: { ok: false, error: err instanceof Error ? err.message : String(err), notReady: true } };
  }
  if (provider === "sqlite" && resolveRuntimeMode(env) === "cloud") {
    return {
      status: 503,
      body: { ok: false, error: "SQLiteはVercelの永続DBとして使用できません(not_ready)", notReady: true },
    };
  }
  if (provider === "postgres") {
    return {
      status: 503,
      body: { ok: false, error: "PostgreSQL接続が未実装のためCronはまだ稼働できません(not_ready)", notReady: true },
    };
  }

  // ここに到達するのは「production かつ localランタイム」という通常あり得ない構成のみ。
  // 書き込み依存が注入されていない限り実行しない(fail closed)。
  if (!deps.openDbForWrite) {
    return { status: 503, body: { ok: false, error: "Cron実行環境が未準備です(not_ready)", notReady: true } };
  }
  const opened = deps.openDbForWrite();
  try {
    const result = runScheduledAnalytics(opened.db, { dryRun: false, actor: "system" });
    return { status: 200, body: { ok: true, ...result } };
  } finally {
    opened.close();
  }
}
