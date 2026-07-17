/**
 * Drizzleスキーマ(docs/08)。V1で使用するテーブルの型付き定義。
 * docs/08にありV1未使用のテーブル(sources等)はclient.tsのDDLで先行作成する。
 */
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

export const departments = sqliteTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(), // active | planned
  unlockNote: text("unlock_note"),
});

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  departmentId: text("department_id").notNull().references(() => departments.id),
  name: text("name").notNull(),
  role: text("role").notNull(),
  agentRef: text("agent_ref").notNull(),
  modelProfile: text("model_profile").notNull(),
  personaJson: text("persona_json"),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    assigneeId: text("assignee_id").notNull().references(() => employees.id),
    postId: text("post_id").references(() => posts.id),
    status: text("status").notNull(),
    priority: integer("priority").notNull().default(5),
    inputJson: text("input_json"),
    retryCount: integer("retry_count").notNull().default(0),
    runDate: text("run_date").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (t) => [uniqueIndex("tasks_idem_uq").on(t.idempotencyKey), index("tasks_assignee_idx").on(t.assigneeId)],
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    seq: integer("seq").notNull(),
    ts: text("ts").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json"),
    actor: text("actor").notNull(),
  },
  (t) => [uniqueIndex("task_events_seq_uq").on(t.taskId, t.seq)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    postId: text("post_id"),
    kind: text("kind").notNull(),
    version: integer("version").notNull().default(1),
    contentJson: text("content_json"),
    filePath: text("file_path"),
    schemaVersion: text("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("artifacts_post_idx").on(t.postId, t.kind, t.version)],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    pillar: text("pillar").notNull(),
    format: text("format").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    plannedDate: text("planned_date"),
    captionFinal: text("caption_final"),
    hashtagsJson: text("hashtags_json"),
    exportPath: text("export_path"),
    publishedAt: text("published_at"),
    publishMethod: text("publish_method").notNull().default("manual"),
    rightsState: text("rights_state").notNull().default("n/a"),
    templateId: text("template_id").notNull().default("tpl-howto"),
    portfolioItemId: text("portfolio_item_id"),
    createdAt: text("created_at"),
  },
  (t) => [
    index("posts_status_idx").on(t.status),
    index("posts_planned_idx").on(t.plannedDate),
    index("posts_created_idx").on(t.createdAt),
  ],
);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  publisher: text("publisher").notNull(),
  publishedAt: text("published_at").notNull(), // 不明時は "" (verification_status=unconfirmed)
  checkedAt: text("checked_at").notNull(),
  isPrimary: integer("is_primary").notNull().default(0),
  reliability: text("reliability").notNull(),
  summary: text("summary"),
  factOrInference: text("fact_or_inference").notNull(),
  fetchedAt: text("fetched_at"),
  usable: integer("usable").notNull().default(1),
  verificationStatus: text("verification_status").notNull().default("confirmed"),
});

// migration v3-fk-rebuild と同期: 複合PK+FK(P2)
export const postSources = sqliteTable(
  "post_sources",
  {
    postId: text("post_id").notNull().references(() => posts.id),
    sourceId: text("source_id").notNull().references(() => sources.id),
    citedAs: text("cited_as"),
  },
  (t) => [primaryKey({ columns: [t.postId, t.sourceId] })],
);

export const portfolioItems = sqliteTable(
  "portfolio_items",
  {
    id: text("id").primaryKey(),
    customerName: text("customer_name").notNull(),
    siteUrl: text("site_url"),
    assetsPath: text("assets_path"),
    highlightsJson: text("highlights_json"),
    permissionId: text("permission_id").references(() => customerPermissions.id),
    createdAt: text("created_at").notNull(),
    anonymousName: text("anonymous_name"),
    summary: text("summary"),
    technologiesJson: text("technologies_json"),
    problem: text("problem"),
    testimonial: text("testimonial"),
  },
  (t) => [index("portfolio_items_perm_idx").on(t.permissionId)],
);

