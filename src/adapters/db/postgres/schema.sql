-- =============================================================================
-- Bloom-L AI Company — PostgreSQL初期スキーマ(V5.4移行準備。まだ実接続・適用はしない)
-- =============================================================================
-- 由来: SQLite実スキーマ(src/adapters/db/client.ts BASE_DDL + migrations.ts #1〜#10 適用後)と
--       src/adapters/db/schema.ts の全24テーブル + schema_migrations。
--       tests/v54-cloud.test.ts が「SQLite実DBの全テーブル・全列がこのファイルに存在するか」を機械検証する。
--
-- 型変換規約(SQLite → PostgreSQL):
--   TEXT(ULID等のID)                  → text
--   TEXT(ISO8601日時 例 2026-07-17T09:00:00.000Z) → timestamptz
--   TEXT(業務日付 YYYY-MM-DD)          → date
--   TEXT(*_json列。JSON.stringify済み)  → jsonb
--   INTEGER(0/1のboolean)             → boolean   ※import時に 0/1 → false/true 変換が必要
--   INTEGER(件数・秒数・版数等)         → integer
--   例外: sources.published_at / checked_at / fetched_at は「不明=空文字」運用のため text のまま
--         (verification_status と組で意味を持つ。日時型への正規化はV6以降の別判断)
--
-- 不変条件の維持:
--   - task_events / audit_log はappend-only。アプリは INSERT のみ発行し、
--     運用ではアプリ用DBロールに対し REVOKE UPDATE, DELETE ON task_events, audit_log を適用する。
--   - 冪等キー(tasks.idempotency_key / instagram_publish_jobs.idempotency_key)はUNIQUE維持。
--   - 複合一意(task_events(task_id,seq) / post_metrics(post_id,window_days) /
--     meetings(kind,period_end) / template_versions(template_id,version) /
--     template_variant_qa(template_id,version,variant) / post_media_uploads(post_id,image_index))を維持。
--   - 外部キーはSQLite実スキーマと同一範囲のみ定義する(SQLiteでFKが無い列
--     例: posts.portfolio_item_id, artifacts.post_id にはPG側でも付けない。
--     付けると旧データのimportが失敗しうるため、強化はimport完了後の別migrationで行う)。
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL
);

-- V5.4: 二重import防止(PostgreSQL専用の管理テーブル。SQLite exportの対象外)。
-- import_id = エクスポートmanifest.json全体のSHA-256。同一import_idの再importは
-- このPRIMARY KEY違反で拒否される(db-import-checkのidempotencyPlanと対応)。
CREATE TABLE IF NOT EXISTS import_history (
  import_id text PRIMARY KEY,
  manifest_digest text NOT NULL UNIQUE,
  export_created_at timestamptz NOT NULL,
  schema_version integer NOT NULL,
  table_count integer NOT NULL,
  total_rows integer NOT NULL,
  imported_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL,
  unlock_note text
);

CREATE TABLE IF NOT EXISTS employees (
  id text PRIMARY KEY,
  department_id text NOT NULL REFERENCES departments(id),
  name text NOT NULL,
  role text NOT NULL,
  agent_ref text NOT NULL,
  model_profile text NOT NULL,
  persona_json jsonb
);

CREATE TABLE IF NOT EXISTS customer_permissions (
  id text PRIMARY KEY,
  customer_name text NOT NULL,
  scope_json jsonb NOT NULL,
  status text NOT NULL,
  evidence_path text,
  granted_at timestamptz,
  expires_at timestamptz,
  anonymous_allowed boolean NOT NULL DEFAULT false,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id text PRIMARY KEY,
  customer_name text NOT NULL,
  site_url text,
  assets_path text,
  highlights_json jsonb,
  permission_id text REFERENCES customer_permissions(id),
  created_at timestamptz NOT NULL,
  anonymous_name text,
  summary text,
  technologies_json jsonb,
  problem text,
  testimonial text
);
CREATE INDEX IF NOT EXISTS portfolio_items_perm_idx ON portfolio_items(permission_id);

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  pillar text NOT NULL,
  format text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  planned_date date,
  caption_final text,
  hashtags_json jsonb,
  export_path text,
  published_at timestamptz,
  publish_method text NOT NULL DEFAULT 'manual',
  rights_state text NOT NULL DEFAULT 'n/a',
  template_id text NOT NULL DEFAULT 'tpl-howto',
  portfolio_item_id text,
  created_at date
);
CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status);
CREATE INDEX IF NOT EXISTS posts_planned_idx ON posts(planned_date);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at);

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  title text NOT NULL,
  url text NOT NULL,
  publisher text NOT NULL,
  published_at text NOT NULL,
  checked_at text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  reliability text NOT NULL,
  summary text,
  fact_or_inference text NOT NULL,
  fetched_at text,
  usable boolean NOT NULL DEFAULT true,
  verification_status text NOT NULL DEFAULT 'confirmed'
);
CREATE UNIQUE INDEX IF NOT EXISTS sources_url_uq ON sources(url);

