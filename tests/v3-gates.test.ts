/**
 * V3-A/B/C/H/J: QAゲート・sources・権利・上限・旧データ互換のテスト。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg,
  createPost,
  createTask,
  startTask,
  submitArtifact,
  submitQa,
  decidePost,
  listApprovalQueue,
  addSource,
  linkSourceToPost,
  addPortfolioItem,
  updatePermission,
  checkPortfolioRights,
  getGenerationPause,
  resumeGeneration,
} from "@adapters/db/store";
import { buildDailyReport, doctorScan } from "@adapters/db/views";
import { businessDate } from "@core/ids";
import { renderPost, RightsError } from "@adapters/render/render-post";
import { PLAN, COPY, QA_PASS, SOURCE_A , ensureEvidenceFile } from "./fixtures";

let dir: string;
let imgDir: string;
let opened: OpenedDb;
const DATE = businessDate(); // 業務日(JST)。日報・createdAtと同一日にそろえる

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v3-"));
  imgDir = mkdtempSync(path.join(tmpdir(), "bloom-v3-img-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(imgDir, { recursive: true, force: true });
});

function makeHowtoPost(overrides: { title?: string; pillar?: "1" | "3" | "6"; copy?: typeof COPY } = {}): string {
  const post = createPost(
    opened.db,
    { pillar: overrides.pillar ?? "6", format: "carousel", title: overrides.title ?? "V3テスト投稿" },
    "aoi",
  );
  const planTask = createTask(opened.db, { type: "plan_posts", title: `企画:${post.id}`, assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, { ...PLAN, pillar: overrides.pillar ?? "6" }, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: `コピー:${post.id}`, assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, overrides.copy ?? COPY, "kotoha");
  return post.id;
}

function qaTask(postId: string, stepKey = "qa"): string {
  const task = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey, priority: 4 }, DATE).task;
  startTask(opened.db, task.id, "shion");
  return task.id;
}

async function render(postId: string): Promise<void> {
  await renderPost(opened.db, postId, "system", { outDirBase: imgDir });
}

describe("V3-A: QA構造ルールと禁止語(通常コード検査)", () => {
  it("passなのにchecklistにfalseがあると拒否される", async () => {
    const postId = makeHowtoPost();
    await render(postId);
    const qa = qaTask(postId);
    const bad = { ...QA_PASS, checklist: [...QA_PASS.checklist, { item: "権利", ok: false }] };
    expect(() => submitQa(opened.db, qa, bad, "shion")).toThrow(/不合格項目/);
  }, 60_000); // Sharp/Satoriを使うため、全スイート並列時も既定5秒に依存させない

  it("passなのにissues(重大指摘)が残ると拒否される。notes(軽微)は両立できる", async () => {
    const postId = makeHowtoPost();
    await render(postId);
    const qa = qaTask(postId);
    expect(() => submitQa(opened.db, qa, { ...QA_PASS, issues: ["重大な問題"] }, "shion")).toThrow(/重大指摘/);
    const r = submitQa(opened.db, qa, { ...QA_PASS, notes: ["表記ゆれの確認をお願いします"] }, "shion");
    expect(r.result).toBe("pass");
    const item = listApprovalQueue(opened.db).find((i) => i.post.id === postId)!;
    expect(item.qa!.notes).toContain("表記ゆれの確認をお願いします");
  }, 60_000);

  it("効果保証表現はAIがpassと申告しても通常コードが拒否する", async () => {
    const copy = { ...COPY, body: COPY.body + "\n導入すれば必ず売上が増えます。" };
    const postId = makeHowtoPost({ copy });
    await render(postId);
    const qa = qaTask(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/禁止表現.*効果保証/);
  }, 60_000);

  it("竹プランの仮価格は公開コンテンツに出せない", async () => {
    const copy = { ...COPY, body: COPY.body + "\nCMS付きプランは12万円でご提供中です。" };
    const postId = makeHowtoPost({ copy });
    await render(postId);
    const qa = qaTask(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/竹プラン仮価格/);
  }, 60_000);

  it("blocked_rightsは承認キューへ進まず、rights_stateで識別される", async () => {
    const postId = makeHowtoPost();
    await render(postId);
    const qa = qaTask(postId);
    const blocked = { ...QA_PASS, result: "blocked_rights", issues: ["顧客許可が未取得"] };
    const r = submitQa(opened.db, qa, blocked, "shion");
    expect(r.result).toBe("blocked_rights");
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("drafting");
    expect(post.rightsState).toBe("blocked_rights");
    expect(listApprovalQueue(opened.db)).toHaveLength(0);
  }, 60_000);
});

describe("V3-B: sources", () => {
  it("同一URLの重複登録は既存IDを返す", () => {
    const r1 = addSource(opened.db, SOURCE_A, "rin");
    const r2 = addSource(opened.db, SOURCE_A, "rin");
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.id).toBe(r1.id);
  });

  it("取得できなかったページは未確認(usable=false)になる", () => {
    const r = addSource(opened.db, { ...SOURCE_A, url: "https://example.com/unreachable", fetched: false }, "rin");
    const row = opened.db.select().from(t.sources).where(eq(t.sources.id, r.id)).get()!;
    expect(row.verificationStatus).toBe("unconfirmed");
    expect(row.usable).toBe(0);
  });

  it("ニュース系の柱(1)はsourceなしではQA合格できない", async () => {
    const postId = makeHowtoPost({ pillar: "1" });
    await render(postId);
    const qa = qaTask(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/source/);
  }, 60_000);

  it("「最新」は公開日+確認日の揃ったsourceがないと使えない。あれば使える", async () => {
    const copy = { ...COPY, body: COPY.body + "\n最新の動向も踏まえてご案内します。" };
    const postId = makeHowtoPost({ copy });
    await render(postId);
    const qa1 = qaTask(postId, "qa-1");
    expect(() => submitQa(opened.db, qa1, QA_PASS, "shion")).toThrow(/「最新」/);
    const src = addSource(opened.db, SOURCE_A, "rin");
    linkSourceToPost(opened.db, postId, src.id, "aoi");
    const qa2 = qaTask(postId, "qa-2");
    expect(submitQa(opened.db, qa2, QA_PASS, "shion").result).toBe("pass");
  }, 60_000);

  it("統計系の主張は単一情報源では断定できない(2件必要)", async () => {
    const copy = { ...COPY, body: COPY.body + "\nある調査によると多くの人が来店前に検索しています。" };
    const postId = makeHowtoPost({ copy });
    await render(postId);
    const src = addSource(opened.db, SOURCE_A, "rin");
    linkSourceToPost(opened.db, postId, src.id, "aoi");
    const qa = qaTask(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/2件以上/);
  }, 60_000);
});

describe("V3-C: 実績素材・公開許可", () => {
  function makePortfolio(): { itemId: string; permissionId: string } {
    return addPortfolioItem(
      opened.db,
      { customerName: "テスト工務店", anonymousName: "泉州の工務店さま", siteUrl: "https://example.com" },
      "owner",
    );
  }

  it("登録直後はpendingで、実名利用不可", () => {
    const { itemId } = makePortfolio();
    const rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.allowed).toBe(false);
    expect(rc.reason).toContain("pending");
  });

  it("匿名利用許可(証跡必須)で匿名名、approved+scope.nameで実名、revokedで不可", () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "pending", anonymousAllowed: true, evidencePath: ensureEvidenceFile() }, "owner");
    let rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.allowed).toBe(true);
    expect(rc.mode).toBe("anonymous");
    expect(rc.displayName).toBe("泉州の工務店さま");

    updatePermission(
      opened.db,
      permissionId,
      { status: "approved", evidencePath: ensureEvidenceFile(), scope: { name: true, url: true, screenshot: false, testimonial: false } },
      "owner",
    );
    rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.mode).toBe("customer");
    expect(rc.displayName).toBe("テスト工務店");
    expect(rc.allowedUses.screenshot).toBe(false);

    updatePermission(opened.db, permissionId, { status: "revoked" }, "owner");
    expect(checkPortfolioRights(opened.db, itemId).allowed).toBe(false);
  });

  it("approvedには証跡+scope(4項目個別)が必須。許可変更はowner以外不可", () => {
    const { permissionId } = makePortfolio();
    expect(() => updatePermission(opened.db, permissionId, { status: "approved" }, "owner")).toThrow(/証跡/);
    expect(() =>
      updatePermission(opened.db, permissionId, { status: "approved", evidencePath: ensureEvidenceFile() }, "owner"),
    ).toThrow(/許可範囲.*個別/);
    expect(() => updatePermission(opened.db, permissionId, { status: "approved", evidencePath: ensureEvidenceFile() }, "aoi")).toThrow(/代表者/);
  });

  it("許可のない顧客名が公開テキストに含まれるとQA合格できない(名前漏えい検査)", async () => {
    makePortfolio(); // pending のまま
    const copy = { ...COPY, body: COPY.body + "\nテスト工務店さまの事例です。" };
    const postId = makeHowtoPost({ copy });
    await render(postId);
    const qa = qaTask(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/公開許可のない顧客名/);
  }, 60_000);
});

describe("V3-H: 上限・安全停止", () => {
  it("1日の新規投稿上限(3本)を超えると4本目は作成できない", () => {
    makeHowtoPostTitleOnly("1本目");
    makeHowtoPostTitleOnly("2本目");
    makeHowtoPostTitleOnly("3本目");
    expect(() => makeHowtoPostTitleOnly("4本目")).toThrow(/新規投稿上限/);
  });

  function makeHowtoPostTitleOnly(title: string): void {
    createPost(opened.db, { pillar: "6", format: "carousel", title }, "aoi");
  }

  it("承認待ちがsoft_cap(5件)以上だと生成が自動停止し、代表者のみ再開できる", () => {
    // 承認待ち5件を直接用意(表示・件数判定のためのデータ)
    for (let i = 0; i < 5; i++) {
      opened.db
        .insert(t.posts)
        .values({ id: `awaiting-${i}`, pillar: "6", format: "carousel", title: `待機${i}`, status: "awaiting_approval", publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto" })
        .run();
    }
    expect(() => createPost(opened.db, { pillar: "6", format: "carousel", title: "新規" }, "aoi")).toThrow(/承認待ち/);
    const pause = getGenerationPause(opened.db);
    expect(pause).not.toBeNull();
    // 停止中は生成系タスクも作成不可
    expect(() =>
      createTask(opened.db, { type: "plan_posts", title: "x", assigneeId: "emp_sora", stepKey: "p", priority: 5 }, DATE),
    ).toThrow(/停止中/);
    // qa等の非生成系は作成できる(承認処理は継続可能)
    // 再開はowner以外不可
    expect(() => resumeGeneration(opened.db, "aoi")).toThrow(/代表者/);
    resumeGeneration(opened.db, "owner");
    expect(getGenerationPause(opened.db)).toBeNull();
    // 監査ログに停止・再開が記録される
    const audits = opened.db.select().from(t.auditLog).where(eq(t.auditLog.subjectId, "generation_paused")).all();
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["generation_pause", "generation_resume"]));
  });
});

describe("V3-J: 旧データ互換・エラー表示", () => {
  it("旧形式spec(sourceCopyArtifactIdなし)でも承認キューは500にならず、要修復として表示される", async () => {
    const brokenId = makeHowtoPost({ title: "旧形式の投稿" });
    await render(brokenId);
    const qa1 = qaTask(brokenId, "qa-b");
    submitQa(opened.db, qa1, QA_PASS, "shion");
    // 最新specを旧形式に改変(P1修正前のデータを再現)
    const spec = opened.db
      .select()
      .from(t.artifacts)
      .where(and(eq(t.artifacts.postId, brokenId), eq(t.artifacts.kind, "carousel_spec")))
      .get()!;
    const legacy = JSON.parse(spec.contentJson!) as Record<string, unknown>;
    delete legacy.sourceCopyArtifactId;
    opened.sqlite.prepare("update artifacts set content_json = ? where id = ?").run(JSON.stringify(legacy), spec.id);

    // 正常な投稿も1件用意
    const okId = makeHowtoPost({ title: "正常な投稿" });
    await render(okId);
    const qa2 = qaTask(okId, "qa-ok");
    submitQa(opened.db, qa2, QA_PASS, "shion");

    const queue = listApprovalQueue(opened.db);
    expect(queue).toHaveLength(2);
    const broken = queue.find((i) => i.post.id === brokenId)!;
    const ok = queue.find((i) => i.post.id === okId)!;
    expect(broken.integrityError).toMatch(/旧形式|再レンダリング/);
    expect(ok.integrityError).toBeNull();

    // 承認しようとするとZod生エラーではなく日本語の理由が返る
    expect(() => decidePost(opened.db, brokenId, "approved", null, "owner")).toThrow(/旧形式|再レンダリング/);
    // doctorが検出し、修復手順を案内する
    const findings = doctorScan(opened.db);
    expect(findings.some((f) => f.subject.includes(brokenId) && f.fix.includes("render"))).toBe(true);
  }, 120_000);
});

describe("V3-G: 日報(通常コード集計)", () => {
  it("DBの事実だけを集計し、推定値は推定と明示される", async () => {
    const postId = makeHowtoPost();
    await render(postId);
    const qa = qaTask(postId);
    submitQa(opened.db, qa, QA_PASS, "shion");
    const report = buildDailyReport(opened.db, DATE);
    expect(report.stats.postsCreated).toBeGreaterThanOrEqual(1);
    expect(report.stats.tasksDone).toBeGreaterThanOrEqual(3);
    expect(report.stats.awaitingApproval).toBe(1);
    expect(report.lines.some((l) => l.includes("推定"))).toBe(true);
    expect(report.ownerActions.some((l) => l.includes("承認キュー"))).toBe(true);
  }, 60_000);
});
