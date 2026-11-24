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
 *   pnpm company canva-register --post <id> --dir <dir> --design <DesignID>  Canva書き出しPNGの外部レンダリング登録(V8/D-18)
 *   pnpm company hybrid-register --post <id> --cover <表紙PNG> --design <DesignID>  表紙Canva+本文Satoriのハイブリッド登録(V8/D-18)
 *   pnpm company post-visual-qa --post <id> --file <visual-qa.json>  紫苑の投稿画像視覚QAを記録
 *   pnpm company qa --task <id> --file <report.json>   QA提出(合格で承認キューへ)
 *   pnpm company queue                        承認キュー一覧JSON
 *   pnpm company export --post <id> --actor owner        承認済み投稿の書き出し(owner専用)
 *   pnpm company publish-record --post <id> --actor owner 投稿済み記録(owner専用)
 *   pnpm company media-upload --post <id> --actor owner     公開画像をVercel Blobへ準備(owner専用・V5.2)
 *   pnpm company instagram-dry-run --post <id> --actor owner Metaへ送信しない投稿前確認(owner専用・V5.2)
 *   pnpm company instagram-readiness                        Instagram接続状態(秘密値なし)
 *   pnpm company instagram-reconcile --post <id> --outcome not_published|published [--mediaId <id>] --actor owner  公開結果不明の解消(owner専用・V5.5)
 *   pnpm company idea-add --text "<アイデア>" --actor owner   代表者アイデアの記録(owner専用・V7)
 *   pnpm company idea-list [--status new|planned|in_progress|done|declined]  アイデア一覧JSON
 *   pnpm company idea-update --idea <id> --status <s> [--resolution "<内容>"] [--post <id>] --actor aoi|owner  アイデアの実行状態更新
 *   pnpm company source-add --json '<source>' 情報源の登録(URL重複は既存を返す)
 *   pnpm company source-list                  情報源一覧JSON
 *   pnpm company source-link --post <id> --source <id>  投稿へ情報源を紐付け
 *   pnpm company portfolio-list               実績一覧JSON(許可範囲でマスク済み。登録・許可変更はUIのみ)
 *   pnpm company sample-intake --json '<brief+assets>' --dir <画像フォルダ> --actor owner  サンプル依頼の登録(V10・owner専用・権利宣言attest必須)
 *   pnpm company sample-asset-add --request <id> --dir <dir> --json '{"fileName","kind"}' --actor owner  素材の追加(V10)
 *   pnpm company sample-list [--status new|building|qa|ready|posted|declined]   サンプル依頼一覧(AI向けビュー・V10)
 *   pnpm company sample-show --request <id>                                      依頼の詳細(素材・最新サンプル)
 *   pnpm company sample-build --task <颯のタスク> --file <site-sample.json> --actor hayate   HTML検査→書き出し→撮影→登録(V10)
 *   pnpm company sample-visual-qa --sample <id> --file <visual-qa.json> [--task <紬のタスク>] --actor tsumugi  紬の忠実度QA記録(V10)
 *   pnpm company sample-decline --request <id> --reason <理由> --actor owner    依頼の見送り(V10・owner専用)
 *   pnpm company escalate --task <id> --stage <理由>     heavyモデル昇格の記録(日次上限あり)
 *   pnpm company daily-report [--date YYYY-MM-DD]        日報の生成・保存(通常コード集計)
 *   pnpm company weekly-report [--date YYYY-MM-DD]       週報(通常コード集計。10本未満は断定しない)
 *   pnpm company monthly-report [--date YYYY-MM-DD]      月報(通常コード集計)
 *   pnpm company meeting-save --file <minutes.json>      週次/月次会議の議事録保存(meeting_minutes)
 *   pnpm company export --post <id>           承認済み投稿の書き出し(owner専用。整合性・QA・権利を再検査)
 *   pnpm company publish-record --post <id>   投稿済み記録(owner専用。3日/7日後の実績入力タスク作成)
 *   pnpm company backup [--date YYYY-MM-DD]   整合スナップショット+workspace+manifest(SHA-256)。14世代
 *   pnpm company backup-list                  バックアップ一覧(整合性checksum付き)
 *   pnpm company restore --from YYYY-MM-DD     バックアップから復元(checksum検証→doctor→atomic置換)
 *   pnpm company doctor                       読み取り検査(旧形式spec・欠損ファイル等の検出。書き換えなし)
 *   pnpm company db-export --actor owner [--output <dir>]   SQLite全テーブルをJSONL+manifestへ書き出し(読み取り専用・V5.4)
 *   pnpm company db-export-verify --from <dir>              エクスポートのSHA-256/件数/FK/重複PK検証(V5.4)
 *   pnpm company db-import-check --from <dir>               PostgreSQL投入前の事前検証(実接続なし・V5.4)
 *   pnpm company db-import-postgres --from <dir> --actor owner [--execute]  取り込み(V5.4は常にdry-run止まり)
 *   pnpm company cloud-readiness              Vercel移行準備の診断(秘密値なし・V5.4)
 *   pnpm company analytics-snapshot [--window 3|7]           分析スナップショット生成(通常コード集計・冪等・V6)
 *   pnpm company analytics-show [--window 3|7]               最新スナップショットの表示(V6)
 *   pnpm company improvement-proposal-save --file <json> --actor <aoi等>  改善提案の保存(機械QA付き・V6)
 *   pnpm company improvement-list                            改善提案と判断状態の一覧(V6)
 *   pnpm company improvement-decide --proposal <id> --decision <approved|rejected|revision_requested|superseded> [--reason <理由>] --actor owner
 *   pnpm company improvement-directives                      次回kickoffへ渡せる承認済み改善指示(最大3件・V6)
 *   pnpm company improvement-apply --post <id> --proposal <id> [--reason <採用理由>] --actor aoi  適用記録(二重適用防止・V6)
 *   pnpm company business-outcome-add --json '<outcome>' --actor owner   匿名の事業成果を記録(V6)
 *   pnpm company analytics-cron-dry-run                      Cron処理本体のdry-run(書き込みなし・V6)
 *
 * 注意: 承認・却下・修正依頼、公開許可の記録・変更、生成停止の解除のコマンドは存在しない。
 * これらは代表者がNext.js UIから行う唯一の経路であり、
 * AI社員・オーケストレーターはこのCLIから実行できない(P1指摘1, V3-C/H)。
 */