CREATE TABLE IF NOT EXISTS post_sources (
  post_id text NOT NULL REFERENCES posts(id),
  source_id text NOT NULL REFERENCES sources(id),
  cited_as text,
  PRIMARY KEY (post_id, source_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  assignee_id text NOT NULL REFERENCES employees(id),
  post_id text REFERENCES posts(id),
  status text NOT NULL,
  priority integer NOT NULL DEFAULT 5,
  input_json jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  run_date date NOT NULL,
  error text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_idem_uq ON tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);

CREATE TABLE IF NOT EXISTS task_events (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  seq integer NOT NULL,
  ts timestamptz NOT NULL,
  type text NOT NULL,
  payload_json jsonb,
  actor text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS task_events_seq_uq ON task_events(task_id, seq);
CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  post_id text,
  kind text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content_json jsonb,
  file_path text,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_post_idx ON artifacts(post_id, kind, version);

CREATE TABLE IF NOT EXISTS qa_reviews (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id),
  artifact_id text REFERENCES artifacts(id),
  result text NOT NULL,
  checklist_json jsonb,
  issues_json jsonb,
  reviewer_id text NOT NULL,
  created_at timestamptz NOT NULL,
  notes_json jsonb
);
CREATE INDEX IF NOT EXISTS qa_reviews_post_idx ON qa_reviews(post_id, created_at);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  decision text NOT NULL,
  comment text,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  ts timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  detail_json jsonb
);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  run_date date NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL,
  note text
);

CREATE TABLE IF NOT EXISTS usage_records (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  model_profile text NOT NULL,
  est_input_chars integer NOT NULL DEFAULT 0,
  est_output_chars integer NOT NULL DEFAULT 0,
  wall_seconds integer NOT NULL DEFAULT 0,
  ts timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_records_ts_idx ON usage_records(ts);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  kind text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  body_artifact_id text REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id),
  measured_at timestamptz NOT NULL,
  window_days integer,
  reach integer,
  profile_views integer,
  saves integer,
  shares integer,
  comments integer,
  dm_starts integer,
  follower_count integer,
  note text,
  created_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_post_window_uq ON post_metrics(post_id, window_days);

CREATE TABLE IF NOT EXISTS meetings (
  id text PRIMARY KEY,
  kind text NOT NULL,
  held_on date NOT NULL,
  period_start date,
  period_end date,
  participants_json jsonb,
  agenda_json jsonb,
  decisions_json jsonb,
  minutes_artifact_id text REFERENCES artifacts(id),
  created_at timestamptz
);
CREATE INDEX IF NOT EXISTS meetings_kind_idx ON meetings(kind, held_on);
CREATE UNIQUE INDEX IF NOT EXISTS meetings_kind_period_uq ON meetings(kind, period_end);

