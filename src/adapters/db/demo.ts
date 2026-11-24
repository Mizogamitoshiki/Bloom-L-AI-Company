/**
 * デモデータ(docs/16 §3)。架空データのみ。実在顧客名・実URLを含めない。
 * demo_mode=true を設定し、UIは全画面に「デモデータ」バナーを表示する。
 */
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import * as t from "./schema";
import { ulid, nowIso, todayLocal } from "../../core/ids";
import { ensureSeedOrg, setSetting, audit } from "./store";

function insertTask(
  db: Db,
  args: {
    id: string;
    type: string;
    title: string;
    assigneeId: string;
    status: string;
    runDate: string;
    postId?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    retryCount?: number;
  },
): void {
  db.insert(t.tasks)
    .values({
      id: args.id,
      idempotencyKey: `demo:${args.id}`,
      type: args.type,
      title: args.title,
      assigneeId: args.assigneeId,
      postId: args.postId ?? null,
      status: args.status,
      priority: 5,
      inputJson: null,
      retryCount: args.retryCount ?? 0,
      runDate: args.runDate,
      error: args.error ?? null,
      createdAt: nowIso(),
      startedAt: args.startedAt ?? null,
      finishedAt: args.finishedAt ?? null,
    })
    .run();
}

function insertEvent(db: Db, taskId: string, seq: number, type: string, tsOffsetMin: number, stage?: string): void {
  db.insert(t.taskEvents)
    .values({
      id: ulid(),
      taskId,
      seq,
      ts: new Date(Date.now() - tsOffsetMin * 60_000).toISOString(),
      type,
      payloadJson: stage ? JSON.stringify({ stage }) : null,
      actor: "demo",
    })
    .run();
}

