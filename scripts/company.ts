#!/usr/bin/env tsx
/**
 * company CLI — エージェント(Claude Codeセッション)からDBへの唯一の書き込み経路(docs/09)。
 * すべての入力はZod検証を通る。検証失敗は非0終了+stderrに理由(エージェントが読める形)。
 *
 * 使い方:
 *   pnpm company init                         初期化(組織シード)
 *   pnpm company seed --demo                  デモデータ投入(既存データを消去、demo_mode=true)
 *   pnpm company run-start                    日次run開始(前回異常終了の検出・回収込み)
 *   pnpm company run-finish --run <id>        run終了
 *   pnpm company plan-commit --file <json>    タスク一括作成(冪等)
 *   pnpm company create-task --json '<spec>'  タスク1件作成(冪等)
 *   pnpm company start --task <id>            タスク開始
 *   pnpm company heartbeat --task <id> --stage <text>
 *   pnpm company submit --task <id> --file <content.json>
 *   pnpm company fail --task <id> --error <text>
 *   pnpm company cancel --task <id> [--actor owner]
 *   pnpm company resume --task <id> [--actor owner]
 *   pnpm company status                       会社状態JSON
 *   pnpm company events --task <id>           タスクのイベント一覧
 *   pnpm company create-post --json '<{pillar,format,title,plannedDate?}>'
 *   pnpm company render --post <id>           カルーセルPNG生成(文字あふれ検査込み・通常コード)
 *   pnpm company qa --task <id> --file <report.json>   QA提出(合格で承認キューへ)
 *   pnpm company queue                        承認キュー一覧JSON
 *   pnpm company source-add --json '<source>' 情報源の登録(URL重複は既存を返す)
 *   pnpm company source-list                  情報源一覧JSON
 *   pnpm company source-link --post <id> --source <id>  投稿へ情報源を紐付け
 *   pnpm company portfolio-list               実績一覧JSON(許可範囲でマスク済み。登録・許可変更はUIのみ)
 *   pnpm company escalate --task <id> --stage <理由>     heavyモデル昇格の記録(日次上限あり)
 *   pnpm company daily-report [--date YYYY-MM-DD]        日報の生成・保存(通常コード集計)
 *   pnpm company doctor                       読み取り検査(旧形式spec・欠損ファイル等の検出。書き換えなし)
 *
 * 注意: 承認・却下・修正依頼、公開許可の記録・変更、生成停止の解除のコマンドは存在しない。
 * これらは代表者がNext.js UIから行う唯一の経路であり、
 * AI社員・オーケストレーターはこのCLIから実行できない(P1指摘1, V3-C/H)。
 */
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { openDb } from "../src/adapters/db/client";
import * as t from "../src/adapters/db/schema";
import {
  ensureSeedOrg,
  runStart,
  runFinish,
  createTask,
  startTask,
  heartbeat,
  submitArtifact,
  submitQa,
  failTask,
  cancelTask,
  resumeTask,
  getCompanyState,
  setSetting,
  createPost,
  listApprovalQueue,
  addSource,
  linkSourceToPost,
  listPortfolioForAi,
  recordHeavyEscalation,
} from "../src/adapters/db/store";
import { buildDailyReport, doctorScan } from "../src/adapters/db/views";
import * as t2 from "../src/adapters/db/schema";
import { seedDemo } from "../src/adapters/db/demo";
import { planCommitSchema, taskSpecSchema, sourceInputSchema, TEMPLATE_IDS } from "../src/core/schemas";
import { todayLocal, ulid } from "../src/core/ids";
import { renderPost } from "../src/adapters/render/render-post";
import { OverflowError } from "../src/adapters/render/renderer";
import { z } from "zod";

const HELP_HINT = "ヘルプ: scripts/company.ts の冒頭コメントを参照";

