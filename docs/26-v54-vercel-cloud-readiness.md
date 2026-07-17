# 26. V5.4 Vercelクラウド対応基盤(移行準備)

**状態: 移行「準備」完了(2026-07-17)。実デプロイ・PostgreSQL接続・データ投入は未実施。**
V5.4は「今のSQLiteローカル運用を一切壊さず、将来Vercel+PostgreSQLへ安全に移行できる土台」を作るフェーズであり、移行そのものは行っていない。

## 1. 現在の構成と移行後の構成

| 項目 | 現在(ローカル・正) | 将来(Vercel移行後) |
|---|---|---|
| アプリ | Next.js 15(`pnpm dev` / localhost:3000) | Vercel(Preview→Production) |
| DB | SQLite(`data/company.db`・better-sqlite3・WAL) | PostgreSQL(Neon Free / Supabase Free等から将来選定) |
| 画像公開 | Vercel Blob(V5.2実装済み) | 同じ(継続) |
| AI社員 | Claude Codeセッション+company CLI | **当面ローカル実行のまま**(生成はMacで行い、DBだけクラウド) |
| 認証 | ローカル単一ユーザー(ヘッダー+Origin検査) | Preview=Vercel Authentication / Production=アプリ内owner認証(方式未確定) |
| スケジューラ | 代表者の/kickoff | Vercel CronはV6以降(CRON_SECRET予約済み) |

**費用方針: 月額追加0円を維持する。** PostgreSQL自体は無料のOSSであり、Neon Free / Supabase Free等の無料枠を将来選択できる。**現時点ではいかなるサービスも契約・作成しない**(Vercel Proは契約済みの既存分のみ)。

## 2. SQLiteをVercelで直接使えない理由

- Vercelのサーバーレス関数のファイルシステムは**一時的(ephemeral)**で、リクエスト間・リージョン間で共有されない。`data/company.db` への書き込みは保存されず消える
- better-sqlite3はネイティブバインディングを含み、書き込み可能な永続ディスクとWALを前提とする
- そのため `DATABASE_PROVIDER=sqlite` のままVercelへ公開しても動作しない。cloud-readinessはこれをblockerとして表示し、UIは全変更操作を拒否する(fail closed)

## 3. V5.4で整備したもの

### 3.1 DB境界(`src/adapters/db/provider.ts`)

- `DATABASE_PROVIDER`(既定 `sqlite`)。`postgres` は予約値
- `postgres` 指定で `DATABASE_URL` 未設定 → **fail closedで停止**
- `postgres`+URLありでも、V5.4では接続実装が無いため**「未実装」と正直に停止**(偽装しない)
- `DATABASE_URL` の値はログ・エラー・UI・監査ログへ出力しない
- 責務境界: 接続生成(client.ts)/ MigrationRunner(migrations.ts)/ TransactionBoundary(drizzle transaction)/ Store(store.ts・views.ts)/ BackupProvider(backup.ts)/ HealthCheck(doctorScan)。将来のPostgreSQL実装はこの境界ごとに追加する

### 3.2 SQLite固有処理の一覧(移行時に差し替えが必要な箇所)

| 分類 | 箇所 | PostgreSQLでの扱い |
|---|---|---|
| PRAGMA(WAL/foreign_keys/table_info/foreign_key_check) | client.ts / migrations.ts / views.ts / backup.ts | 不要 or information_schema・制約検査へ置換 |
| `VACUUM INTO`(整合スナップショット) | backup.ts | `pg_dump` へ置換 |
| boolean=INTEGER 0/1 | sources.is_primary/usable, customer_permissions.anonymous_allowed, template_variant_qa.preview_complete | boolean(import時に0/1→false/true変換) |
| 日時=ISO8601文字列TEXT | 全 *_at / ts 列 | timestamptz |
| 業務日付=YYYY-MM-DD TEXT | run_date / planned_date / held_on / period_* | date |
| JSON=TEXT列(*_json) | 23列 | jsonb |
| UPSERT | store.ts settings(onConflictDoUpdate)ほかonConflictDoNothing | PG `ON CONFLICT` 互換(Drizzle対応済み) |
| 複合一意制約・FK | schema.ts / migrations.ts #2,#4,#5 | schema.sqlで同一範囲を定義済み |
| append-only(task_events/audit_log) | store.ts appendEvent/audit | PGではアプリロールに `REVOKE UPDATE, DELETE` を適用 |
| better-sqlite3固有API(prepare/exec/transaction) | migrations.ts / backup.ts / migrate/export.ts | PG用MigrationRunner・エクスポータを別実装 |

