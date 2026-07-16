/** V5 Instagram公式API設定。秘密値は環境変数だけに置き、DB/UI/ログへ渡さない。 */
export type InstagramPublishMode = "disabled" | "dry_run" | "live";

export interface InstagramConfig {
  mode: InstagramPublishMode;
  apiVersion: string;
  igUserId: string;
  accessToken: string;
  mediaBaseUrl: string;
  graphBaseUrl: string;
}

export interface InstagramPublicConfig {
  mode: InstagramPublishMode;
  apiVersion: string;
  accountConfigured: boolean;
  tokenConfigured: boolean;
  mediaBaseConfigured: boolean;
  liveReady: boolean;
  missing: string[];
}

const MODE_VALUES = new Set<InstagramPublishMode>(["disabled", "dry_run", "live"]);

export function loadInstagramConfig(env: NodeJS.ProcessEnv = process.env): InstagramConfig {
  const requested = env.META_PUBLISH_MODE?.trim() || "disabled";
  const mode: InstagramPublishMode = MODE_VALUES.has(requested as InstagramPublishMode)
    ? (requested as InstagramPublishMode)
    : "disabled";
  return {
    mode,
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

export function publicInstagramConfig(config: InstagramConfig, env: NodeJS.ProcessEnv = process.env): InstagramPublicConfig {
  const missing: string[] = [];
  if (env.META_PUBLISH_MODE && !MODE_VALUES.has(env.META_PUBLISH_MODE as InstagramPublishMode)) {
    missing.push("META_PUBLISH_MODE は disabled / dry_run / live のいずれかにしてください");
  }
  if (!/^v\d+\.\d+$/.test(config.apiVersion)) missing.push("META_GRAPH_API_VERSION を v23.0 の形式で設定してください");
  if (!/^\d+$/.test(config.igUserId)) missing.push("META_IG_USER_ID を設定してください");
  if (!config.accessToken) missing.push("META_ACCESS_TOKEN を設定してください");
  if (!isPublicHttps(config.mediaBaseUrl)) {
    missing.push("META_MEDIA_BASE_URL にMetaから取得可能な公開HTTPS URLを設定してください");
  }
  return {
    mode: config.mode,
    apiVersion: config.apiVersion,
    accountConfigured: /^\d+$/.test(config.igUserId),
    tokenConfigured: config.accessToken.length > 0,
    mediaBaseConfigured: isPublicHttps(config.mediaBaseUrl),
    liveReady: config.mode === "live" && missing.length === 0,
    missing,
  };
}

export function assertInstagramLiveConfig(config: InstagramConfig): void {
  const safe = publicInstagramConfig(config);
  if (config.mode !== "live") throw new Error("Instagram実投稿モードが有効ではありません(META_PUBLISH_MODE=live が必要です)");
  if (safe.missing.length > 0) throw new Error(`Instagram公式APIの設定が未完了です: ${safe.missing.join(" / ")}`);
}
