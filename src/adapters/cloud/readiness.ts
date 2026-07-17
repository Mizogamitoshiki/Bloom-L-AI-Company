/**
 * V5.4 クラウド移行準備の診断(読み取り専用)。
 * 秘密値(トークン・DATABASE_URL等)は絶対に出力へ含めない。設定済み/未設定のbooleanだけを返す。
 * blocker = その環境での運用を止める問題 / warning = 運用は可能だが対応推奨。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  liveInstagramBlockedReason,
  ownerAuthConfigured,
  resolveDeployTarget,
  resolveRuntimeMode,
  type DeployTarget,
  type RuntimeMode,
} from "../../core/runtime";
import { resolveDatabaseProvider } from "../db/provider";
import { findRepoRoot } from "../root";
import { EXPORT_TABLES, dbExportRoot, verifyDbExport } from "../db/migrate/export";

export interface CloudReadinessReport {
  ok: boolean;
  runtimeMode: RuntimeMode;
  deployTarget: DeployTarget;
  databaseProvider: string;
  sqliteReady: boolean;
  postgresPrepared: boolean;
  /** V5.4では実接続を実装していないため常にfalse(正直に報告する) */
  postgresConnected: false;
  blobConfigured: boolean;
  ownerAuthConfigured: boolean;
  metaPublishMode: string;
  previewSafe: boolean;
  instagramLiveBlockedInPreview: boolean;
  backupAvailable: boolean;
  dbExportVerified: boolean;
  localOperational: boolean;
  vercelPreviewReady: boolean;
  vercelDeployReady: boolean;
  blockers: string[];
  warnings: string[];
}

export interface CloudReadinessProbes {
  /** SQLite実DBへ読み取りクエリが通ったか(呼び出し側の既存接続で確認して渡す) */
  sqliteQueryOk: boolean;
  blobConfigured: boolean;
  backupCount: number;
}

/** postgres/schema.sql が存在し、エクスポート対象の全テーブルのCREATE TABLEを含むか(実接続なしの機械検証)。 */
export function postgresSchemaPrepared(repoRoot: string = findRepoRoot()): { prepared: boolean; missingTables: string[] } {
  const schemaPath = path.join(repoRoot, "src", "adapters", "db", "postgres", "schema.sql");
  if (!existsSync(schemaPath)) return { prepared: false, missingTables: EXPORT_TABLES.map((t) => t.name) };
  const sql = readFileSync(schemaPath, "utf8");
  const missing = EXPORT_TABLES.map((t) => t.name).filter(
    (name) => !new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\s*\\(`).test(sql),
  );
  return { prepared: missing.length === 0, missingTables: missing };
}

/** 最新のdb-exportディレクトリを検証する(なければfalse)。 */
export function latestDbExportVerified(env: Record<string, string | undefined> = process.env): boolean {
  const root = dbExportRoot(env);
  if (!existsSync(root)) return false;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.includes(".tmp-"))
    .map((d) => d.name)
    .sort();
  const latest = dirs[dirs.length - 1];
  if (!latest) return false;
  try {
    return verifyDbExport(path.join(root, latest)).ok;
  } catch {
    return false;
  }
}

export function buildCloudReadiness(
  env: Record<string, string | undefined>,
  probes: CloudReadinessProbes,
): CloudReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const runtimeMode = resolveRuntimeMode(env);
  const deployTarget = resolveDeployTarget(env);

  let databaseProvider = "sqlite";
  let providerOk = true;
  try {
    databaseProvider = resolveDatabaseProvider(env).provider;
  } catch (err) {
    providerOk = false;
    databaseProvider = "invalid";
    blockers.push(err instanceof Error ? err.message : String(err));
  }

  const sqliteReady = databaseProvider === "sqlite" && probes.sqliteQueryOk;
  const { prepared: postgresPrepared, missingTables } = postgresSchemaPrepared();
  if (!postgresPrepared && missingTables.length > 0) {
    warnings.push(`PostgreSQLスキーマに不足テーブルがあります: ${missingTables.join(", ")}`);
  }
  const authConfigured = ownerAuthConfigured(env);
  const metaPublishMode = env.META_PUBLISH_MODE?.trim() || "disabled";

  // 構造検証: Preview相当の環境ではALLOW_LIVEを立ててもliveが拒否されること
  const instagramLiveBlockedInPreview =
    liveInstagramBlockedReason({ VERCEL_ENV: "preview", META_PUBLISH_MODE: "live", ALLOW_LIVE_INSTAGRAM_PUBLISH: "true" }) !== null;
  const previewSafe = instagramLiveBlockedInPreview;
  if (!instagramLiveBlockedInPreview) blockers.push("Preview環境のInstagram live禁止ゲートが機能していません(実装異常)");

  if (databaseProvider === "sqlite" && runtimeMode === "cloud") {
    blockers.push("SQLite(ローカルファイルDB)はVercelでは使用できません。DATABASE_PROVIDER=postgres への移行が必要です");
  }
  if (databaseProvider === "postgres") {
    // 診断は継続するが、この構成ではまだ運用できない事実をblockerとして正直に報告する
    blockers.push(
      "PostgreSQL接続はV5.4では未実装です(移行準備のみ完了)。運用は DATABASE_PROVIDER=sqlite へ戻してください",
    );
  }
  if (runtimeMode === "cloud" && !authConfigured) {
    blockers.push("クラウド実行のowner認証が未設定です(OWNER_AUTH_PROVIDER)。設定されるまで変更系APIは全て拒否されます");
  }
  if (runtimeMode === "local" && databaseProvider === "sqlite" && !sqliteReady && providerOk) {
    blockers.push("SQLite実DBへ読み取りクエリが通りません(pnpm company doctor で確認してください)");
  }
  if (env.DATABASE_URL?.trim() && databaseProvider === "sqlite") {
    warnings.push("DATABASE_URLが設定されていますが、DATABASE_PROVIDER=sqlite のため使用されません");
  }
  if (metaPublishMode === "live" && runtimeMode === "local") {
    warnings.push("META_PUBLISH_MODE=live です(ローカル代表者環境の実投稿が有効)。作業後はdisabledへ戻す運用を推奨します");
  }
  if (probes.backupCount === 0) warnings.push("バックアップがありません(pnpm company backup を実行してください)");
  const dbExportVerified = latestDbExportVerified(env);
  if (!dbExportVerified) warnings.push("検証済みのDB移行エクスポートがありません(pnpm company db-export → db-export-verify)");
  if (!probes.blobConfigured) warnings.push("Vercel Blob(BLOB_READ_WRITE_TOKEN)が未設定です(公開画像の準備に必要)");

  const localOperational = sqliteReady && databaseProvider === "sqlite";
  // Preview/本番公開は「PostgreSQL実接続」「認証」の完了が前提。V5.4は準備段階のため常にfalse(偽装しない)。
  const vercelPreviewReady = false;
  const vercelDeployReady = false;

  return {
    ok: blockers.length === 0,
    runtimeMode,
    deployTarget,
    databaseProvider,
    sqliteReady,
    postgresPrepared,
    postgresConnected: false,
    blobConfigured: probes.blobConfigured,
    ownerAuthConfigured: authConfigured,
    metaPublishMode,
    previewSafe,
    instagramLiveBlockedInPreview,
    backupAvailable: probes.backupCount > 0,
    dbExportVerified,
    localOperational,
    vercelPreviewReady,
    vercelDeployReady,
    blockers,
    warnings,
  };
}
