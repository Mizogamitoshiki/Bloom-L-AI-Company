/**
 * V6-C/E/G: 改善提案・CEO判断・改善指示の適用・事業成果。
 * 不変条件:
 * - 提案(improvement_proposals)と判断(improvement_decisions)は分離。判断はappend-only
 * - 承認・却下・修正依頼はowner専用(core層のこの関数で強制。UI/CLI/APIから回避不能)
 * - AIがapprovedを書き込める経路は存在しない(decideImprovementProposalがownerを要求する唯一の書込口)
 * - 提案の数値・根拠はanalysis snapshotと機械照合する(evidence実在・断定表現の拒否)
 * - kickoffへ渡るのは「承認済み・期限内」のみ最大3件。(post, proposal)一意で二重適用を防ぐ
 * - 事業成果はowner専用・匿名(顧客特定情報は通常コードで拒否)
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import * as t from "./schema";
import { audit } from "./store";
import { getAnalysisSnapshot } from "./analytics";
import { businessDate, nowIso, ulid } from "../../core/ids";
import {
  findForbiddenAssertions,
  renderStructuredFactRefs,
  verifyStructuredFactRefs,
  type StructuredFactRef,
} from "../../core/analytics";
import {
  businessOutcomeInputSchema,
  improvementDecisionInputSchema,
  improvementProposalInputSchema,
  type BusinessOutcomeInput,
  type ImprovementDecision,
  type ImprovementDecisionInput,
} from "../../core/schemas";

export const MAX_DIRECTIVES_PER_KICKOFF = 3;

export type ProposalStatus = "proposed" | ImprovementDecision;

// ---- 改善提案(AIの提案。決定ではない) ----

/**
 * 改善提案の保存。通常コードによるQA(紫苑の検査の機械版)を**すべて**通過したものだけ保存する
 * (1つでも不合格なら保存しない = 紫苑の検査がpassにならない提案は存在しない):
 * - 提案者(actor)の整合: systemの偽装禁止・ownerは提案者になれない・author本人かオーケストレーター(aoi)のみ
 * - analysis snapshotの実在
 * - structuredFactRefsの実在+値の完全一致(AIの自由文の数値を信用しない。P1-2)
 * - observation本文はstructuredFactRefsから通常コードが生成する(AIは数値を書けない)
 * - evidenceRefsがsnapshotのevidencePostIdsに実在すること
 * - 断定・因果表現の拒否(計測10本未満では「傾向の可能性」表現のみ)
 */
export function saveImprovementProposal(db: Db, rawInput: unknown, actor: string): { proposalId: string } {
  const input = improvementProposalInputSchema.parse(rawInput);
  const author = db.select().from(t.employees).where(eq(t.employees.id, input.authorEmployeeId)).get();
  if (!author) throw new Error(`提案者のAI社員が見つかりません: ${input.authorEmployeeId}`);
  // actor整合(V6再レビュー追加確認): actor未指定(system)のAI社員偽装と、owner(判断者)の提案者化を拒否。
  // 許可されるのは提案者本人(agentRef)か、CLI境界を持つオーケストレーターの葵(aoi)だけ。
  if (actor === "system") {
    throw new Error("改善提案の保存にはactorの明示が必要です(--actor aoi 等)。systemによるAI社員の偽装はできません");
  }
  if (actor === "owner") {
    throw new Error("owner(CEO)は改善提案の提案者になれません(判断者のため)。提案はAI社員のactorで保存してください");
  }
  if (actor !== author.agentRef && actor !== "aoi") {
    throw new Error(
      `actor(${actor})が提案者(${input.authorEmployeeId}=${author.agentRef})と一致しません。提案者本人またはオーケストレーター(aoi)だけが保存できます`,
    );
  }
  const snapshot = getAnalysisSnapshot(db, input.analysisSnapshotId);
  if (!snapshot) throw new Error(`analysis snapshotが見つかりません: ${input.analysisSnapshotId}(先に pnpm company analytics-snapshot を実行してください)`);

  // P1-2: 構造化ファクト参照の実在+値の完全一致(存在しないgroup/metric/投稿ID/集計値は拒否)
  const refErrors = verifyStructuredFactRefs(snapshot.facts, input.structuredFactRefs as StructuredFactRef[]);
  if (refErrors.length > 0) {
    throw new Error(`structuredFactRefsがsnapshotの事実と一致しません: ${refErrors.join(" / ")}。数値の再計算・創作はできません`);
  }
  // observationは通常コードが生成する(AIの自由文の数値を保存しない)
  const observation = renderStructuredFactRefs(snapshot.facts, input.structuredFactRefs as StructuredFactRef[]);

  const evidenceSet = new Set(snapshot.facts.evidencePostIds);
  const missingEvidence = input.evidenceRefs.filter((ref) => !evidenceSet.has(ref));
  if (missingEvidence.length > 0) {
    throw new Error(
      `根拠(evidenceRefs)がsnapshotの計測済み投稿に存在しません: ${missingEvidence.join(", ")}。実在する投稿IDだけを根拠にしてください`,
    );
  }

  const measuredCount = snapshot.facts.dataCoverage.measuredCount;
  const textToCheck = [input.title, input.hypothesis, input.expectedSignal, input.proposedAction].join(" / ");
  const forbidden = findForbiddenAssertions(textToCheck, measuredCount);
  if (forbidden.length > 0) {
    throw new Error(
      `断定・因果表現が含まれるため保存できません: ${forbidden.join(", ")}(計測済み${measuredCount}本)。` +
        "「傾向の可能性」「追加検証が必要」「関連が観察された」の表現へ修正してください",
    );
  }

  const today = businessDate();
  if (input.expiresAt < today) throw new Error(`有効期限(expiresAt=${input.expiresAt})が過去日です`);

  const id = ulid();
  db.transaction((tx) => {
    tx.insert(t.improvementProposals)
      .values({
        id,
        analysisSnapshotId: input.analysisSnapshotId,
        authorEmployeeId: input.authorEmployeeId,
        title: input.title,
        observation,
        hypothesis: input.hypothesis,
        evidenceRefsJson: JSON.stringify(input.evidenceRefs),
        structuredFactRefsJson: JSON.stringify(input.structuredFactRefs),
        testVariable: input.testVariable,
        testChangeJson: JSON.stringify(input.testChange),
        expectedSignal: input.expectedSignal,
        proposedAction: input.proposedAction,
        risk: input.risk,
        expiresAt: input.expiresAt,
        createdAt: nowIso(),
      })
      .run();
    audit(tx, actor, "improvement_proposal_saved", "improvement_proposal", id, {
      snapshotId: input.analysisSnapshotId,
      author: input.authorEmployeeId,
    });
  });
  return { proposalId: id };
}

