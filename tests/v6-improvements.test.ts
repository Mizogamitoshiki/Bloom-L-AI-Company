/**
 * V6-C/E/G: 改善提案・CEO判断・kickoff接続・事業成果。
 * すべて一時DB。AIがapprovedを書ける経路が存在しないことをコアAPIで検証する。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import { ensureSeedOrg, addPostMetric } from "@adapters/db/store";
import { createAnalysisSnapshot } from "@adapters/db/analytics";
import {
  addBusinessOutcome,
  applyImprovementDirective,
  decideImprovementProposal,
  findPersonalInfoPatterns,
  listApprovedDirectives,
  listBusinessOutcomes,
  listImprovementProposals,
  proposalStatus,
  saveImprovementProposal,
} from "@adapters/db/improvements";
import { addDays, businessDate, ulid } from "@core/ids";

let dir: string;
let opened: OpenedDb;
let postId: string;
let snapshotId: string;

function validProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "improvement_proposal",
    analysisSnapshotId: snapshotId,
    authorEmployeeId: "emp_ren",
    title: "柱6でCTAを質問形にする検証",
    // P1-2: 数値は自由文でなく構造化参照で申告する(reach=100, saves=4 → saveRate=0.04)
    structuredFactRefs: [
      { scope: "post", postId, metric: "saveRate", value: 0.04 },
      { scope: "coverage", field: "measuredCount", value: 1 },
    ],
    hypothesis: "CTAを質問形にすると保存の傾向が変わる可能性がある。追加検証が必要",
    evidenceRefs: [postId],
    testVariable: "cta",
    testChange: { from: "気になった方はDMで「相談」とお送りください", to: "質問形のCTA文", condition: "柱6×carouselのみ" },
    expectedSignal: "保存率の中央値の変化を観察する",
    proposedAction: "次回の柱6投稿1本でCTA文を質問形に変更して比較の材料を集める",
    risk: "保存率が下がる可能性。1本のみで実施し影響を限定する",
    expiresAt: addDays(businessDate(), 14),
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v6i-"));
  const dbPath = path.join(dir, "company.db");
  process.env.BLOOM_DB_PATH = dbPath;
  opened = openDb(dbPath);
  ensureSeedOrg(opened.db);
  postId = ulid();
  opened.db.insert(t.posts).values({
    id: postId, pillar: "6", format: "carousel", title: "計測済み投稿", status: "published",
    publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto",
    publishedAt: "2026-07-10T03:00:00.000Z", createdAt: "2026-07-10",
  }).run();
  addPostMetric(opened.db, { postId, windowDays: 3, reach: 100, saves: 4 }, "owner");
  snapshotId = createAnalysisSnapshot(opened.db, 3, "system").snapshotId;
});
afterEach(() => {
  vi.useRealTimers();
  opened.sqlite.close();
  delete process.env.BLOOM_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("V6-C 改善提案の保存(機械QA)", () => {
  it("有効な提案は保存でき、observationは通常コードがsnapshotから生成する", () => {
    const r = saveImprovementProposal(opened.db, validProposal(), "aoi");
    expect(proposalStatus(opened.db, r.proposalId)).toBe("proposed");
    const list = listImprovementProposals(opened.db);
    expect(list[0]!.status).toBe("proposed");
    expect(list[0]!.evidenceRefs).toEqual([postId]);
    // observationはAIの自由文ではなく、通常コード生成(参照値0.04を含む)
    expect(list[0]!.observation).toContain("通常コード生成");
    expect(list[0]!.observation).toContain("0.04");
    expect(list[0]!.testVariable).toBe("cta");
    expect(list[0]!.testChange!.to).toBe("質問形のCTA文");
    expect(list[0]!.structuredFactRefs.length).toBe(2);
  });

  it("P1-2: 架空の数値(保存率99%)を申告した提案を拒否する", () => {
    expect(() =>
      saveImprovementProposal(
        opened.db,
        validProposal({ structuredFactRefs: [{ scope: "post", postId, metric: "saveRate", value: 0.99 }] }),
        "aoi",
      ),
    ).toThrow(/一致しません.*0\.04.*0\.99/);
  });

  it("P1-2: 存在しないgroup・metric・投稿ID・集計値への参照を拒否する", () => {
    expect(() =>
      saveImprovementProposal(opened.db, validProposal({ structuredFactRefs: [{ scope: "post", postId: "post_ghost", metric: "reach", value: 100 }] }), "aoi"),
    ).toThrow(/snapshotに存在しません/);
    expect(() =>
      saveImprovementProposal(
        opened.db,
        validProposal({ structuredFactRefs: [{ scope: "group", axis: "pillar", groupKey: "9", stat: "median", metric: "reach", value: 100 }] }),
        "aoi",
      ),
    ).toThrow(/存在しません/);
    // 率に合計(total)という集計値は存在しない → 拒否
    expect(() =>
      saveImprovementProposal(
        opened.db,
        validProposal({ structuredFactRefs: [{ scope: "group", axis: "pillar", groupKey: "6", stat: "total", metric: "saveRate", value: 0.04 }] }),
        "aoi",
      ),
    ).toThrow(/率.*ありません/);
    // 存在しないmetric名はZodが拒否
    expect(() =>
      saveImprovementProposal(opened.db, validProposal({ structuredFactRefs: [{ scope: "post", postId, metric: "magicRate", value: 1 }] }), "aoi"),
    ).toThrow();
  });

  it("evidenceRefsがsnapshotに実在しない提案を拒否する(QA相当の機械検査)", () => {
    expect(() => saveImprovementProposal(opened.db, validProposal({ evidenceRefs: ["post_not_exists"] }), "aoi"))
      .toThrow(/evidenceRefs.*存在しません/);
  });

  it("断定・因果表現(10本未満)を拒否する", () => {
    expect(() =>
      saveImprovementProposal(opened.db, validProposal({ hypothesis: "この形式が最強で効果があると確定した内容です" }), "aoi"),
    ).toThrow(/断定・因果表現/);
    expect(() =>
      saveImprovementProposal(opened.db, validProposal({ proposedAction: "この投稿のおかげで保存が増えるので全面的に切り替える" }), "aoi"),
    ).toThrow(/断定・因果表現/);
  });

  it("存在しないsnapshot・存在しない提案者・過去日の期限を拒否する", () => {
    expect(() => saveImprovementProposal(opened.db, validProposal({ analysisSnapshotId: "snap_x" }), "aoi")).toThrow(/snapshotが見つかりません/);
    expect(() => saveImprovementProposal(opened.db, validProposal({ authorEmployeeId: "emp_ghost" }), "aoi")).toThrow(/提案者/);
    expect(() => saveImprovementProposal(opened.db, validProposal({ expiresAt: "2020-01-01" }), "aoi")).toThrow(/過去日/);
  });

  it("P2-1: testVariableは6種enumのみ。自由文字列・複数変数指定はZodが拒否する", () => {
    expect(() => saveImprovementProposal(opened.db, validProposal({ testVariable: "CTAと柱を同時に変える" }), "aoi")).toThrow();
    expect(() => saveImprovementProposal(opened.db, validProposal({ testVariable: ["cta", "pillar"] }), "aoi")).toThrow();
    expect(() => saveImprovementProposal(opened.db, validProposal({ testChange: { to: "" } }), "aoi")).toThrow();
  });

  it("追加確認: actorとauthorの整合(system偽装拒否・owner提案者化拒否・他AI社員の偽装拒否)", () => {
    expect(() => saveImprovementProposal(opened.db, validProposal(), "system")).toThrow(/actorの明示が必要/);
    expect(() => saveImprovementProposal(opened.db, validProposal(), "owner")).toThrow(/提案者になれません/);
    expect(() => saveImprovementProposal(opened.db, validProposal(), "kotoha")).toThrow(/一致しません/);
    // 提案者本人(ren)とオーケストレーター(aoi)は保存できる
    expect(() => saveImprovementProposal(opened.db, validProposal({ title: "本人保存の検証案" }), "ren")).not.toThrow();
    expect(() => saveImprovementProposal(opened.db, validProposal({ title: "葵経由保存の検証案" }), "aoi")).not.toThrow();
  });
});

describe("V6-C CEO判断(owner専用・append-only)", () => {
  let proposalId: string;
  beforeEach(() => {
    proposalId = saveImprovementProposal(opened.db, validProposal(), "aoi").proposalId;
  });

  it("owner以外(AI社員・system)は承認できない", () => {
    for (const actor of ["aoi", "ren", "minato", "shion", "system"]) {
      expect(() => decideImprovementProposal(opened.db, { proposalId, decision: "approved" }, actor)).toThrow(/代表者\(owner\)のみ/);
    }
    expect(proposalStatus(opened.db, proposalId)).toBe("proposed");
  });

  it("ownerは承認でき、判断はappend-onlyで履歴が残る(上書きしない)", () => {
    decideImprovementProposal(opened.db, { proposalId, decision: "revision_requested", reason: "根拠を1本追加して" }, "owner");
    decideImprovementProposal(opened.db, { proposalId, decision: "approved" }, "owner");
    const rows = opened.db.select().from(t.improvementDecisions).all();
    expect(rows.length).toBe(2); // 履歴が両方残る
    expect(proposalStatus(opened.db, proposalId)).toBe("approved"); // 現在状態は最新判断から導出
  });

  it("P1: 同一ミリ秒の複数判断も明示連番で最新状態を一意に導出する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T01:23:45.678Z"));
    decideImprovementProposal(opened.db, { proposalId, decision: "approved" }, "owner");
    decideImprovementProposal(opened.db, { proposalId, decision: "rejected", reason: "再確認で見送り" }, "owner");

    const rows = opened.db
      .select()
      .from(t.improvementDecisions)
      .orderBy(t.improvementDecisions.decisionSequence)
      .all();
    expect(rows.map((row) => row.decidedAt)).toEqual([
      "2026-07-17T01:23:45.678Z",
      "2026-07-17T01:23:45.678Z",
    ]);
    expect(rows.map((row) => row.decisionSequence)).toEqual([1, 2]);
    expect(proposalStatus(opened.db, proposalId)).toBe("rejected");
  });

  it("却下・修正依頼には理由が必要", () => {
    expect(() => decideImprovementProposal(opened.db, { proposalId, decision: "rejected" }, "owner")).toThrow(/理由/);
    expect(() => decideImprovementProposal(opened.db, { proposalId, decision: "rejected", reason: "今週は柱を変えない" }, "owner")).not.toThrow();
  });
});

describe("V6-E kickoffへの接続(承認済みだけ・最大3件・二重適用防止)", () => {
  function makeApproved(title: string, expiresAt?: string): string {
    const id = saveImprovementProposal(opened.db, validProposal({ title, ...(expiresAt ? { expiresAt } : {}) }), "aoi").proposalId;
    decideImprovementProposal(opened.db, { proposalId: id, decision: "approved" }, "owner");
    return id;
  }

  it("rejected・revision_requested・未判断はkickoffへ渡らない(approvedのみ)", () => {
    const approved = makeApproved("承認済み案");
    const rejected = saveImprovementProposal(opened.db, validProposal({ title: "却下される案" }), "aoi").proposalId;
    decideImprovementProposal(opened.db, { proposalId: rejected, decision: "rejected", reason: "対象外" }, "owner");
    saveImprovementProposal(opened.db, validProposal({ title: "未判断の案" }), "aoi");
    const directives = listApprovedDirectives(opened.db);
    expect(directives.map((d) => d.id)).toEqual([approved]);
  });

  it("最大3件まで。期限切れは除外される", () => {
    makeApproved("改善案その1");
    makeApproved("改善案その2");
    makeApproved("改善案その3");
    makeApproved("改善案その4");
    expect(listApprovedDirectives(opened.db).length).toBe(3);
    // 期限切れの除外(todayを未来にして判定)
    const future = addDays(businessDate(), 30);
    expect(listApprovedDirectives(opened.db, { today: future }).length).toBe(0);
  });

  it("同一投稿への二重適用を防ぐ(再実行でも新規行を作らない)", () => {
    const proposalId = makeApproved("適用する案");
    const first = applyImprovementDirective(opened.db, { postId, proposalId, reason: "CTA検証のため" }, "aoi");
    expect(first.created).toBe(true);
    const second = applyImprovementDirective(opened.db, { postId, proposalId, reason: "再実行" }, "aoi");
    expect(second.created).toBe(false);
    expect(second.directiveId).toBe(first.directiveId);
    expect(opened.db.select().from(t.postImprovementDirectives).all().length).toBe(1);
  });

  it("承認前・却下済みの提案は投稿へ適用できない", () => {
    const pending = saveImprovementProposal(opened.db, validProposal({ title: "未承認案" }), "aoi").proposalId;
    expect(() => applyImprovementDirective(opened.db, { postId, proposalId: pending }, "aoi")).toThrow(/承認済みではありません/);
    decideImprovementProposal(opened.db, { proposalId: pending, decision: "rejected", reason: "見送り" }, "owner");
    expect(() => applyImprovementDirective(opened.db, { postId, proposalId: pending }, "aoi")).toThrow(/承認済みではありません/);
  });
});

describe("V6-G 事業成果(owner専用・匿名)", () => {
  const valid = { occurredOn: "2026-07-16", kind: "inquiry", source: "instagram" };

  it("owner以外の入力を拒否する", () => {
    for (const actor of ["aoi", "minato", "system"]) {
      expect(() => addBusinessOutcome(opened.db, valid, actor)).toThrow(/owner/);
    }
  });

  it("個人情報らしい入力を拒否する(メール・電話・LINE ID・URL・@)", () => {
    expect(findPersonalInfoPatterns("岸和田の製造業のお客様からDM").length).toBe(0);
    for (const note of [
      "連絡先は taro@example.com",
      "電話 072-123-4567 へ折り返し",
      "09012345678 に連絡",
      "LINE ID: taro123",
      "https://example.com の問い合わせフォーム",
      "@taro_shop からDM",
    ]) {
      expect(() => addBusinessOutcome(opened.db, { ...valid, anonymizedNote: note }, "owner")).toThrow(/特定しうる情報/);
    }
  });

  it("null(未取得)を保持し、負数・存在しない関連投稿を拒否する", () => {
    const r = addBusinessOutcome(opened.db, { ...valid, kind: "order", amountYen: null, relatedPostId: postId, anonymizedNote: "地域の製造業" }, "owner");
    const row = listBusinessOutcomes(opened.db).find((o) => o.id === r.outcomeId)!;
    expect(row.amountYen).toBeNull(); // 0にしない
    expect(row.relatedPostId).toBe(postId);
    expect(row.createdBy).toBe("owner");
    expect(() => addBusinessOutcome(opened.db, { ...valid, amountYen: -100 }, "owner")).toThrow();
    expect(() => addBusinessOutcome(opened.db, { ...valid, relatedPostId: "post_x" }, "owner")).toThrow(/関連投稿/);
  });
});