### 3.3 PostgreSQL初期スキーマ

`src/adapters/db/postgres/schema.sql` — 全24テーブル+schema_migrations。主キー・外部キー・複合一意制約・index・NOT NULL・jsonb・timestamptz・boolean・冪等キーをSQLite実スキーマと同一範囲で定義。`tests/v54-cloud.test.ts` が「SQLite実DBの全テーブル・全列がschema.sqlに存在するか」を機械照合する。

### 3.4 データ移行ツール(export / import準備)

```bash
pnpm company db-export --actor owner [--output <dir>]   # SQLite→JSONL+manifest(読み取り専用)
pnpm company db-export-verify --from <dir>              # SHA-256/件数/重複PK/FK検証(改ざん検知)
pnpm company db-import-check --from <dir>               # PostgreSQL投入前の事前検証(実接続なし)
pnpm company db-import-postgres --from <dir> --actor owner [--execute]  # V5.4は常にdry-run止まり
```

- exportは**readonly接続**のみを使い、実DBを変更しない(SHA-256一致で検証済み)
- 出力は決定的(主キー順・キーソート済みJSONL)。tmp生成→atomic renameで不完全成果物を残さない
- 既定の保存先は `data/backups/db-export/<timestamp>/`(gitignore対象。**Gitへ追加しない**)
- manifestに件数・schema version(migration最大ID=10)・export version・各ファイルSHA-256・FK参照件数を記録
- importは既定dry-run。`--execute` でも `DATABASE_PROVIDER=postgres`+`DATABASE_URL` が無ければ拒否し、揃っていても**実接続実装が入るまで接続前に必ず停止**する
- 二重import防止: manifest.json全体のSHA-256を `import_id` とし、PostgreSQL専用の `import_history` テーブル(schema.sql定義。PRIMARY KEY=import_id)へ投入と同一トランザクションで記録する。**同一import_idの再importは主キー違反で拒否**される。import_historyはSQLite側には存在せず、db-exportの対象外
- 検証はfail closed: manifestはZodで厳密検証し、テーブル集合の完全一致・ファイル名規約(`<テーブル名>.jsonl`のみ・パス区切り/`..`拒否)・シンボリックリンク拒否・SHA-256/bytes/件数/totalRows照合・主キー欠落/重複・FK整合・manifest外ファイル混入をすべて拒否する

### 3.5 安全ゲート(Instagram実投稿)

core層 `src/core/runtime.ts` で強制(UI/CLI/APIから回避不能):

| 環境 | META_PUBLISH_MODE=live の扱い |
|---|---|
| テスト(NODE_ENV=test / VITEST) | **常に拒否** |
| Vercel Preview / development | **常に拒否**(ALLOW_LIVE_INSTAGRAM_PUBLISH=trueでも解除不可) |
| Vercel production | `ALLOW_LIVE_INSTAGRAM_PUBLISH=true` との**二重条件**が必要 |
| APP_RUNTIME_MODE=cloudだがVercel外 | 拒否(環境を特定できない) |
| ローカル代表者環境 | 従来どおり(V5.3の手順・二段階確認・dry-run fingerprint一致を維持) |

拒否時は `loadInstagramConfig` がliveを`disabled`へ降格するため、Metaクライアントは生成すらされない。E2EはwebServer環境変数で `META_PUBLISH_MODE=disabled`+空トークンを明示固定し、実`.env`から隔離した。

### 3.6 クラウド公開時の認証ガード

- `APP_RUNTIME_MODE`(既定 `local`)。`VERCEL_ENV` があれば設定に関係なくcloud扱い(fail closed)
- cloud実行で `OWNER_AUTH_PROVIDER` が未設定・未実装の間、**全変更系API(15ルート共通の `assertOwnerRequest`)が拒否**される
- 簡易パスワード認証は実装しない(即席認証の禁止)。V5.4時点の実装済み認証方式は**ゼロ**であり、方式確定まではProduction公開禁止
- **PreviewはVercel Authenticationで保護する前提**(Vercelプロジェクト設定 → Deployment Protection → Vercel Authentication を有効化)。ただしこれはPreview閲覧の保護であり、**Productionの恒久認証としては扱わない**
- cloud実行時はUI上部に「クラウド実行モード・ローカル専用機能は使用不可」のバナーを常時表示