/** 既存データを消してデモ状態を投入する(データはすべて架空) */
export function seedDemo(db: Db): void {
  // 削除は外部キーの子→親の順(task_events/artifacts/usage_records → tasks → posts)
  for (const table of [
    t.taskEvents,
    t.artifacts,
    t.usageRecords,
    t.approvals,
    t.tasks,
    t.posts,
    t.runs,
    t.auditLog,
  ]) {
    db.delete(table).run();
  }
  ensureSeedOrg(db);
  const today = todayLocal();

  // 実行中のrun
  const runId = ulid();
  db.insert(t.runs).values({ id: runId, runDate: today, startedAt: new Date(Date.now() - 45 * 60_000).toISOString(), status: "running", note: null }).run();

  // 承認待ちの投稿(架空)
  const postId = ulid();
  db.insert(t.posts)
    .values({
      id: postId,
      pillar: "6",
      format: "carousel",
      title: "【デモ】HPがない事業者が今すぐできる3つの見せ方",
      status: "awaiting_approval",
      plannedDate: today,
      captionFinal: null,
      hashtagsJson: null,
      exportPath: null,
      publishedAt: null,
      publishMethod: "manual",
      rightsState: "clear",
    })
    .run();

  // 葵: 会議中(running・新鮮なheartbeat)
  const aoiTask = ulid();
  insertTask(db, { id: aoiTask, type: "meeting", title: "本日の優先順位決定", assigneeId: "emp_aoi", status: "running", runDate: today, startedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
  insertEvent(db, aoiTask, 1, "created", 12);
  insertEvent(db, aoiTask, 2, "queued", 11);
  insertEvent(db, aoiTask, 3, "started", 10);
  insertEvent(db, aoiTask, 4, "heartbeat", 1, "承認待ち滞留の確認");

  // 凛: 調査中(running・新鮮)
  const rinTask = ulid();
  insertTask(db, { id: rinTask, type: "research", title: "泉州地域の同業アカウント調査", assigneeId: "emp_rin", status: "running", runDate: today, startedAt: new Date(Date.now() - 8 * 60_000).toISOString() });
  insertEvent(db, rinTask, 1, "created", 9);
  insertEvent(db, rinTask, 2, "queued", 9);
  insertEvent(db, rinTask, 3, "started", 8);
  insertEvent(db, rinTask, 4, "heartbeat", 2, "競合アカウントの投稿傾向を整理");

  // 昊: heartbeat途絶 → 状態不明(stale)を実演
  const soraTask = ulid();
  insertTask(db, { id: soraTask, type: "plan_posts", title: "来週の投稿テーマ企画", assigneeId: "emp_sora", status: "running", runDate: today, startedAt: new Date(Date.now() - 40 * 60_000).toISOString() });
  insertEvent(db, soraTask, 1, "created", 42);
  insertEvent(db, soraTask, 2, "queued", 41);
  insertEvent(db, soraTask, 3, "started", 40);
  insertEvent(db, soraTask, 4, "heartbeat", 35, "テーマ候補の洗い出し");

  // 紫苑: 品質確認中(running・新鮮)
  const shionTask = ulid();
  insertTask(db, { id: shionTask, type: "qa", title: "投稿案の品質チェック", assigneeId: "emp_shion", status: "running", runDate: today, postId, startedAt: new Date(Date.now() - 5 * 60_000).toISOString() });
  insertEvent(db, shionTask, 1, "created", 6);
  insertEvent(db, shionTask, 2, "queued", 6);
  insertEvent(db, shionTask, 3, "started", 5);
  insertEvent(db, shionTask, 4, "heartbeat", 1, "誤字・ブランド表現の確認");

  // 琴葉: 本日完了+承認待ち投稿の成果物担当 → 承認待ち表示
  const kotohaTask = ulid();
  insertTask(db, { id: kotohaTask, type: "write_copy", title: "カルーセル本文の作成", assigneeId: "emp_kotoha", status: "done", runDate: today, postId, startedAt: new Date(Date.now() - 120 * 60_000).toISOString(), finishedAt: new Date(Date.now() - 90 * 60_000).toISOString() });
  insertEvent(db, kotohaTask, 1, "created", 125);
  insertEvent(db, kotohaTask, 2, "queued", 124);
  insertEvent(db, kotohaTask, 3, "started", 120);
  insertEvent(db, kotohaTask, 4, "artifact_added", 91);
  insertEvent(db, kotohaTask, 5, "succeeded", 90);
  db.insert(t.artifacts)
    .values({
      id: ulid(),
      taskId: kotohaTask,
      postId,
      kind: "copy",
      version: 1,
      contentJson: JSON.stringify({
        kind: "copy",
        headline: "HPがなくても、まず「見せ方」から",
        body: "【デモデータ】泉州地域でHPをまだ持っていない事業者さま向けに、今すぐできる情報発信の整え方を3つにまとめました。",
        cta: "詳しくはDMで「相談」とお送りください",
        hashtags: ["#泉州", "#岸和田", "#ホームページ制作", "#個人事業主", "#デモ"],
      }),
      filePath: null,
      schemaVersion: "v1",
      createdAt: new Date(Date.now() - 91 * 60_000).toISOString(),
    })
    .run();

  // 紬: 失敗(リトライ上限超過)
  const tsumugiTask = ulid();
  insertTask(db, { id: tsumugiTask, type: "design", title: "カルーセル構成の作成", assigneeId: "emp_tsumugi", status: "failed", runDate: today, error: "スロット文字数の検証に3回失敗(デモ)", retryCount: 2, startedAt: new Date(Date.now() - 60 * 60_000).toISOString(), finishedAt: new Date(Date.now() - 50 * 60_000).toISOString() });
  insertEvent(db, tsumugiTask, 1, "created", 62);
  insertEvent(db, tsumugiTask, 2, "queued", 61);
  insertEvent(db, tsumugiTask, 3, "started", 60);
  insertEvent(db, tsumugiTask, 4, "retried", 56);
  insertEvent(db, tsumugiTask, 5, "retried", 53);
  insertEvent(db, tsumugiTask, 6, "failed", 50);

  // 湊: 予算停止
  const minatoTask = ulid();
  insertTask(db, { id: minatoTask, type: "report", title: "週次レポートの下書き", assigneeId: "emp_minato", status: "budget_paused", runDate: today });
  insertEvent(db, minatoTask, 1, "created", 30);
  insertEvent(db, minatoTask, 2, "queued", 29);
  insertEvent(db, minatoTask, 3, "paused_budget", 25);

  // 蓮: 本日完了
  const renTask = ulid();
  insertTask(db, { id: renTask, type: "plan_posts", title: "今週の投稿方針レビュー", assigneeId: "emp_ren", status: "done", runDate: today, startedAt: new Date(Date.now() - 200 * 60_000).toISOString(), finishedAt: new Date(Date.now() - 180 * 60_000).toISOString() });
  insertEvent(db, renTask, 1, "created", 205);
  insertEvent(db, renTask, 2, "queued", 204);
  insertEvent(db, renTask, 3, "started", 200);
  insertEvent(db, renTask, 4, "succeeded", 180);

  setSetting(db, "demo_mode", true);
  audit(db, "demo", "seed_demo", "settings", "demo_mode", { note: "架空のデモデータを投入" });
  db.update(t.settings).set({ valueJson: "true" }).where(eq(t.settings.key, "demo_mode")).run();
}
