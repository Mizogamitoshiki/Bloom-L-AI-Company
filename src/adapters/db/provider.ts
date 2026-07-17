/**
 * V5.4 DBプロバイダー境界。
 * 既定はSQLite(ローカル運用の正)。DATABASE_PROVIDER=postgres は将来のVercel+PostgreSQL移行用の
 * 予約であり、V5.4時点では接続実装が存在しないため fail closed で停止する(「対応済み」と偽装しない)。
 *
 * 責務の所在(既存実装を境界として整理。全面書き換えはしない):
 * - DB接続生成:        src/adapters/db/client.ts openDb()(SQLite実装)
 * - MigrationRunner:   src/adapters/db/migrations.ts runMigrations()
 * - TransactionBoundary: drizzle db.transaction()(store.ts/publish.ts等)+ migrations.ts の sqlite.transaction()
 * - CompanyStore:      src/adapters/db/store.ts(書き込み)/ views.ts(読み取り・集計)
 * - BackupProvider:    src/adapters/backup/backup.ts(VACUUM INTO+manifest。SQLite固有)
 * - HealthCheckProvider: src/adapters/db/views.ts doctorScan()
 * 将来のPostgreSQL実装は、この境界ごとに実装を追加して差し込む(SQLite側は変更しない)。
 */

export type DatabaseProviderName = "sqlite" | "postgres";

export interface DatabaseProviderResolution {
  provider: DatabaseProviderName;
  /** DATABASE_URLが設定されているか(値そのものは絶対に返さない・ログへ出さない) */
  databaseUrlConfigured: boolean;
}

/**
 * 環境変数からDBプロバイダーを解決する。
 * - 未設定・空: sqlite(既定。現行ローカル運用)
 * - postgres: DATABASE_URL必須。無ければ例外(fail closed)
 * - それ以外の値: 例外(誤設定のまま黙ってsqliteへ落とさない)
 * 例外メッセージへDATABASE_URLの値を含めない。
 */
export function resolveDatabaseProvider(env: Record<string, string | undefined> = process.env): DatabaseProviderResolution {
  const raw = env.DATABASE_PROVIDER?.trim() || "sqlite";
  if (raw === "sqlite") {
    return { provider: "sqlite", databaseUrlConfigured: !!env.DATABASE_URL?.trim() };
  }
  if (raw === "postgres") {
    if (!env.DATABASE_URL?.trim()) {
      throw new Error(
        "DATABASE_PROVIDER=postgres ですが DATABASE_URL が未設定です。接続先を設定するか、DATABASE_PROVIDER=sqlite(既定)へ戻してください(fail closed)",
      );
    }
    return { provider: "postgres", databaseUrlConfigured: true };
  }
  throw new Error(`DATABASE_PROVIDER は sqlite / postgres のいずれかにしてください(現在: ${raw})`);
}

/**
 * openDb直前の使用可否検査。
 * V5.4のPostgreSQLは「スキーマ・移行ツールの準備」までであり、接続・クエリ実装は未実装。
 * postgresが解決された場合は、DATABASE_URLの有無にかかわらず正直に停止する。
 */
export function assertDatabaseProviderUsable(env: Record<string, string | undefined> = process.env): DatabaseProviderResolution {
  const resolved = resolveDatabaseProvider(env);
  if (resolved.provider === "postgres") {
    throw new Error(
      "PostgreSQL接続はV5.4では未実装です(移行準備のみ完了: src/adapters/db/postgres/schema.sql と db-export/db-import-check)。" +
        "ローカル運用は DATABASE_PROVIDER=sqlite(既定)を使用してください",
    );
  }
  return resolved;
}