import { parseArgs } from "node:util";
import { loadEnvFile } from "node:process";
import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "../src/adapters/db/client";
import { resolveDatabaseProvider } from "../src/adapters/db/provider";
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
  exportPost,
  recordPublish,
  saveMeeting,
  registerAllTemplateVersions,
  registerAllTemplateVersionsAt,
  ensureTemplateVersionAt,
  listTemplateVersions,
  listTemplateVariantQa,
  upsertTemplateVariantQa,
  recordTemplateVisualQa,
  decideTemplateVersion,
  currentTemplateVersion,
  latestPostRender,
  attachPostRenderVisualQa,
  type TemplateDecision,
} from "../src/adapters/db/store";
import { buildDailyReport, buildPeriodReport, doctorScan } from "../src/adapters/db/views";
import { createBackup, listBackups, restoreBackup } from "../src/adapters/backup/backup";
import { runDbExport, verifyDbExport } from "../src/adapters/db/migrate/export";
import { checkImportSource, runPostgresImport } from "../src/adapters/db/migrate/import-check";
import { buildCloudReadiness } from "../src/adapters/cloud/readiness";
import { createAnalysisSnapshot, createAllWindowSnapshots, latestAnalysisSnapshot } from "../src/adapters/db/analytics";
import {
  addBusinessOutcome,
  applyImprovementDirective,
  decideImprovementProposal,
  listApprovedDirectives,
  listImprovementProposals,
  saveImprovementProposal,
} from "../src/adapters/db/improvements";
import { runScheduledAnalytics } from "../src/adapters/cloud/cron";
import { ANALYSIS_WINDOWS, type AnalysisWindow } from "../src/core/analytics";
import { IMPROVEMENT_DECISIONS, type ImprovementDecision as V6Decision } from "../src/core/schemas";
import { uploadPostMedia } from "../src/adapters/instagram/media-upload";
import { runInstagramDryRun, getInstagramReadiness, reconcileInstagramJob } from "../src/adapters/instagram/publish";
import { addOwnerIdea, listOwnerIdeas, updateOwnerIdea } from "../src/adapters/db/ideas";
import { VercelBlobStorage } from "../src/adapters/storage/vercel-blob";
import { generateTemplatePreviews, reconcileVisualQaInMeta } from "../src/adapters/render/preview";
import { distinctInteriorPageCount, MIN_DISTINCT_INTERIOR_PAGES } from "../src/core/templates/distinctness";
import { workspaceRoot } from "../src/adapters/root";
import path from "node:path";
import { weekRange, monthRange } from "../src/core/ids";
import * as t2 from "../src/adapters/db/schema";
import { seedDemo } from "../src/adapters/db/demo";
import { planCommitSchema, taskSpecSchema, sourceInputSchema, TEMPLATE_IDS, sampleRequestInputSchema, sampleAssetInputSchema } from "../src/core/schemas";
import {
  createSampleRequest,
  addSampleAsset,
  listSampleRequestsForAi,
  getSampleRequest,
  recordSampleDesignQa,
  declineSampleRequest,
  getSiteSample,
} from "../src/adapters/db/samples";
import { buildSiteSample, SampleBuildError } from "../src/adapters/samples/build";
import { sampleInputDir } from "../src/adapters/render/sample-media";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { todayLocal, ulid } from "../src/core/ids";
import { renderPost } from "../src/adapters/render/render-post";
import { registerCanvaRender, registerHybridRender } from "../src/adapters/canva/register";
import { renderStory, storySpecSchema } from "../src/adapters/render/story";
import { OverflowError } from "../src/adapters/render/renderer";
import { z } from "zod";

