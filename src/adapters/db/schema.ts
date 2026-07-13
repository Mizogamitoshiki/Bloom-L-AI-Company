/**
 * Drizzleスキーマ(docs/08)。V1で使用するテーブルの型付き定義。
 * docs/08にありV1未使用のテーブル(sources等)はclient.tsのDDLで先行作成する。
 */
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  postId: text("post_id"),
  kind: text("kind").notNull(),
  version: integer("version").notNull().default(1),
  contentJson: text("content_json"),
  filePath: text("file_path"),
  schemaVersion: text("schema_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const posts = sqliteTable("posts", {
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
});

export const qaReviews = sqliteTable("qa_reviews", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  artifactId: text("artifact_id"),
  result: text("result").notNull(), // pass | fail | blocked_rights(V3)
  checklistJson: text("checklist_json"),
  issuesJson: text("issues_json"),
  reviewerId: text("reviewer_id").notNull(),
  createdAt: text("created_at").notNull(),
});

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