function latestDecisionRow(db: Db, proposalId: string): typeof t.improvementDecisions.$inferSelect | undefined {
  // proposal単位の明示連番で最新判断を確定する。decidedAtは表示・監査用であり、
  // 同一ミリ秒やDB実装ごとの暗黙順序(rowid等)へ依存しない。
  return db
    .select()
    .from(t.improvementDecisions)
    .where(eq(t.improvementDecisions.proposalId, proposalId))
    .orderBy(desc(t.improvementDecisions.decisionSequence))
    .get();
}

export function proposalStatus(db: Db, proposalId: string): ProposalStatus {
  const latest = latestDecisionRow(db, proposalId);
  return (latest?.decision as ImprovementDecision | undefined) ?? "proposed";
}

/**
 * CEO判断(owner専用・append-only)。
 * AI社員・system・自動処理からapprovedを書き込む経路は存在しない。
 */
export function decideImprovementProposal(
  db: Db,
  rawInput: ImprovementDecisionInput,
  actor: string,
): { proposalId: string; decision: ImprovementDecision; status: ProposalStatus } {
  if (actor !== "owner") {
    throw new Error("改善提案の承認・却下・修正依頼は代表者(owner)のみ実行できます(AI社員・自動処理は不可)");
  }
  const input = improvementDecisionInputSchema.parse(rawInput);
  const proposal = db.select().from(t.improvementProposals).where(eq(t.improvementProposals.id, input.proposalId)).get();
  if (!proposal) throw new Error(`改善提案が見つかりません: ${input.proposalId}`);

  db.transaction((tx) => {
    const current = tx
      .select({ decisionSequence: t.improvementDecisions.decisionSequence })
      .from(t.improvementDecisions)
      .where(eq(t.improvementDecisions.proposalId, input.proposalId))
      .orderBy(desc(t.improvementDecisions.decisionSequence))
      .get();
    const decisionSequence = (current?.decisionSequence ?? 0) + 1;
    tx.insert(t.improvementDecisions)
      .values({
        id: ulid(),
        proposalId: input.proposalId,
        decision: input.decision,
        reason: input.reason?.trim() || null,
        decidedBy: "owner",
        decidedAt: nowIso(),
        decisionSequence,
      })
      .run();
    audit(tx, actor, "improvement_decided", "improvement_proposal", input.proposalId, {
      decision: input.decision,
    });
  });
  return { proposalId: input.proposalId, decision: input.decision, status: input.decision };
}