CREATE TABLE IF NOT EXISTS template_versions (
  id text PRIMARY KEY,
  template_id text NOT NULL,
  family text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  fingerprint text NOT NULL,
  note text,
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS template_versions_tpl_ver_uq ON template_versions(template_id, version);

CREATE TABLE IF NOT EXISTS post_renders (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id),
  spec_artifact_id text NOT NULL REFERENCES artifacts(id),
  template_id text NOT NULL,
  template_version integer NOT NULL,
  variant text NOT NULL,
  fingerprint text NOT NULL,
  design_qa_result text,
  design_qa_json jsonb,
  visual_qa_result text,
  visual_qa_json jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS post_renders_post_idx ON post_renders(post_id, created_at);

CREATE TABLE IF NOT EXISTS template_variant_qa (
  id text PRIMARY KEY,
  template_id text NOT NULL,
  version integer NOT NULL,
  variant text NOT NULL,
  fingerprint text NOT NULL,
  content_qa_result text,
  mechanical_qa_result text,
  visual_qa_result text,
  visual_qa_json jsonb,
  preview_complete boolean NOT NULL DEFAULT false,
  page_count integer,
  fixture_kind text,
  rights text,
  layout_ids_json jsonb,
  page_hashes_json jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS template_variant_qa_uq ON template_variant_qa(template_id, version, variant);

CREATE TABLE IF NOT EXISTS instagram_publish_jobs (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id),
  idempotency_key text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  media_urls_json jsonb NOT NULL,
  child_container_ids_json jsonb,
  carousel_container_id text,
  instagram_media_id text,
  error_code text,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS instagram_publish_jobs_idem_uq ON instagram_publish_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS instagram_publish_jobs_post_idx ON instagram_publish_jobs(post_id, created_at);

CREATE TABLE IF NOT EXISTS post_media_uploads (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id),
  image_index integer NOT NULL,
  file_name text NOT NULL,
  sha256 text NOT NULL,
  public_url text NOT NULL,
  provider text NOT NULL,
  uploaded_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS post_media_uploads_post_idx_uq ON post_media_uploads(post_id, image_index);
CREATE INDEX IF NOT EXISTS post_media_uploads_sha_idx ON post_media_uploads(provider, sha256);

-- V6: 投稿後分析・改善ループ(migration #11 と同期)
CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id text PRIMARY KEY,
  window_days integer NOT NULL,
  period_start date,
  period_end date,
  generated_at timestamptz NOT NULL,
  source_data_hash text NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_snapshots_window_hash_uq ON analysis_snapshots(window_days, source_data_hash);
CREATE INDEX IF NOT EXISTS analysis_snapshots_window_idx ON analysis_snapshots(window_days, created_at);

CREATE TABLE IF NOT EXISTS improvement_proposals (
  id text PRIMARY KEY,
  analysis_snapshot_id text NOT NULL REFERENCES analysis_snapshots(id),
  author_employee_id text NOT NULL REFERENCES employees(id),
  title text NOT NULL,
  observation text NOT NULL,
  hypothesis text NOT NULL,
  evidence_refs_json jsonb NOT NULL,
  structured_fact_refs_json jsonb,
  test_variable text NOT NULL,
  test_change_json jsonb,
  expected_signal text NOT NULL,
  proposed_action text NOT NULL,
  risk text NOT NULL,
  expires_at date NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS improvement_proposals_snapshot_idx ON improvement_proposals(analysis_snapshot_id);

-- CEO判断履歴はappend-only(アプリロールに REVOKE UPDATE, DELETE を適用する)
CREATE TABLE IF NOT EXISTS improvement_decisions (
  id text PRIMARY KEY,
  proposal_id text NOT NULL REFERENCES improvement_proposals(id),
  decision text NOT NULL,
  reason text,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL,
  decision_sequence integer NOT NULL
);
CREATE INDEX IF NOT EXISTS improvement_decisions_proposal_idx ON improvement_decisions(proposal_id, decided_at);
CREATE UNIQUE INDEX IF NOT EXISTS improvement_decisions_proposal_sequence_uq ON improvement_decisions(proposal_id, decision_sequence);

CREATE TABLE IF NOT EXISTS post_improvement_directives (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id),
  proposal_id text NOT NULL REFERENCES improvement_proposals(id),
  reason text,
  applied_by text NOT NULL,
  applied_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS post_improvement_directives_uq ON post_improvement_directives(post_id, proposal_id);

CREATE TABLE IF NOT EXISTS business_outcomes (
  id text PRIMARY KEY,
  occurred_on date NOT NULL,
  kind text NOT NULL,
  source text NOT NULL,
  related_post_id text REFERENCES posts(id),
  amount_yen integer,
  anonymized_note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS business_outcomes_occurred_idx ON business_outcomes(occurred_on, kind);

COMMIT;