// Next.jsと同じく、CLIもリポジトリ直下の.envを自動読込する。
// 既存のシェル環境変数はNodeのloadEnvFile仕様により上書きしない。
try {
  loadEnvFile(path.resolve(process.cwd(), ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

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
    from: { type: "string" },
    all: { type: "boolean", default: false },
    template: { type: "string" },
    version: { type: "string" },
    decision: { type: "string" },
    note: { type: "string" },
    output: { type: "string" },
    execute: { type: "boolean", default: false },
    window: { type: "string" },
    proposal: { type: "string" },
    reason: { type: "string" },
    outcome: { type: "string" },
    mediaId: { type: "string" },
    text: { type: "string" },
    idea: { type: "string" },
    status: { type: "string" },
    resolution: { type: "string" },
    dir: { type: "string" },
    design: { type: "string" },
    cover: { type: "string" },
    // V10: サイトサンプル
    request: { type: "string" },
    sample: { type: "string" },
  },
  strict: true,
});

/**
 * V5.4レビュー修正: 診断・移行系コマンドは起動時にSQLiteを開かない(遅延初期化)。
 * DATABASE_PROVIDER=postgres 設定時でも cloud-readiness / db-export系 / db-import系が
 * 本来の診断・検証処理へ到達できる(openDbのprovider fail closedで先に停止しない)。
 * それ以外の既存コマンドは従来どおり起動時に接続する(挙動不変)。
 */
const DB_LAZY_COMMANDS = new Set(["db-export", "db-export-verify", "db-import-check", "db-import-postgres", "cloud-readiness"]);
let lazyOpened: OpenedDb | null = null;
function getDb(): OpenedDb {
  lazyOpened ??= openDb();
  return lazyOpened;
}
const opened = DB_LAZY_COMMANDS.has(command ?? "") ? null : getDb();
// 遅延コマンド(opened=null)のcase内では db/sqlite を参照しない。必要なら getDb() を使う。
const db = (opened ? opened.db : null) as unknown as OpenedDb["db"];
const sqlite = (opened ? opened.sqlite : null) as unknown as OpenedDb["sqlite"];
const actor = args.actor ?? "system";

const createPostInputSchema = z
  .object({
    pillar: z.enum(["1", "2", "3", "4", "5", "6"]),
    format: z.string().min(1).max(30),
    title: z.string().min(1).max(120),
    plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    templateId: z.enum(TEMPLATE_IDS).optional(),
    portfolioItemId: z.string().optional(),
    /** V10: tpl-sample が紹介するサンプル(site_samples.id) */
    sampleId: z.string().optional(),
  })
  .strict();