export const customerPermissions = sqliteTable("customer_permissions", {
  id: text("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  scopeJson: text("scope_json").notNull(),
  status: text("status").notNull(), // pending | approved | rejected | revoked
  evidencePath: text("evidence_path"),
  grantedAt: text("granted_at"),
  expiresAt: text("expires_at"),
  anonymousAllowed: integer("anonymous_allowed").notNull().default(0),
  revokedAt: text("revoked_at"),
});

export const qaReviews = sqliteTable(
  "qa_reviews",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    artifactId: text("artifact_id").references(() => artifacts.id),
    result: text("result").notNull(), // pass | fail | blocked_rights(V3)
    checklistJson: text("checklist_json"),
    issuesJson: text("issues_json"), // 重大指摘(公開を止める)
    notesJson: text("notes_json"), // 軽微指摘(代表者確認・passと両立)
    reviewerId: text("reviewer_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("qa_reviews_post_idx").on(t.postId, t.createdAt)],
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  decision: text("decision").notNull(),
  comment: text("comment"),
  decidedBy: text("decided_by").notNull(),
  decidedAt: text("decided_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  detailJson: text("detail_json"),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  runDate: text("run_date").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(), // running | done | aborted
  note: text("note"),
});

export const usageRecords = sqliteTable("usage_records", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  modelProfile: text("model_profile").notNull(),
  estInputChars: integer("est_input_chars").notNull().default(0),
  estOutputChars: integer("est_output_chars").notNull().default(0),
  wallSeconds: integer("wall_seconds").notNull().default(0),
  ts: text("ts").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // daily | weekly | monthly
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  bodyArtifactId: text("body_artifact_id").references(() => artifacts.id),
});

// V4: 実績値(代表者が3日/7日後に手入力)。migration v4-metrics-meetings-fk と同期
export const postMetrics = sqliteTable(
  "post_metrics",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    measuredAt: text("measured_at").notNull(),
    windowDays: integer("window_days"),
    reach: integer("reach"),
    profileViews: integer("profile_views"),
    saves: integer("saves"),
    shares: integer("shares"),
    comments: integer("comments"),
    dmStarts: integer("dm_starts"),
    followerCount: integer("follower_count"),
    note: text("note"),
    createdAt: text("created_at"),
  },
  (t) => [uniqueIndex("post_metrics_post_window_uq").on(t.postId, t.windowDays)],
);

// V4: 会議(議事録本体は meeting_minutes 成果物)。migration と同期
export const meetings = sqliteTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // weekly | monthly
    heldOn: text("held_on").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    participantsJson: text("participants_json"),
    agendaJson: text("agenda_json"),
    decisionsJson: text("decisions_json"),
    minutesArtifactId: text("minutes_artifact_id").references(() => artifacts.id),
    createdAt: text("created_at"),
  },
  (t) => [
    index("meetings_kind_idx").on(t.kind, t.heldOn),
    uniqueIndex("meetings_kind_period_uq").on(t.kind, t.periodEnd),
  ],
);

// V4.5: テンプレート版の承認管理(公開停止ガード)。initはdraft、ownerだけが承認できる
export const templateVersions = sqliteTable(
  "template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    family: text("family").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"), // draft | approved | rejected | revision_requested
    fingerprint: text("fingerprint").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [uniqueIndex("template_versions_tpl_ver_uq").on(t.templateId, t.version)],
);

// V4.5: 投稿ごとのレンダリング記録(使用したテンプレート版・variant・fingerprint・design QA結果)
export const postRenders = sqliteTable(
  "post_renders",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    specArtifactId: text("spec_artifact_id").notNull().references(() => artifacts.id),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    variant: text("variant").notNull(),
    fingerprint: text("fingerprint").notNull(),
    designQaResult: text("design_qa_result"), // pass | fail | null
    designQaJson: text("design_qa_json"),
    visualQaResult: text("visual_qa_result"), // pass | fail | null(未実施)。V4.5 v2
    visualQaJson: text("visual_qa_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("post_renders_post_idx").on(t.postId, t.createdAt)],
);

// V4.5 v2: テンプレート版×variantごとのQA/プレビュー状態(承認ゲートの根拠)
export const templateVariantQa = sqliteTable(
  "template_variant_qa",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    variant: text("variant").notNull(),
    fingerprint: text("fingerprint").notNull(),
    contentQaResult: text("content_qa_result"), // pass | fail | null
    mechanicalQaResult: text("mechanical_qa_result"), // pass | fail | null
    visualQaResult: text("visual_qa_result"), // pass | fail | null(未実施)
    visualQaJson: text("visual_qa_json"),
    previewComplete: integer("preview_complete").notNull().default(0),
    pageCount: integer("page_count"),
    fixtureKind: text("fixture_kind"), // fictional | real
    rights: text("rights"),
    layoutIdsJson: text("layout_ids_json"), // V4.5 v3: 各ページのlayoutId(JSON)
    pageHashesJson: text("page_hashes_json"), // V4.5 v3: 各ページPNGのSHA-256(JSON)
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("template_variant_qa_uq").on(t.templateId, t.version, t.variant)],
);

// V5: Instagram公式API公開ジョブ。アクセストークン等の秘密情報は絶対に保存しない。
export const instagramPublishJobs = sqliteTable(
  "instagram_publish_jobs",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    idempotencyKey: text("idempotency_key").notNull(),
    mode: text("mode").notNull(), // dry_run | live
    status: text("status").notNull(), // dry_run | publishing | remote_published | published | failed
    mediaUrlsJson: text("media_urls_json").notNull(),
    childContainerIdsJson: text("child_container_ids_json"),
    carouselContainerId: text("carousel_container_id"),
    instagramMediaId: text("instagram_media_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    publishedAt: text("published_at"),
  },
  (t) => [
    uniqueIndex("instagram_publish_jobs_idem_uq").on(t.idempotencyKey),
    index("instagram_publish_jobs_post_idx").on(t.postId, t.createdAt),
  ],
);

