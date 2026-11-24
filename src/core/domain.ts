/**
 * ドメイン型と定数(docs/06, 08)。
 * ここが状態語彙の唯一の定義。UI・CLI・アダプターはこれを参照する。
 */

export const TASK_STATUSES = [
  "pending",
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
  "budget_paused",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = [
  "research",
  "plan_posts",
  "write_copy",
  "design",
  "render",
  "qa",
  "report",
  "meeting",
  "ingest_portfolio",
  /** V10: サンプルサイト制作(颯)。site_sample成果物を提出し、通常コードがビルド・撮影する */
  "build_site",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const POST_STATUSES = [
  "idea",
  "drafting",
  "qa_review",
  "awaiting_approval",
  "approved",
  "rejected",
  "revision_requested",
  "exported",
  "published",
  "measured",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const EVENT_TYPES = [
  "created",
  "queued",
  "started",
  "heartbeat",
  "stage_changed",
  "artifact_added",
  "succeeded",
  "failed",
  "cancelled",
  "paused_budget",
  "retried",
] as const;
export type TaskEventType = (typeof EVENT_TYPES)[number];

/** 投稿状態機械: 許可される遷移(docs/06 §3)。これ以外の遷移はガードが拒否する */
export const POST_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  idea: ["drafting"],
  drafting: ["qa_review"],
  qa_review: ["awaiting_approval", "drafting"],
  awaiting_approval: ["approved", "rejected", "revision_requested"],
  revision_requested: ["drafting"],
  approved: ["exported"],
  exported: ["published"],
  published: ["measured"],
  rejected: [],
  measured: [],
};

/** タスク状態機械: 許可される遷移(docs/06 §2) */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["done", "failed", "budget_paused", "cancelled"],
  failed: ["queued"],
  budget_paused: ["queued"],
  done: [],
  cancelled: [],
};

/** 社員の表示状態(docs/10 §2)— 実状態からの導出値。DBには保存しない */
export const DISPLAY_STATES = [
  "idle",
  "researching",
  "meeting",
  "creating",
  "qa",
  "awaiting_approval",
  "done_today",
  "error",
  "budget_paused",
  "stale",
] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

/** 表示状態 → 部屋(docs/10 §2) */
export const DISPLAY_ROOM: Record<DisplayState, string> = {
  idle: "lounge",
  researching: "desk",
  meeting: "meeting",
  creating: "desk",
  qa: "qa_room",
  awaiting_approval: "ceo_office",
  done_today: "desk",
  error: "desk",
  budget_paused: "lounge",
  stale: "desk",
};

/** 表示状態の日本語ラベル(色に依存しないテキスト表示・docs/10) */
export const DISPLAY_LABEL: Record<DisplayState, string> = {
  idle: "待機",
  researching: "調査中",
  meeting: "会議中",
  creating: "制作中",
  qa: "品質確認中",
  awaiting_approval: "承認待ち",
  done_today: "本日完了",
  error: "エラー",
  budget_paused: "予算停止",
  stale: "状態不明",
};

/** タスク種別 → running時の表示状態 */
export const TYPE_TO_DISPLAY: Record<TaskType, DisplayState> = {
  research: "researching",
  plan_posts: "creating",
  write_copy: "creating",
  design: "creating",
  render: "creating",
  qa: "qa",
  report: "creating",
  meeting: "meeting",
  ingest_portfolio: "creating",
  build_site: "creating",
};

export const MODEL_PROFILES = ["light", "standard", "heavy"] as const;
export type ModelProfile = (typeof MODEL_PROFILES)[number];

export interface TaskRow {
  id: string;
  idempotencyKey: string;
  type: TaskType;
  title: string;
  assigneeId: string;
  postId: string | null;
  status: TaskStatus;
  priority: number;
  inputJson: string | null;
  retryCount: number;
  runDate: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskEventRow {
  id: string;
  taskId: string;
  seq: number;
  ts: string;
  type: TaskEventType;
  payloadJson: string | null;
  actor: string;
}

export interface EmployeeRow {
  id: string;
  departmentId: string;
  name: string;
  role: string;
  agentRef: string;
  modelProfile: ModelProfile;
  personaJson: string | null;
}