export interface ProposalView {
  id: string;
  analysisSnapshotId: string;
  authorEmployeeId: string;
  authorName: string | null;
  title: string;
  observation: string;
  hypothesis: string;
  evidenceRefs: string[];
  structuredFactRefs: StructuredFactRef[];
  testVariable: string;
  testChange: { from?: string; to: string; condition?: string } | null;
  expectedSignal: string;
  proposedAction: string;
  risk: string;
  expiresAt: string;
  createdAt: string;
  status: ProposalStatus;
  latestDecision: { decision: string; reason: string | null; decidedAt: string } | null;
  expired: boolean;
}

export function listImprovementProposals(db: Db, options: { today?: string } = {}): ProposalView[] {
  const today = options.today ?? businessDate();
  const rows = db.select().from(t.improvementProposals).orderBy(desc(t.improvementProposals.createdAt)).all();
  return rows.map((row) => {
    const latest = latestDecisionRow(db, row.id);
    const author = db.select({ name: t.employees.name }).from(t.employees).where(eq(t.employees.id, row.authorEmployeeId)).get();
    return {
      id: row.id,
      analysisSnapshotId: row.analysisSnapshotId,
      authorEmployeeId: row.authorEmployeeId,
      authorName: author?.name ?? null,
      title: row.title,
      observation: row.observation,
      hypothesis: row.hypothesis,
      evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[],
      structuredFactRefs: row.structuredFactRefsJson ? (JSON.parse(row.structuredFactRefsJson) as StructuredFactRef[]) : [],
      testVariable: row.testVariable,
      testChange: row.testChangeJson ? (JSON.parse(row.testChangeJson) as { from?: string; to: string; condition?: string }) : null,
      expectedSignal: row.expectedSignal,
      proposedAction: row.proposedAction,
      risk: row.risk,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      status: (latest?.decision as ImprovementDecision | undefined) ?? "proposed",
      latestDecision: latest ? { decision: latest.decision, reason: latest.reason, decidedAt: latest.decidedAt } : null,
      expired: row.expiresAt < today,
    };
  });
}

/**
 * 次回kickoffへ渡せる改善指示: 最新判断がapproved かつ 期限内のみ。最大3件。
 * rejected / revision_requested / superseded / 期限切れ / 未判断は構造的に含まれない。
 */
export function listApprovedDirectives(db: Db, options: { today?: string; limit?: number } = {}): ProposalView[] {
  const today = options.today ?? businessDate();
  const limit = Math.min(options.limit ?? MAX_DIRECTIVES_PER_KICKOFF, MAX_DIRECTIVES_PER_KICKOFF);
  return listImprovementProposals(db, { today })
    .filter((p) => p.status === "approved" && !p.expired)
    .sort((a, b) => (b.latestDecision?.decidedAt ?? "").localeCompare(a.latestDecision?.decidedAt ?? ""))
    .slice(0, limit);
}

/**
 * 改善指示の投稿への適用記録。(post, proposal)一意。
 * kickoff再実行で同じ組が来た場合は既存記録を返す(二重適用しない)。
 */
export function applyImprovementDirective(
  db: Db,
  input: { postId: string; proposalId: string; reason?: string },
  actor: string,
): { created: boolean; directiveId: string } {
  const post = db.select().from(t.posts).where(eq(t.posts.id, input.postId)).get();
  if (!post) throw new Error(`投稿が見つかりません: ${input.postId}`);
  const status = proposalStatus(db, input.proposalId);
  if (status !== "approved") {
    throw new Error(`改善提案 ${input.proposalId} は承認済みではありません(現在: ${status})。CEO承認前の提案は投稿へ適用できません`);
  }
  const proposal = db.select().from(t.improvementProposals).where(eq(t.improvementProposals.id, input.proposalId)).get()!;
  if (proposal.expiresAt < businessDate()) {
    throw new Error(`改善提案 ${input.proposalId} は有効期限切れです(expiresAt=${proposal.expiresAt})`);
  }
  const existing = db
    .select()
    .from(t.postImprovementDirectives)
    .where(and(eq(t.postImprovementDirectives.postId, input.postId), eq(t.postImprovementDirectives.proposalId, input.proposalId)))
    .get();
  if (existing) return { created: false, directiveId: existing.id };

  const id = ulid();
  db.transaction((tx) => {
    tx.insert(t.postImprovementDirectives)
      .values({
        id,
        postId: input.postId,
        proposalId: input.proposalId,
        reason: input.reason?.trim() || null,
        appliedBy: actor,
        appliedAt: nowIso(),
      })
      .run();
    audit(tx, actor, "improvement_directive_applied", "post", input.postId, { proposalId: input.proposalId });
  });
  return { created: true, directiveId: id };
}