// V6: 分析スナップショット(append-only)。通常コードが決定的に生成したファクトJSONのみを保存する。
// AI生成文章は混ぜない。(window_days, source_data_hash)一意で冪等。migration #11 と同期。
export const analysisSnapshots = sqliteTable(
  "analysis_snapshots",
  {
    id: text("id").primaryKey(),
    windowDays: integer("window_days").notNull(), // 3 | 7(窓を混ぜない)
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    generatedAt: text("generated_at").notNull(),
    sourceDataHash: text("source_data_hash").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("analysis_snapshots_window_hash_uq").on(t.windowDays, t.sourceDataHash),
    index("analysis_snapshots_window_idx").on(t.windowDays, t.createdAt),
  ],
);

// V6: 改善提案(AIの提案。決定ではない)。現在状態はimprovement_decisionsから導出する
export const improvementProposals = sqliteTable(
  "improvement_proposals",
  {
    id: text("id").primaryKey(),
    analysisSnapshotId: text("analysis_snapshot_id").notNull().references(() => analysisSnapshots.id),
    authorEmployeeId: text("author_employee_id").notNull().references(() => employees.id),
    title: text("title").notNull(),
    observation: text("observation").notNull(),
    hypothesis: text("hypothesis").notNull(),
    evidenceRefsJson: text("evidence_refs_json").notNull(),
    // V6再レビューP1-2: snapshot内事実への構造化参照(実在+完全一致を検査済みの参照のみ保存)
    structuredFactRefsJson: text("structured_fact_refs_json"),
    testVariable: text("test_variable").notNull(), // P2-1: pillar|format|cta|template|variant|posting_time
    // P2-1: 変更内容の構造化(from/to/condition)
    testChangeJson: text("test_change_json"),
    expectedSignal: text("expected_signal").notNull(),
    proposedAction: text("proposed_action").notNull(),
    risk: text("risk").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("improvement_proposals_snapshot_idx").on(t.analysisSnapshotId)],
);

// V6: CEO判断履歴(append-only。UPDATE/DELETE禁止)。decided_byは常にowner(core層で強制)
export const improvementDecisions = sqliteTable(
  "improvement_decisions",
  {
    id: text("id").primaryKey(),
    proposalId: text("proposal_id").notNull().references(() => improvementProposals.id),
    decision: text("decision").notNull(), // approved | rejected | revision_requested | superseded
    reason: text("reason"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: text("decided_at").notNull(),
    // V6最終レビュー: proposal内の明示的な判断順序。同一ミリ秒でも最新判断を一意に導出する。
    decisionSequence: integer("decision_sequence").notNull(),
  },
  (t) => [
    index("improvement_decisions_proposal_idx").on(t.proposalId, t.decidedAt),
    uniqueIndex("improvement_decisions_proposal_sequence_uq").on(t.proposalId, t.decisionSequence),
  ],
);

// V6: 改善指示の適用記録。(post_id, proposal_id)一意でkickoff再実行の二重適用を構造的に防ぐ
export const postImprovementDirectives = sqliteTable(
  "post_improvement_directives",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    proposalId: text("proposal_id").notNull().references(() => improvementProposals.id),
    reason: text("reason"),
    appliedBy: text("applied_by").notNull(),
    appliedAt: text("applied_at").notNull(),
  },
  (t) => [uniqueIndex("post_improvement_directives_uq").on(t.postId, t.proposalId)],
);

// V6: 事業成果(owner手動・匿名)。顧客を特定できる情報は保存しない(入力時に通常コードで拒否)
export const businessOutcomes = sqliteTable(
  "business_outcomes",
  {
    id: text("id").primaryKey(),
    occurredOn: text("occurred_on").notNull(),
    kind: text("kind").notNull(), // inquiry | estimate | order
    source: text("source").notNull(), // instagram | referral | website | unknown
    relatedPostId: text("related_post_id").references(() => posts.id),
    amountYen: integer("amount_yen"),
    anonymizedNote: text("anonymized_note"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("business_outcomes_occurred_idx").on(t.occurredOn, t.kind)],
);

// V5.2: 公開画像URLの記録。export bundleの確定画像を公開ストレージへ配置した結果。
// トークン等の秘密値は保存しない(publicUrlは検証済みの公開HTTPS URLのみ)。
export const postMediaUploads = sqliteTable(
  "post_media_uploads",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    imageIndex: integer("image_index").notNull(), // 0始まりの投稿順
    fileName: text("file_name").notNull(), // 01.png 等
    sha256: text("sha256").notNull(),
    publicUrl: text("public_url").notNull(),
    provider: text("provider").notNull(), // vercel-blob 等
    uploadedAt: text("uploaded_at").notNull(),
  },
  (t) => [
    uniqueIndex("post_media_uploads_post_idx_uq").on(t.postId, t.imageIndex),
    index("post_media_uploads_sha_idx").on(t.provider, t.sha256),
  ],
);
