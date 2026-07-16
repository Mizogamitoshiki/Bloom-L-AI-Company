/** E2E用シード。一時DB/workspaceだけに、各検収シナリオ専用の投稿を用意する。 */
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../src/adapters/db/client";
import {
  ensureSeedOrg,
  createPost,
  createTask,
  startTask,
  submitArtifact,
  submitQa,
  addPortfolioItem,
  runStart,
  currentTemplateVersion,
  getTemplateVersion,
  decideTemplateVersion,
  upsertTemplateVariantQa,
  recordTemplateVisualQa,
  attachPostRenderVisualQa,
  latestPostRender,
} from "../src/adapters/db/store";
import * as t from "../src/adapters/db/schema";
import { TEMPLATES } from "../src/core/templates/index";
import { renderPost } from "../src/adapters/render/render-post";
import { businessDate, ulid } from "../src/core/ids";

/** テスト設定の合格visual QA(本番経路には注入しない) */
const E2E_VISUAL_QA = { kind: "visual_qa" as const, result: "pass" as const, criticalIssues: [], minorIssues: [], revisionInstructions: [], pageFindings: [] };

/** tpl-howtoの全variantにQAを投入し承認する(E2Eのexportシナリオが通るように) */
function approveHowtoForE2E(db: Db): void {
  const templateId = "tpl-howto";
  const version = currentTemplateVersion(db, templateId);
  const tv = getTemplateVersion(db, templateId, version)!;
  for (const variant of (TEMPLATES as Record<string, { variants: readonly string[] }>)[templateId]!.variants) {
    const layoutIds = [`cover-${variant}`, `p1-${variant}`, `p2-${variant}`, `p3-${variant}`, `p4-${variant}`, "cta"];
    const pageHashes = layoutIds.map((_, i) => `${variant}-h${i}`);
    upsertTemplateVariantQa(db, {
      templateId, version, variant, fingerprint: tv.fingerprint, contentQaResult: "pass", mechanicalQaResult: "pass",
      previewComplete: true, pageCount: 6, fixtureKind: "fictional", rights: "架空データ・Bloom-L所有素材", layoutIds, pageHashes,
    });
    recordTemplateVisualQa(db, { templateId, version, variant, visualQa: E2E_VISUAL_QA });
  }
  decideTemplateVersion(db, { templateId, version, decision: "approved" }, "owner");
}

export const E2E_PLAN = {
  kind: "post_plan" as const,
  theme: "HPがない事業者の見せ方",
  pillar: "6" as const,
  format: "carousel",
  target: "泉州地域のHP未保有の個人事業主",
  outline: ["現状の課題", "できること3つ", "まとめ"],
  ctaIdea: "DMで相談",
  sourceIds: [],
};

export const E2E_COPY = {
  kind: "copy" as const,
  headline: "HPがなくても、まず「見せ方」から",
  body: "泉州地域でHPをまだ持っていない事業者さま向けに、今すぐできる情報発信の整え方を3つにまとめました。保存して見返してください。",
  cta: "気になった方はDMで「相談」とお送りください",
  hashtags: ["#泉州", "#岸和田", "#ホームページ制作", "#個人事業主", "#集客"],
  slides: {
    cover: { title: "HPがなくても始める見せ方", subtitle: "泉州の事業者さま向け・保存版" },
    pages: [
      { heading: "課題を知る", body: "検索しても情報が出てこないと、お客様は不安になります。" },
      { heading: "できること", body: "営業時間・場所・実績を、まず1か所に整理しましょう。" },
      { heading: "次の一歩", body: "反応が出てきたら、HPで信頼をさらに積み上げます。" },
    ],
    ctaMessage: "続きはDMでご相談ください",
  },
};

export const E2E_QA_PASS = {
  kind: "qa_report" as const,
  result: "pass" as const,
  checklist: [
    { item: "誤字脱字", ok: true },
    { item: "禁止表現(効果保証・価格)", ok: true },
    { item: "文字数・文字切れ検査結果", ok: true },
  ],
  issues: [],
};

export const E2E_POST_TITLE = "E2E公開テスト投稿";
export const E2E_REVISION_TITLE = "E2E修正フロー投稿";
export const E2E_KEYBOARD_TITLE = E2E_REVISION_TITLE;
export const E2E_BLOCKED_TITLE = "E2E権利未確認投稿";