function out(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function fail(message: string): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

const [, , command, ...rest] = process.argv;

const { values: args } = parseArgs({
  args: rest,
  options: {
    demo: { type: "boolean", default: false },
    file: { type: "string" },
    json: { type: "string" },
    task: { type: "string" },
    run: { type: "string" },
    post: { type: "string" },
    source: { type: "string" },
    stage: { type: "string" },
    error: { type: "string" },
    actor: { type: "string", default: "system" },
    date: { type: "string" },
  },
  strict: true,
});

const { db } = openDb();
const actor = args.actor ?? "system";

const createPostInputSchema = z
  .object({
    pillar: z.enum(["1", "2", "3", "4", "5", "6"]),
    format: z.string().min(1).max(30),
    title: z.string().min(1).max(120),
    plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    templateId: z.enum(TEMPLATE_IDS).optional(),
    portfolioItemId: z.string().optional(),
  })
  .strict();

/** render: 実体は src/adapters/render/render-post.ts(テストと共用) */
async function renderCommand(postId: string): Promise<void> {
  try {
    const result = await renderPost(db, postId, actor);
    out({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OverflowError) {
      fail(`${err.message} → 琴葉への短縮タスクを自動生成しました`);
    }
    throw err;
  }
}

try {
  switch (command) {
    case "init": {
      ensureSeedOrg(db);
      setSetting(db, "demo_mode", false);
      out({ ok: true, message: "初期化完了(組織シード投入済み)" });
      break;
    }
    case "seed": {
      if (!args.demo) fail("seed は --demo のみ対応(実データのseedはありません)");
      seedDemo(db);
      out({ ok: true, message: "デモデータを投入しました(demo_mode=true)" });
      break;
    }
    case "run-start": {
      const result = runStart(db, args.date ?? todayLocal(), actor);
      out({ ok: true, ...result });
      break;
    }
    case "run-finish": {
      if (!args.run) fail(`--run <id> が必要です。${HELP_HINT}`);
      runFinish(db, args.run, actor);
      out({ ok: true });
      break;
    }
    case "plan-commit": {
      if (!args.file) fail("--file <plan.json> が必要です");
      const raw: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      const plan = planCommitSchema.parse(raw);
      const results = plan.tasks.map((spec) => {
        const r = createTask(db, spec, plan.runDate, actor);
        return { id: r.task.id, title: r.task.title, created: r.created };
      });
      out({ ok: true, tasks: results });
      break;
    }
    case "create-task": {
      if (!args.json) fail("--json '<spec>' が必要です");
      const spec = taskSpecSchema.parse(JSON.parse(args.json));
      const r = createTask(db, spec, args.date ?? todayLocal(), actor);
      out({ ok: true, id: r.task.id, created: r.created });
      break;
    }
    case "start": {
      if (!args.task) fail("--task <id> が必要です");
      startTask(db, args.task, actor);
      out({ ok: true });
      break;
    }
    case "heartbeat": {
      if (!args.task || !args.stage) fail("--task <id> --stage <text> が必要です");
      heartbeat(db, args.task, args.stage, actor);
      out({ ok: true });
      break;
    }
    case "submit": {
      if (!args.task || !args.file) fail("--task <id> --file <content.json> が必要です");
      const content: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      const r = submitArtifact(db, args.task, content, actor, {
        estInputChars: 0,
        estOutputChars: readFileSync(args.file, "utf8").length,
      });
      out({ ok: true, artifactId: r.artifactId });
      break;
    }
    case "fail": {
      if (!args.task || !args.error) fail("--task <id> --error <text> が必要です");
      const r = failTask(db, args.task, args.error, actor);
      out({ ok: true, retried: r.retried });
      break;
    }
    case "cancel": {
      if (!args.task) fail("--task <id> が必要です");
      cancelTask(db, args.task, actor);
      out({ ok: true });
      break;
    }
    case "resume": {
      if (!args.task) fail("--task <id> が必要です");
      resumeTask(db, args.task, actor);
      out({ ok: true });
      break;
    }
    case "status": {
      out(getCompanyState(db));
      break;
    }
    case "events": {
      if (!args.task) fail("--task <id> が必要です");
      const events = db
        .select()
        .from(t.taskEvents)
        .where(eq(t.taskEvents.taskId, args.task))
        .orderBy(asc(t.taskEvents.seq))
        .all();
      out(events);
      break;
    }
    case "create-post": {
      if (!args.json) fail("--json '<{pillar,format,title,plannedDate?}>' が必要です");
      const input = createPostInputSchema.parse(JSON.parse(args.json));
      const post = createPost(db, input, actor);
      out({ ok: true, id: post.id, status: post.status });
      break;
    }
    case "render": {
      if (!args.post) fail("--post <id> が必要です");
      await renderCommand(args.post);
      break;
    }
    case "qa": {
      if (!args.task || !args.file) fail("--task <id> --file <report.json> が必要です");
      const content: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      const r = submitQa(db, args.task, content, actor);
      out({ ok: true, artifactId: r.artifactId, result: r.result, message: r.result === "pass" ? "承認キューへ移動しました" : "draftingへ差し戻しました" });
      break;
    }
    case "queue": {
      out(listApprovalQueue(db));
      break;
    }
    case "source-add": {
      if (!args.json) fail("--json '<source>' が必要です(title/url/publisher/publishedAt/factOrInference/reliability/summary)");
      const input = sourceInputSchema.parse(JSON.parse(args.json));
      const r = addSource(db, input, actor);
      out({ ok: true, ...r, message: r.created ? "登録しました" : "同一URLが登録済みのため既存IDを返します" });
      break;
    }
    case "source-list": {
      out(db.select().from(t2.sources).all());
      break;
    }
    case "source-link": {
      if (!args.post || !args.source) fail("--post <id> --source <id> が必要です");
      const r = linkSourceToPost(db, args.post, args.source, actor);
      out({ ok: true, ...r });
      break;
    }
    case "portfolio-list": {
      // AIプロンプトへ渡す前提のビュー: 許可範囲外の顧客名・URL・声・素材はマスク済み(V3レビュー指摘1)
      out(listPortfolioForAi(db));
      break;
    }
    case "escalate": {
      if (!args.task || !args.stage) fail("--task <id> --stage <昇格理由> が必要です");
      const r = recordHeavyEscalation(db, args.task, args.stage, actor);
      out({ ok: true, countToday: r.countToday, message: "heavy昇格を記録しました(上限内)" });
      break;
    }
    case "daily-report": {
      const date = args.date ?? todayLocal();
      const report = buildDailyReport(db, date);
      // 保存(冪等): 湊のreportタスク経由。既に保存済みなら再保存せず内容だけ返す
      const { task, created } = createTask(
        db,
        { type: "report", title: `日報 ${date}`, assigneeId: "emp_minato", stepKey: `daily-report-${date}`, priority: 5 },
        date,
        actor,
      );
      let saved = false;
      if (created || task.status === "queued") {
        startTask(db, task.id, actor);
        const r = submitArtifact(db, task.id, report, actor);
        db.insert(t2.reports)
          .values({ id: ulid(), kind: "daily", periodStart: date, periodEnd: date, bodyArtifactId: r.artifactId })
          .run();
        saved = true;
      }
      out({ ok: true, saved, report });
      break;
    }
    case "doctor": {
      const findings = doctorScan(db);
      out({ ok: findings.filter((f) => f.level === "error").length === 0, findings });
      break;
    }
    default:
      fail(`不明なコマンド: ${command ?? "(なし)"}。${HELP_HINT}`);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