/** V10 sample-intake の入力: 依頼ブリーフ + 素材(ファイル名と種別)。ファイルは --dir から input/ へコピーする */
const sampleIntakeInputSchema = sampleRequestInputSchema.extend({
  assets: z.array(sampleAssetInputSchema).min(1).max(10),
});

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
    case "canva-register": {
      // V8(D-18): Canva書き出しPNG一式を外部レンダリングとして登録する。
      // 整合チェーン(最新copy→spec→image)・権利/source検査・ページ数/寸法検査は通常コードが行い、
      // 公開前の紫苑視覚QA・代表者承認は従来どおり必須(スキップ経路なし)。
      if (!args.post || !args.dir || !args.design) {
        fail("--post <id> --dir <PNGディレクトリ> --design <CanvaデザインID> が必要です");
      }
      try {
        const result = await registerCanvaRender(db, args.post, args.dir, args.design, actor);
        out({ ok: true, ...result });
      } catch (error) {
        fail((error as Error).message);
      }
      break;
    }
    case "story-render": {
      // V8(D-18): ストーリー描画(通常コード・文字事故ゼロ)。梓の市場検証仕様(セーフゾーン等)を強制。
      // 出力は data/workspace/08_stories → /stories ページに自動表示。Instagram投稿は代表者がアプリから手動。
      if (!args.json) fail('--json \'{"kind":"story_spec","hook":"...","sub":"...","cta":"...","layout":"hook-center|announce"}\' が必要です');
      try {
        const spec = storySpecSchema.parse(JSON.parse(args.json));
        const slug = (args.output ?? "story").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "story";
        const outFile = path.join(workspaceRoot(), "08_stories", `story-${todayLocal()}-${slug}.png`);
        const file = await renderStory(spec, outFile);
        out({ ok: true, file });
      } catch (error) {
        fail((error as Error).message);
      }
      break;
    }
    case "hybrid-register": {
      // V8(D-18): 表紙のみCanva書き出しPNG、本文〜CTAはSatoriでレンダリングして1カルーセルに結合。
      // 整合チェーン・権利/source検査・全文字レンダリング(本文)は通常コードが担保。紫苑QA・承認は従来どおり必須。
      if (!args.post || !args.cover || !args.design) {
        fail("--post <id> --cover <表紙PNG(1080x1350)> --design <CanvaカバーのデザインID> が必要です");
      }
      try {
        const result = await registerHybridRender(db, args.post, args.cover, args.design, actor);
        out({ ok: true, ...result });
      } catch (error) {
        fail((error as Error).message);
      }
      break;
    }
    case "post-visual-qa": {
      // 投稿実体のPNGを紫苑が目視した結果を、最新のpost_renderへだけ紐付ける。
      // テンプレートpreview用のtemplate-visual-qaとは別物であり、公開前には両方が必要。
      if (!args.post || !args.file) fail("--post <id> --file <visual-qa.json> が必要です");
      if (actor !== "shion") fail("投稿の視覚QAを記録できるのは紫苑(actor=shion)のみです");
      const render = latestPostRender(db, args.post);
      if (!render) fail(`post_renderが見つかりません: ${args.post}(先に pnpm company render --post ${args.post} を実行してください)`);
      const visualQa: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      attachPostRenderVisualQa(db, render.id, visualQa, actor);
      const saved = latestPostRender(db, args.post)!;
      out({ ok: true, postId: args.post, postRenderId: saved.id, result: saved.visualQaResult });
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
    // ---- V10(docs/32): サイトサンプル ----
    case "sample-intake": {
      // 代表者のintake(owner専用)。--dir の画像を input/ へコピーし、権利宣言(attest:true)とともに登録する。
      if (!args.json || !args.dir) fail('--json \'{"slug","industry","persona","planTarget?","pages?","brief?","attest":true,"assets":[{"fileName","kind"}]}\' --dir <画像フォルダ> --actor owner が必要です');
      if (actor !== "owner") fail("サンプル依頼の登録は代表者(actor=owner)のみが行えます");
      const { assets, ...brief } = sampleIntakeInputSchema.parse(JSON.parse(args.json));
      for (const a of assets) {
        if (!existsSync(path.join(args.dir, a.fileName))) fail(`素材ファイルが見つかりません: ${path.join(args.dir, a.fileName)}`);
      }
      const request = createSampleRequest(db, brief, actor);
      const inputDir = sampleInputDir(request.id);
      mkdirSync(inputDir, { recursive: true });
      const registered: unknown[] = [];
      for (const a of assets) {
        copyFileSync(path.join(args.dir, a.fileName), path.join(inputDir, a.fileName));
        // eslint-disable-next-line no-await-in-loop
        const row = await addSampleAsset(db, request.id, a, actor);
        registered.push({ id: row.id, fileName: row.fileName, kind: row.kind, width: row.width, height: row.height, sha256: row.sha256 });
      }
      out({ ok: true, requestId: request.id, slug: request.slug, status: request.status, inputDir, assets: registered });
      break;
    }
    case "sample-asset-add": {
      if (!args.request || !args.json || !args.dir) fail('--request <id> --dir <画像フォルダ> --json \'{"fileName","kind"}\' --actor owner が必要です');
      if (actor !== "owner") fail("サンプル素材の登録は代表者(actor=owner)のみが行えます");
      const a = sampleAssetInputSchema.parse(JSON.parse(args.json));
      const src = path.join(args.dir, a.fileName);
      if (!existsSync(src)) fail(`素材ファイルが見つかりません: ${src}`);
      const inputDir = sampleInputDir(args.request);
      mkdirSync(inputDir, { recursive: true });
      copyFileSync(src, path.join(inputDir, a.fileName));
      const row = await addSampleAsset(db, args.request, a, actor);
      out({ ok: true, id: row.id, fileName: row.fileName, kind: row.kind, width: row.width, height: row.height, sha256: row.sha256 });
      break;
    }
    case "sample-list": {
      // AIプロンプトへ渡す前提のビュー(権利宣言済み素材のみ。referenceは画面に使えない旨を明示)
      out({ ok: true, requests: listSampleRequestsForAi(db, args.status) });
      break;
    }
    case "sample-show": {
      if (!args.request) fail("--request <id> が必要です");
      out({ ok: true, ...getSampleRequest(db, args.request) });
      break;
    }
    case "sample-build": {
      // 颯の site_sample JSON を検証→書き出し→撮影(ネット遮断)→登録。紬の視覚QAタスクを自動生成する。
      if (!args.task || !args.file) fail("--task <颯のタスクid> --file <site-sample.json> --actor hayate が必要です");
      if (actor !== "hayate") fail("sample-build は颯(actor=hayate)のタスク提出としてのみ実行できます");
      const content: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      try {
        const result = await buildSiteSample(db, args.task, content, actor);
        out({ ok: true, ...result, next: `紬の視覚QA: pnpm company start --task ${result.designQaTaskId} --actor tsumugi → 撮影PNGを開いて visual_qa(fidelity付き) → pnpm company sample-visual-qa --sample ${result.sampleId} --task ${result.designQaTaskId} --file <visual-qa.json> --actor tsumugi` });
      } catch (error) {
        if (error instanceof SampleBuildError) fail(`${error.message}${error.violations.length ? `\n- ${error.violations.join("\n- ")}` : ""}`);
        throw error;
      }
      break;
    }
    case "sample-visual-qa": {
      // 紬の視覚QA(忠実度)。site_samples に記録し、--task があれば紬のタスク成果物としても提出する(稼働の見える化)
      if (!args.sample || !args.file) fail("--sample <id> --file <visual-qa.json> [--task <紬のタスクid>] --actor tsumugi が必要です");
      if (actor !== "tsumugi") fail("サンプル画面の視覚QAを記録できるのは紬(actor=tsumugi)のみです");
      const visualQa: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      const recorded = recordSampleDesignQa(db, args.sample, visualQa, actor);
      let artifactId: string | undefined;
      if (args.task) artifactId = submitArtifact(db, args.task, recorded, actor, { estOutputChars: JSON.stringify(recorded).length }).artifactId;
      const sample = getSiteSample(db, args.sample);
      out({ ok: true, sampleId: sample.id, result: recorded.result, fidelity: recorded.fidelity, artifactId, message: recorded.result === "pass" ? "サンプルは投稿に使えます(create-post --json '{\"templateId\":\"tpl-sample\",\"sampleId\":\"…\"}')" : "颯へ差し戻しました(依頼はbuilding)" });
      break;
    }
    case "sample-decline": {
      if (!args.request || !args.reason) fail("--request <id> --reason <理由> --actor owner が必要です");
      declineSampleRequest(db, args.request, args.reason, actor);
      out({ ok: true, requestId: args.request, status: "declined" });
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
    case "export": {
      // V4-B: 承認済み投稿の書き出し(owner専用)。整合性・QA・権利を再検査して bundle 生成
      if (!args.post) fail("--post <id> が必要です");
      // actor未指定(system)をownerへ昇格させない。代表者が --actor owner を明示した場合だけ通る。
      const r = exportPost(db, args.post, actor);
      out({ ok: true, ...r, message: r.skipped ? "既に書き出し済み(冪等)" : `書き出しました: ${r.exportPath}` });
      break;
    }
    case "publish-record": {
      // V4-B: 投稿済み記録(owner専用)。3日/7日後の実績入力タスクを自動作成
      if (!args.post) fail("--post <id> が必要です");
      const r = recordPublish(db, args.post, actor);
      out({ ok: true, ...r, message: "投稿済みとして記録し、実績入力タスクを作成しました" });
      break;
    }
    case "media-upload": {
      // V5.2: export bundleの確定画像を公開ストレージ(Vercel Blob)へアップロード(owner専用)。
      // actor未指定(system)をownerへ昇格させない。--actor owner の明示が必要。
      if (!args.post) fail("--post <id> が必要です");
      const r = await uploadPostMedia(db, args.post, actor);
      out({
        ok: true,
        postId: r.postId,
        provider: r.provider,
        imageCount: r.images.length,
        uploadedCount: r.uploadedCount,
        reusedCount: r.reusedCount,
        urls: r.images.map((i) => i.publicUrl),
        message: `公開画像を準備しました(新規${r.uploadedCount}件・再利用${r.reusedCount}件)。Instagramへはまだ投稿されていません`,
      });
      break;
    }
    case "instagram-reconcile": {
      // V5.5: 公開結果不明(needs_reconciliation)の解消(owner専用)。Metaへは何も送らない。
      // 代表者がInstagramアプリを確認した結果を --outcome not_published | published で記録する。
      if (!args.post) fail("--post <id> が必要です");
      const outcome = args.outcome;
      if (outcome !== "not_published" && outcome !== "published") fail("--outcome not_published または published が必要です");
      const input = outcome === "published"
        ? { outcome, instagramMediaId: args.mediaId ?? "" }
        : { outcome };
      const r = reconcileInstagramJob(db, args.post, actor, input as Parameters<typeof reconcileInstagramJob>[3]);
      out({
        ok: true, ...r,
        message: outcome === "not_published"
          ? "未投稿を確認として記録しました。公開準備画面から再実行できます"
          : "投稿済みとして記録し、ローカルの投稿状態を揃えました",
      });
      break;
    }
    case "idea-add": {
      // V7: 代表者アイデアボックス(owner専用)。思いつきを記録し、kickoff/weekly-reviewが実行に変換する
      if (!args.text) fail("--text \"<アイデア>\" が必要です");
      const r = addOwnerIdea(db, args.text, actor);
      out({ ok: true, ...r, message: "アイデアを記録しました。次回のkickoff/weekly-reviewで実行方法を検討します" });
      break;
    }
    case "idea-list": {
      out({ ok: true, ideas: listOwnerIdeas(db, { status: args.status }) });
      break;
    }
    case "idea-update": {
      if (!args.idea) fail("--idea <id> が必要です");
      if (!args.status) fail("--status new|planned|in_progress|done|declined が必要です");
      const r = updateOwnerIdea(db, args.idea, { status: args.status, resolution: args.resolution, refPostId: args.post, refTaskId: args.task }, actor);
      out({ ok: true, idea: r });
      break;
    }
    case "instagram-dry-run": {
      // V5.2: Metaへ一切送信しないdry-run(owner専用)。META_PUBLISH_MODEは変更しない。
      if (!args.post) fail("--post <id> が必要です");
      const report = runInstagramDryRun(db, args.post, actor);
      out({ ok: true, ...report });
      break;
    }
    case "instagram-readiness": {
      // V5.2: 秘密値を含まない接続状態(誰でも参照可)。ストレージ設定状態も表示する。
      const storage = new VercelBlobStorage();
      const readiness = getInstagramReadiness(process.env, { mediaStorageConfigured: storage.isConfigured() });
      out({ ok: true, ...readiness, storageProvider: storage.provider, storageConfigured: storage.isConfigured() });
      break;
    }
    case "weekly-report": {
      // V4-C: 週報(通常コード集計)。--date で週を指定(既定は本日を含む週)
      const ref = args.date ?? todayLocal();
      const { start, end } = weekRange(ref);
      out({ ok: true, report: buildPeriodReport(db, "weekly", start, end) });
      break;
    }
    case "monthly-report": {
      const ref = args.date ?? todayLocal();
      const { start, end } = monthRange(ref);
      out({ ok: true, report: buildPeriodReport(db, "monthly", start, end) });
      break;
    }
    case "meeting-save": {
      // V4-C: 週次/月次会議の議事録保存(オーケストレーターが weekly-review skill 経由で実行)
      if (!args.file) fail("--file <minutes.json> が必要です");
      const content: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      const r = saveMeeting(db, content, actor);
      out({ ok: true, ...r, message: "議事録を保存しました" });
      break;
    }
    case "backup": {
      // V4-E: 整合スナップショット(VACUUM INTO)+ workspace + manifest(SHA-256)。14世代保持
      const date = args.date ?? todayLocal();
      const { dir, manifest } = createBackup(date);
      out({ ok: true, dir, dbSha256: manifest.dbSha256, dbBytes: manifest.dbBytes, workspaceIncluded: manifest.workspaceIncluded, message: `バックアップを作成しました: ${dir}` });
      break;
    }
    case "backup-list": {
      const backups = listBackups();
      out({ ok: true, count: backups.length, backups });
      break;
    }
    case "restore": {
      // V4-E: checksum検証 → 一時領域で doctor 検証 → atomic置換。復元前に現DBを自動バックアップ
      if (!args.from) fail("--from <YYYY-MM-DD> が必要です。pnpm company backup-list で候補を確認してください");
      // 現在の接続を閉じ、復元後は再度開いて doctor を出す
      const result = restoreBackup(args.from, {
        closeCurrent: () => sqlite.close(),
        verify: (testDb) => doctorScan(testDb),
      });
      const reopened = openDb();
      const findings = doctorScan(reopened.db).filter((f) => f.level === "error");
      reopened.sqlite.close();
      out({ ok: findings.length === 0, ...result, message: `${result.restoredFrom} から復元しました(復元前バックアップ: ${result.preRestoreBackup || "なし"})`, remainingErrors: findings });
      break;
    }
    case "template-preview": {
      // V4.5 v2: ゴールデンプレビューを生成(draft登録。自己承認はしない)。
      // --all で4系統一括、--template <id> で1系統のみ(他系統の版番号を進めない)
      if (!args.all && !args.template) fail("--all(4系統すべて)または --template <id>(1系統のみ)が必要です");
      const onlyTemplate = args.template;
      if (onlyTemplate && !(TEMPLATE_IDS as readonly string[]).includes(onlyTemplate)) {
        fail(`不明なテンプレートです: ${onlyTemplate}(${TEMPLATE_IDS.join(" / ")})`);
      }
      const previewVersion = args.version ? Number(args.version) : 1;
      const versions = onlyTemplate
        ? [ensureTemplateVersionAt(db, onlyTemplate, previewVersion, actor)]
        : registerAllTemplateVersionsAt(db, previewVersion, actor);
      const statusOf = (templateId: string): string =>
        versions.find((v) => v.templateId === templateId)?.status ?? "draft";
      const outRoot = path.join(workspaceRoot(), "06_template-previews");
      const metas = await generateTemplatePreviews(outRoot, { version: previewVersion, statusOf, only: onlyTemplate });
      // variantごとのcontent/mechanical QA・プレビュー完了・fingerprint・fixture種別・権利・layoutId/画像hashを保存
      for (const m of metas) {
        upsertTemplateVariantQa(db, {
          templateId: m.templateId, version: m.version, variant: m.variant, fingerprint: m.fingerprint,
          contentQaResult: m.contentQa.result, mechanicalQaResult: m.designQa.result,
          previewComplete: true, pageCount: m.pageCount, fixtureKind: m.fixtureKind, rights: m.rights,
          layoutIds: m.layoutIds, pageHashes: m.pageHashes,
        }, actor);
      }
      // family別のvariant差分(01〜05で3ページ以上異なるか)
      const families = [...new Set(metas.map((m) => m.templateId))].map((id) => {
        const vs = metas.filter((m) => m.templateId === id);
        const n = vs.length === 2 ? distinctInteriorPageCount({ layoutIds: vs[0]!.layoutIds, pageHashes: vs[0]!.pageHashes }, { layoutIds: vs[1]!.layoutIds, pageHashes: vs[1]!.pageHashes }) : 0;
        return { templateId: id, distinctInteriorPages: n, distinctOk: n >= MIN_DISTINCT_INTERIOR_PAGES };
      });
      out({
        ok: metas.every((m) => m.designQa.result === "pass" && m.contentQa.result === "pass") && families.every((f) => f.distinctOk),
        version: previewVersion, outRoot, overview: path.join(outRoot, "overview.png"),
        comparison: previewVersion >= 3 ? path.join(outRoot, "v2-v3-comparison.png") : undefined,
        families,
        previews: metas.map((m) => ({
          templateId: m.templateId, family: m.family, version: m.version, variant: m.variant,
          fingerprint: m.fingerprint, pageCount: m.pageCount, status: m.status, fixtureKind: m.fixtureKind,
          contentQa: m.contentQa.result, designQa: m.designQa.result, layoutIds: m.layoutIds,
          dir: path.join(outRoot, m.templateId, `v${m.version}`, m.variant),
        })),
        note: "テンプレートは自己承認していません。visual QA(紫苑)は未実施。http://localhost:3000/templates で全variantを確認し、代表者が承認してください。",
      });
      break;
    }
    case "template-list": {
      out({ ok: true, templates: listTemplateVersions(db), variantQa: args.template ? listTemplateVariantQa(db, args.template, args.version ? Number(args.version) : currentTemplateVersion(db, args.template)) : undefined });
      break;
    }
    case "template-visual-qa": {
      // V4.5 v3: 紫苑の視覚QA結果を記録(Zod検証・fail closed)。DBとmeta.jsonの両方へ反映(整合)
      if (!args.file) fail("--file <visual-qa.json>(templateId/version/variant/visualQa の配列)が必要です");
      const entries = JSON.parse(readFileSync(args.file, "utf8")) as { templateId: string; version: number; variant: string; visualQa: unknown }[];
      const outRoot = path.join(workspaceRoot(), "06_template-previews");
      const recorded = entries.map((e) => {
        const r = recordTemplateVisualQa(db, e, actor === "system" ? "shion" : actor);
        reconcileVisualQaInMeta(outRoot, e.templateId, e.version, e.variant, e.visualQa); // meta.json ↔ DB 整合
        return { templateId: e.templateId, version: e.version, variant: e.variant, result: r.visualQaResult };
      });
      out({ ok: true, recorded });
      break;
    }
    case "template-decide": {
      // V4.5: テンプレート版の承認/却下/修正依頼(owner専用)。CLIからは基本使わず、UI経由を推奨
      if (!args.template) fail("--template <id> が必要です");
      if (!args.decision) fail("--decision <approved|rejected|revision_requested> が必要です");
      const decision = args.decision as TemplateDecision;
      if (!["approved", "rejected", "revision_requested"].includes(decision)) fail("不正な--decision");
      const version = args.version ? Number(args.version) : currentTemplateVersion(db, args.template);
      // actor未指定(system)をownerへ昇格させない。代表者が --actor owner を明示した場合だけ通る(UI経由を推奨)
      const row = decideTemplateVersion(db, { templateId: args.template, version, decision, note: args.note }, actor);
      out({ ok: true, template: row });
      break;
    }
    case "doctor": {
      const findings = doctorScan(db);
      out({ ok: findings.filter((f) => f.level === "error").length === 0, findings });
      break;
    }
    case "db-export": {
      // V5.4: SQLite→中間形式(JSONL+manifest)。読み取り専用接続のため実DBは変更されない。
      // actor未指定(system)をownerへ昇格させない。--actor owner の明示が必要。
      const r = runDbExport(actor, { outDir: args.output });
      out({
        ok: true,
        outDir: r.outDir,
        schemaVersion: r.manifest.schemaVersion,
        totalRows: r.manifest.totalRows,
        tables: r.manifest.tables.map((tb) => ({ name: tb.name, rows: tb.rows })),
        message: `エクスポートしました(実DBは変更していません)。検証: pnpm company db-export-verify --from ${r.outDir}`,
      });
      break;
    }
    case "db-export-verify": {
      if (!args.from) fail("--from <エクスポートディレクトリ> が必要です");
      const report = verifyDbExport(args.from);
      out(report);
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case "db-import-check": {
      if (!args.from) fail("--from <エクスポートディレクトリ> が必要です");
      const report = checkImportSource(args.from);
      out(report);
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case "db-import-postgres": {
      // V5.4: 既定はdry-run。--execute でも provider/URL未設定なら拒否し、実接続実装が無い間は必ず停止する。
      if (!args.from) fail("--from <エクスポートディレクトリ> が必要です");
      const r = runPostgresImport(args.from, actor, { execute: args.execute });
      out(r);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case "analytics-snapshot": {
      // V6-B: 通常コード集計の分析スナップショット(冪等。同じ入力なら既存を返す)。AI不使用。
      if (args.window && !["3", "7"].includes(args.window)) fail("--window は 3 または 7 を指定してください");
      const results = args.window
        ? [createAnalysisSnapshot(db, Number(args.window) as AnalysisWindow, actor)]
        : createAllWindowSnapshots(db, actor);
      out({
        ok: true,
        snapshots: results.map((r) => ({
          windowDays: r.windowDays,
          snapshotId: r.snapshotId,
          created: r.created,
          sourceDataHash: r.sourceDataHash,
          publishedCount: r.facts.dataCoverage.publishedCount,
          measuredCount: r.facts.dataCoverage.measuredCount,
          warnings: r.facts.warnings,
        })),
      });
      break;
    }
    case "analytics-show": {
      const windows: AnalysisWindow[] = args.window ? [Number(args.window) as AnalysisWindow] : [...ANALYSIS_WINDOWS];
      if (windows.some((w) => !ANALYSIS_WINDOWS.includes(w))) fail("--window は 3 または 7 を指定してください");
      const shown = windows.map((w) => {
        const snap = latestAnalysisSnapshot(db, w);
        return snap
          ? { windowDays: w, snapshotId: snap.id, generatedAt: snap.generatedAt, sourceDataHash: snap.sourceDataHash, facts: snap.facts }
          : { windowDays: w, snapshotId: null, message: "スナップショットがありません(pnpm company analytics-snapshot を実行)" };
      });
      out({ ok: true, snapshots: shown });
      break;
    }
    case "improvement-proposal-save": {
      // V6-C: AI社員の改善提案の保存。evidence実在・断定表現は通常コードが検査して拒否する。
      if (!args.file) fail("--file <proposal.json> が必要です");
      const raw: unknown = JSON.parse(readFileSync(args.file, "utf8"));
      const r = saveImprovementProposal(db, raw, actor);
      out({ ok: true, proposalId: r.proposalId, message: "改善提案を保存しました(CEO判断待ち。承認前はkickoffへ渡りません)" });
      break;
    }
    case "improvement-list": {
      out({ ok: true, proposals: listImprovementProposals(db) });
      break;
    }
    case "improvement-decide": {
      // V6-C: CEO判断(owner専用)。actor未指定(system)をownerへ自動昇格させない。
      if (!args.proposal) fail("--proposal <id> が必要です");
      if (!args.decision) fail(`--decision <${IMPROVEMENT_DECISIONS.join("|")}> が必要です`);
      const r = decideImprovementProposal(
        db,
        { proposalId: args.proposal, decision: args.decision as V6Decision, reason: args.reason },
        actor,
      );
      out({ ok: true, ...r });
      break;
    }
    case "improvement-directives": {
      // V6-E: 次回kickoffへ渡せる承認済み・期限内の改善指示(最大3件)
      const directives = listApprovedDirectives(db);
      out({
        ok: true,
        count: directives.length,
        maxPerKickoff: 3,
        directives: directives.map((d) => ({
          proposalId: d.id,
          title: d.title,
          testVariable: d.testVariable,
          testChange: d.testChange,
          proposedAction: d.proposedAction,
          expectedSignal: d.expectedSignal,
          expiresAt: d.expiresAt,
          evidenceRefs: d.evidenceRefs,
        })),
      });
      break;
    }
    case "improvement-apply": {
      // V6-E: 改善指示の投稿への適用記録。(post, proposal)一意でkickoff再実行の二重適用を防ぐ。
      if (!args.post || !args.proposal) fail("--post <id> --proposal <id> が必要です");
      const r = applyImprovementDirective(db, { postId: args.post, proposalId: args.proposal, reason: args.reason }, actor);
      out({ ok: true, ...r, message: r.created ? "適用を記録しました" : "既に適用済みのため記録を再利用しました(二重適用なし)" });
      break;
    }
    case "business-outcome-add": {
      // V6-G: 匿名の事業成果(owner専用)。個人情報らしい入力は通常コードが拒否する。
      if (!args.json) fail('--json \'{"occurredOn":"YYYY-MM-DD","kind":"inquiry|estimate|order","source":"instagram|referral|website|unknown",...}\' が必要です');
      const r = addBusinessOutcome(db, JSON.parse(args.json), actor);
      out({ ok: true, outcomeId: r.outcomeId, message: "事業成果を記録しました(匿名・顧客特定情報なし)" });
      break;
    }
    case "analytics-cron-dry-run": {
      // V6-I: Cron処理本体のdry-run。DBへ書き込まない。Meta・AIも呼ばない。
      const result = runScheduledAnalytics(db, { dryRun: true });
      out({ ok: true, ...result, note: "dry-runのためDBへは書き込んでいません。実Cronはproduction+PostgreSQL実装完了までnot_readyです" });
      break;
    }
    case "cloud-readiness": {
      // V5.4: 秘密値を一切含まない移行準備診断(読み取り専用)。
      // provider=sqliteのときだけ遅延接続して読み取り確認する。postgres(未実装)や
      // provider設定不備でもここで落ちず、buildCloudReadinessがblockerとして報告する。
      let sqliteQueryOk = false;
      try {
        if (resolveDatabaseProvider(process.env).provider === "sqlite") {
          getDb().db.select().from(t.settings).limit(1).all();
          sqliteQueryOk = true;
        }
      } catch {
        sqliteQueryOk = false;
      }
      let backupCount = 0;
      try {
        backupCount = listBackups().length;
      } catch {
        backupCount = 0;
      }
      const storage = new VercelBlobStorage();
      const report = buildCloudReadiness(process.env, {
        sqliteQueryOk,
        blobConfigured: storage.isConfigured(),
        backupCount,
      });
      out(report);
      if (!report.ok) process.exitCode = 1;
      break;
    }
    default:
      fail(`不明なコマンド: ${command ?? "(なし)"}。${HELP_HINT}`);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