export interface DirectiveView {
  id: string;
  postId: string;
  postTitle: string;
  proposalId: string;
  proposalTitle: string;
  reason: string | null;
  appliedBy: string;
  appliedAt: string;
}

export function listPostDirectives(db: Db): DirectiveView[] {
  const rows = db.select().from(t.postImprovementDirectives).orderBy(desc(t.postImprovementDirectives.appliedAt)).all();
  return rows.map((row) => {
    const post = db.select({ title: t.posts.title }).from(t.posts).where(eq(t.posts.id, row.postId)).get();
    const proposal = db
      .select({ title: t.improvementProposals.title })
      .from(t.improvementProposals)
      .where(eq(t.improvementProposals.id, row.proposalId))
      .get();
    return {
      id: row.id,
      postId: row.postId,
      postTitle: post?.title ?? "(不明)",
      proposalId: row.proposalId,
      proposalTitle: proposal?.title ?? "(不明)",
      reason: row.reason,
      appliedBy: row.appliedBy,
      appliedAt: row.appliedAt,
    };
  });
}

// ---- 事業成果(V6-G。owner専用・匿名) ----

/** 顧客を特定しうる文字列の検出(通常コード・決定的)。検出したら保存を拒否する */
export function findPersonalInfoPatterns(text: string): string[] {
  const hits: string[] = [];
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) hits.push("メールアドレスらしい文字列");
  if (/@/.test(text)) hits.push("@(アカウント特定の可能性)");
  if (/0\d{1,4}-\d{1,4}-\d{3,4}/.test(text) || /\d{10,11}/.test(text)) hits.push("電話番号らしい数字列");
  if (/LINE\s*ID/i.test(text)) hits.push("LINE ID");
  if (/https?:\/\//i.test(text)) hits.push("URL(顧客特定の可能性)");
  return hits;
}

export function addBusinessOutcome(db: Db, rawInput: unknown, actor: string): { outcomeId: string } {
  if (actor !== "owner") throw new Error("事業成果の記録は代表者(owner)のみ実行できます");
  const input: BusinessOutcomeInput = businessOutcomeInputSchema.parse(rawInput);
  if (input.relatedPostId) {
    const post = db.select().from(t.posts).where(eq(t.posts.id, input.relatedPostId)).get();
    if (!post) throw new Error(`関連投稿が見つかりません: ${input.relatedPostId}`);
  }
  if (input.anonymizedNote) {
    const pii = findPersonalInfoPatterns(input.anonymizedNote);
    if (pii.length > 0) {
      throw new Error(`匿名メモに顧客を特定しうる情報が含まれるため保存できません: ${pii.join(", ")}。内容を匿名化してください`);
    }
  }
  const id = ulid();
  db.transaction((tx) => {
    tx.insert(t.businessOutcomes)
      .values({
        id,
        occurredOn: input.occurredOn,
        kind: input.kind,
        source: input.source,
        relatedPostId: input.relatedPostId ?? null,
        amountYen: input.amountYen ?? null,
        anonymizedNote: input.anonymizedNote ?? null,
        createdBy: "owner",
        createdAt: nowIso(),
      })
      .run();
    // 監査ログにはメモ本文を入れない(万一の特定情報混入を二次拡散しない)
    audit(tx, actor, "business_outcome_recorded", "business_outcome", id, undefined);
  });
  return { outcomeId: id };
}

export interface BusinessOutcomeSummary {
  counts: { inquiry: number; estimate: number; order: number };
  orderAmountYenTotal: number | null;
  amountEnteredCount: number;
  total: number;
}

export function listBusinessOutcomes(db: Db): (typeof t.businessOutcomes.$inferSelect)[] {
  return db.select().from(t.businessOutcomes).orderBy(desc(t.businessOutcomes.occurredOn)).all();
}

/** KPIツリー接続用の決定的サマリー。データが無い値はnull(未取得)のまま返す */
export function businessOutcomeSummary(db: Db): BusinessOutcomeSummary {
  const rows = listBusinessOutcomes(db);
  const counts = { inquiry: 0, estimate: 0, order: 0 };
  let amountTotal: number | null = null;
  let amountEnteredCount = 0;
  for (const row of rows) {
    if (row.kind === "inquiry" || row.kind === "estimate" || row.kind === "order") counts[row.kind] += 1;
    if (row.kind === "order" && row.amountYen !== null) {
      amountTotal = (amountTotal ?? 0) + row.amountYen;
      amountEnteredCount += 1;
    }
  }
  return { counts, orderAmountYenTotal: amountTotal, amountEnteredCount, total: rows.length };
}
