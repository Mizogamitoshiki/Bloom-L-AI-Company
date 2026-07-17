/** V5 Instagram公式API設定。秘密値は環境変数だけに置き、DB/UI/ログへ渡さない。 */
import { liveInstagramBlockedReason } from "../../core/runtime";

export type InstagramPublishMode = "disabled" | "dry_run" | "live";

export interface InstagramConfig {
  mode: InstagramPublishMode;
  /** .envで要求されたモード(実行環境ゲートによる降格前の値) */
  requestedMode: InstagramPublishMode;
  /** V5.4: 実行環境(Vercel Preview/テスト等)がliveを禁止している理由。許可時はnull */
  liveBlockedReason: string | null;
  apiVersion: string;
  igUserId: string;
  accessToken: string;
  mediaBaseUrl: string;
  graphBaseUrl: string;
}

export interface InstagramPublicConfig {
  mode: InstagramPublishMode;
  requestedMode: InstagramPublishMode;
  liveBlockedReason: string | null;
  apiVersion: string;
  accountConfigured: boolean;
  tokenConfigured: boolean;
  mediaBaseConfigured: boolean;
  liveReady: boolean;
  missing: string[];
}

export interface InstagramConfigCheckOptions {
  /** Vercel Blob等で投稿単位の公開URLを準備できる場合は、旧META_MEDIA_BASE_URLを必須にしない。 */
  mediaStorageConfigured?: boolean;
  /** 実投稿直前はbuildInstagramPostPlanが投稿単位のURLを検査するため、基点URL検査を委譲できる。 */
  deferMediaCheckToPostPlan?: boolean;
}

const MODE_VALUES = new Set<InstagramPublishMode>(["disabled", "dry_run", "live"]);

export function loadInstagramConfig(env: NodeJS.ProcessEnv = process.env): InstagramConfig {
  const requested = env.META_PUBLISH_MODE?.trim() || "disabled";
  const requestedMode: InstagramPublishMode = MODE_VALUES.has(requested as InstagramPublishMode)
    ? (requested as InstagramPublishMode)
    : "disabled";
  // V5.4: Vercel Preview/テスト環境等ではliveを構造的に無効化する(META_PUBLISH_MODE=liveを無視して降格)。
  // ローカル代表者環境(VERCEL_ENVなし・cloud指定なし)は従来どおり。
  const liveBlockedReason = requestedMode === "live" ? liveInstagramBlockedReason(env) : null;
  const mode: InstagramPublishMode = liveBlockedReason ? "disabled" : requestedMode;
  return {
    mode,
    requestedMode,
    liveBlockedReason,
    apiVersion: env.META_GRAPH_API_VERSION?.trim() || "v23.0",
    igUserId: env.META_IG_USER_ID?.trim() || "",
    accessToken: env.META_ACCESS_TOKEN?.trim() || "",
    mediaBaseUrl: env.META_MEDIA_BASE_URL?.trim().replace(/\/+$/, "") || "",
    graphBaseUrl: "https://graph.instagram.com",
  };
}

function isPublicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function publicInstagramConfig(
  config: InstagramConfig,
  env: NodeJS.ProcessEnv = process.env,
  options: InstagramConfigCheckOptions = {},
): InstagramPublicConfig {
  const missing: string[] = [];
  if (env.META_PUBLISH_MODE && !MODE_VALUES.has(env.META_PUBLISH_MODE as InstagramPublishMode)) {
    missing.push("META_PUBLISH_MODE は disabled / dry_run / live のいずれかにしてください");
  }
  if (!/^v\d+\.\d+$/.test(config.apiVersion)) missing.push("META_GRAPH_API_VERSION を v23.0 の形式で設定してください");
  if (!/^\d+$/.test(config.igUserId)) missing.push("META_IG_USER_ID を設定してください");
  if (!config.accessToken) missing.push("META_ACCESS_TOKEN を設定してください");
  if (!isPublicHttps(config.mediaBaseUrl) && !options.mediaStorageConfigured && !options.deferMediaCheckToPostPlan) {
    missing.push("META_MEDIA_BASE_URL にMetaから取得可能な公開HTTPS URLを設定してください");
  }
  if (config.liveBlockedReason) missing.push(config.liveBlockedReason);
  return {
    mode: config.mode,
    requestedMode: config.requestedMode,
    liveBlockedReason: config.liveBlockedReason,
    apiVersion: config.apiVersion,
    accountConfigured: /^\d+$/.test(config.igUserId),
    tokenConfigured: config.accessToken.length > 0,
    mediaBaseConfigured: isPublicHttps(config.mediaBaseUrl),
    liveReady: config.mode === "live" && missing.length === 0,
    missing,
  };
}

/**
 * live設定の最終検証。V5.4レビュー修正5: envは呼び出し元から注入する(既定はprocess.env)。
 * publishInstagramPostのdeps.envと検証対象を一致させ、テスト時のenv差し替えを正確にする。
 */
export function assertInstagramLiveConfig(
  config: InstagramConfig,
  options: InstagramConfigCheckOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): void {
  const safe = publicInstagramConfig(config, env, options);
  if (config.mode !== "live") throw new Error("Instagram実投稿モードが有効ではありません(META_PUBLISH_MODE=live が必要です)");
  if (safe.missing.length > 0) throw new Error(`Instagram公式APIの設定が未完了です: ${safe.missing.join(" / ")}`);
}
