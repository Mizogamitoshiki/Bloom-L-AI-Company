/**
 * SQLiteクライアント(docs/07 D-02)。WALモード+短トランザクション+foreign_keys=ON。
 * DDLはここで一元管理(V1未使用のdocs/08テーブルも先行作成し、後の移行を不要にする)。
 * 注意: 既存DBに対してCREATE TABLE IF NOT EXISTSは外部キーを後付けしない。
 * V1はプレリリースのため、FK追加(2026-07-13)以前に作成したdata/company.dbは作り直すこと
 * (rm data/company.db → pnpm company init / seed --demo)。
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { findRepoRoot } from "../root";
import { runMigrations } from "./migrations";

export type Db = BetterSQLite3Database<typeof schema>;

export function defaultDbPath(): string {
  return path.join(findRepoRoot(), "data", "company.db");
}

const DDL = `
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, unlock_note TEXT
);
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id), name TEXT NOT NULL, role TEXT NOT NULL,
  agent_ref TEXT NOT NULL, model_profile TEXT NOT NULL, persona_json TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
  assignee_id TEXT NOT NULL REFERENCES employees(id), post_id TEXT REFERENCES posts(id),
  status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 5,
  input_json TEXT, retry_count INTEGER NOT NULL DEFAULT 0, run_date TEXT NOT NULL, error TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_idem_uq ON tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), seq INTEGER NOT NULL, ts TEXT NOT NULL,
  type TEXT NOT NULL, payload_json TEXT, actor TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS task_events_seq_uq ON task_events(task_id, seq);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), post_id TEXT, kind TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, content_json TEXT, file_path TEXT,
  schema_version TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, pillar TEXT NOT NULL, format TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL, planned_date TEXT, caption_final TEXT, hashtags_json TEXT,
  export_path TEXT, published_at TEXT, publish_method TEXT NOT NULL DEFAULT 'manual',
  rights_state TEXT NOT NULL DEFAULT 'n/a'
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, decision TEXT NOT NULL,
  comment TEXT, decided_by TEXT NOT NULL, decided_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, detail_json TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, run_date TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), model_profile TEXT NOT NULL,
  est_input_chars INTEGER NOT NULL DEFAULT 0, est_output_chars INTEGER NOT NULL DEFAULT 0,
  wall_seconds INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
-- ---- docs/08定義・V1未使用(将来スライス用に先行作成) ----
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, publisher TEXT NOT NULL,
  published_at TEXT NOT NULL, checked_at TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
  reliability TEXT NOT NULL, summary TEXT, fact_or_inference TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_sources (post_id TEXT NOT NULL, source_id TEXT NOT NULL, cited_as TEXT);
CREATE TABLE IF NOT EXISTS qa_reviews (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL, artifact_id TEXT, result TEXT NOT NULL,
  checklist_json TEXT, issues_json TEXT, reviewer_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio_items (
  id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, site_url TEXT, assets_path TEXT,
  highlights_json TEXT, permission_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_permissions (
  id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, scope_json TEXT NOT NULL, status TEXT NOT NULL,
  evidence_path TEXT, granted_at TEXT, expires_at TEXT
);
CREATE TABLE IF NOT EXISTS post_metrics (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL, measured_at TEXT NOT NULL, reach INTEGER,
  profile_views INTEGER, saves INTEGER, shares INTEGER, comments INTEGER, dm_starts INTEGER,
  follower_count INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, held_on TEXT NOT NULL, agenda_json TEXT,
  decisions_json TEXT, minutes_artifact_id TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  body_artifact_id TEXT
);
`;

export interface OpenedDb {
  db: Db;
  sqlite: Database.Database;
}

export function openDb(dbPath: string = process.env.BLOOM_DB_PATH ?? defaultDbPath()): OpenedDb {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(DDL);
    // バージョン付きマイグレーション(schema_migrations管理・全体トランザクション・部分適用なし)
    runMigrations(sqlite);
    const db = drizzle(sqlite, { schema });
    return { db, sqlite };
  } catch (err) {
    // 初期化・migration失敗時は接続を確実に閉じてから再throwする(P2)
    sqlite.close();
    throw err;
  }
}

/** テスト用: V2形状のDB(マイグレーション未適用)を作る素のDDL */
export const BASE_DDL = DDL;