### 3.7 診断

```bash
pnpm company cloud-readiness   # 秘密値ゼロのJSON診断(blockers/warnings区別)
pnpm company doctor            # V5.4追加: 公開画像URLの安全性・schema_migrations欠番検査
```

## 4. 将来の移行手順(SQLite → PostgreSQL)

1. 移行先を代表者が選定・契約(Neon Free / Supabase Free等。**契約前に費用0円を確認**)
2. PostgreSQL接続実装(provider境界へ追加)+ `schema.sql` 適用 + import実装を追加する(V5.5以降の実装作業)
3. ローカルで `pnpm company backup` → `pnpm company db-export --actor owner` → `db-export-verify` → `db-import-check`
4. `db-import-postgres --from <dir> --actor owner --execute`(実装後)。全体1トランザクション・失敗時は全ロールバック
5. 件数・SHA-256・doctor相当の整合検査をPostgreSQL側で実行し、SQLite側と照合
6. 並行運用1〜2週(ローカルSQLiteを正)→ 問題なければクラウドを正へ切替

### rollback手順

- 移行後に問題が出た場合: `DATABASE_PROVIDER=sqlite` へ戻すだけでローカル運用が完全復帰する(SQLite実DBは移行後も削除しない)
- SQLite自体の破損時: `pnpm company restore --from <日付>`(14世代バックアップ)
- PostgreSQL側は import ID 単位で全テーブルをTRUNCATE→再importできる設計(部分適用が無いため)

## 5. Vercelプロジェクト設定(デプロイ時の手順書。V5.4では実行しない)

- Root Directory: `apps/dashboard` / Install Command: `pnpm install`(monorepo自動検出)
- `next.config.mjs` は `outputFileTracingRoot`・`externalDir`・`serverExternalPackages: ["better-sqlite3"]` 設定済み(better-sqlite3はPG移行後に依存から外す判断も可)
- **Deployment Protection → Vercel Authentication を必ず有効化**(Preview保護)
- **Environment Variables は Sensitive 指定**で登録(META_ACCESS_TOKEN / BLOB_READ_WRITE_TOKEN / DATABASE_URL / CRON_SECRET)。値はGit・ログへ出さない
- Preview環境の推奨値:
  ```
  DATABASE_PROVIDER=postgres
  APP_RUNTIME_MODE=cloud
  META_PUBLISH_MODE=disabled
  ALLOW_LIVE_INSTAGRAM_PUBLISH=false
  ```
- **Productionは、DB移行・owner認証実装・検証が完了するまで環境変数を設定しない(公開しない)**

## 6. 制約と方針(V5.4確定)

- Previewでは実投稿禁止(構造的・解除不可)
- Production公開条件: PostgreSQL移行完了 + owner認証実装 + `META_PUBLISH_MODE=live` + `ALLOW_LIVE_INSTAGRAM_PUBLISH=true` + V5.3の投稿単位ゲート(承認・QA・fingerprint・二段階確認)全通過
- AI社員(kickoff・company CLI)は当面ローカル実行のまま
- Vercel Cron(自動始業)はV6以降。`CRON_SECRET` は予約のみ
- 月額追加費用0円を維持(新規契約・従量課金の有効化はすべて代表者の事前承認が必要)

## 7. 残っている手動作業(代表者)

1. `.env` の `META_PUBLISH_MODE` を作業後 `disabled` へ戻す(cloud-readinessが警告中)
2. 将来の移行時: PostgreSQLサービスの選定・無料枠確認・契約判断
3. Production用owner認証方式の決定(パスキー/OAuth等。決定後に実装)

## 8. V6へ進む条件

- V5.4の全検証グリーンを維持したまま代表者レビュー・コミット承認が完了している
- 投稿実績データ(3日/7日実績)が分析に足る本数たまっている
- V6スコープ(投稿後分析・改善ループ、Vercel Cron)を代表者が指示する