function insertPostForE2E(db: Db, title: string, date: string): typeof t.posts.$inferSelect {
  const id = ulid();
  db.insert(t.posts).values({
    id,
    pillar: "6",
    format: "carousel",
    title,
    status: "idea",
    plannedDate: date,
    publishMethod: "manual",
    rightsState: "n/a",
    templateId: "tpl-howto",
    createdAt: date,
  }).run();
  return db.select().from(t.posts).where(eq(t.posts.id, id)).get()!;
}

async function seedApprovalPost(db: Db, ws: string, title: string, date: string, guardedCreate: boolean): Promise<void> {
  // E2Eでは独立シナリオを複数用意するため、2本目以降は日次生成上限の対象外fixtureとして直接挿入する。
  const post = guardedCreate ? createPost(db, { pillar: "6", format: "carousel", title }, "aoi") : insertPostForE2E(db, title, date);
  const suffix = post.id.slice(-6);
  const planTask = createTask(db, { type: "plan_posts", title: `企画 ${title}`, assigneeId: "emp_sora", postId: post.id, stepKey: `plan-${suffix}`, priority: 5 }, date).task;
  startTask(db, planTask.id, "sora");
  submitArtifact(db, planTask.id, E2E_PLAN, "sora");
  const copyTask = createTask(db, { type: "write_copy", title: `コピー ${title}`, assigneeId: "emp_kotoha", postId: post.id, stepKey: `copy-${suffix}`, priority: 5 }, date).task;
  startTask(db, copyTask.id, "kotoha");
  submitArtifact(db, copyTask.id, E2E_COPY, "kotoha");
  await renderPost(db, post.id, "system", { outDirBase: path.join(ws, "05_generated-posts") });
  // 実運用と同じ順序(V5.1): 紫苑の視覚QA(PNG確認)に合格してから内容QAを提出する
  const render = latestPostRender(db, post.id);
  if (render) attachPostRenderVisualQa(db, render.id, E2E_VISUAL_QA);
  const qaTask = createTask(db, { type: "qa", title: `QA ${title}`, assigneeId: "emp_shion", postId: post.id, stepKey: `qa-${suffix}`, priority: 4 }, date).task;
  startTask(db, qaTask.id, "shion");
  submitQa(db, qaTask.id, E2E_QA_PASS, "shion");
}

export async function seedE2E(): Promise<void> {
  const ws = process.env.BLOOM_WORKSPACE_PATH;
  if (!ws) throw new Error("BLOOM_WORKSPACE_PATH が未設定です(E2Eシードは一時領域のみに書き込みます)");
  const { db, sqlite } = openDb();
  try {
    ensureSeedOrg(db);
    const date = businessDate();
    runStart(db, "e2e");
    // heartbeat途絶を表示する専用fixture。実イベントはあるが30分更新されていない。
    const staleTask = createTask(db, {
      type: "plan_posts", title: "E2E heartbeat途絶", assigneeId: "emp_sora", stepKey: "e2e-stale", priority: 5,
    }, date).task;
    startTask(db, staleTask.id, "sora");
    db.update(t.taskEvents)
      .set({ ts: new Date(Date.now() - 30 * 60_000).toISOString() })
      .where(eq(t.taskEvents.taskId, staleTask.id)).run();
    await seedApprovalPost(db, ws, E2E_POST_TITLE, date, true);
    await seedApprovalPost(db, ws, E2E_REVISION_TITLE, date, false);
    // V4.5 v2公開停止ガード: 全variantのQAを揃えてtpl-howtoテンプレート版を代表者が承認
    approveHowtoForE2E(db);

    const portfolio = addPortfolioItem(db, { customerName: "E2E権利確認前顧客", anonymousName: "匿名事業者" }, "owner");
    const item = db.select().from(t.portfolioItems).where(eq(t.portfolioItems.permissionId, portfolio.permissionId)).get()!;
    db.insert(t.posts).values({
      id: ulid(), pillar: "5", format: "carousel", title: E2E_BLOCKED_TITLE, status: "drafting",
      plannedDate: date, publishMethod: "manual", rightsState: "blocked_rights", templateId: "tpl-portfolio",
      portfolioItemId: item.id, createdAt: date,
    }).run();
  } finally {
    sqlite.close();
  }
}
