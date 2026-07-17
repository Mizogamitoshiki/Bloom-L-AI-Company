/**
 * V5.4 実行環境の判定と安全ゲート(core層)。
 * Vercel Preview/テスト環境からのInstagram実投稿、認証なしクラウド公開を構造的に禁止する。
 * ここは純関数のみ(Node API・DB・ネットワーク禁止)。UI/CLI/アダプターのどこから呼んでも同じ判定になる。
 */

/** 実行モード。既定はlocal。VERCEL_ENVが存在する場合はAPP_RUNTIME_MODE未設定でもcloudとして扱う(fail closed)。 */
export type RuntimeMode = "local" | "cloud";

/** デプロイ先の区分。localはVercel外(代表者のMac等)。 */
export type DeployTarget = "local" | "preview" | "development" | "production";

export type EnvLike = Record<string, string | undefined>;

export function resolveRuntimeMode(env: EnvLike): RuntimeMode {
  // Vercel上で実行されている事実(VERCEL_ENV)は、設定ミスより優先してcloud扱いにする。
  if (env.VERCEL_ENV || env.VERCEL) return "cloud";
  return env.APP_RUNTIME_MODE?.trim() === "cloud" ? "cloud" : "local";
}

export function resolveDeployTarget(env: EnvLike): DeployTarget {
  const v = env.VERCEL_ENV?.trim();
  if (v === "preview" || v === "development" || v === "production") return v;
  if (env.VERCEL_ENV || env.VERCEL) return "preview"; // 不明なVercel環境はpreview相当の最も厳しい扱い
  return "local";
}

export function isTestEnv(env: EnvLike): boolean {
  return env.NODE_ENV === "test" || env.VITEST === "true" || env.VITEST === "1";
}

/**
 * Instagram実投稿(live)を現在の実行環境で許可できない理由を返す。許可できる場合はnull。
 * - テスト環境: 常に禁止
 * - Vercel Preview / development: 常に禁止(ALLOW_LIVE_INSTAGRAM_PUBLISHでも解除不可)
 * - Vercel production: META_PUBLISH_MODE=live に加えて ALLOW_LIVE_INSTAGRAM_PUBLISH=true が必須(二重条件)
 * - APP_RUNTIME_MODE=cloud なのにVERCEL_ENVが無い: 実行環境を特定できないため禁止
 * - ローカル(VERCEL_ENVなし・cloud指定なし): 従来どおり(V5.3の代表者手順を維持)
 */
export function liveInstagramBlockedReason(env: EnvLike): string | null {
  if (isTestEnv(env)) {
    return "テスト環境ではInstagram実投稿(live)を有効化できません";
  }
  const target = resolveDeployTarget(env);
  if (target === "preview" || target === "development") {
    return "Vercel Preview環境ではInstagram実投稿(live)は構造的に禁止です(ALLOW_LIVE_INSTAGRAM_PUBLISHでも解除できません)";
  }
  if (target === "production") {
    if (env.ALLOW_LIVE_INSTAGRAM_PUBLISH?.trim() !== "true") {
      return "本番クラウド環境での実投稿には META_PUBLISH_MODE=live に加えて ALLOW_LIVE_INSTAGRAM_PUBLISH=true の明示が必要です";
    }
    return null;
  }
  // target === "local"
  if (resolveRuntimeMode(env) === "cloud") {
    return "APP_RUNTIME_MODE=cloud ですがVercel環境を特定できないため、実投稿(live)は許可できません";
  }
  return null;
}

/** 実行環境がliveを許可しない場合に例外を投げる(公開経路の最終ゲートで使用)。 */
export function assertLiveInstagramAllowed(env: EnvLike): void {
  const reason = liveInstagramBlockedReason(env);
  if (reason) throw new Error(reason);
}

/** V5.4時点で実装済みのowner認証プロバイダー。まだ存在しない(確定後に追加する)。 */
export const IMPLEMENTED_OWNER_AUTH_PROVIDERS: readonly string[] = [];

export function ownerAuthConfigured(env: EnvLike): boolean {
  const provider = env.OWNER_AUTH_PROVIDER?.trim();
  return !!provider && IMPLEMENTED_OWNER_AUTH_PROVIDERS.includes(provider);
}

/**
 * クラウド実行時に変更系操作(承認・書き出し・公開等)を拒否すべき理由を返す。問題なければnull。
 * ローカル(既定)では従来のowner操作を一切変更しない。
 */
export function cloudMutationBlockedReason(env: EnvLike): string | null {
  if (resolveRuntimeMode(env) !== "cloud") return null;
  const provider = env.OWNER_AUTH_PROVIDER?.trim();
  if (!provider) {
    return "クラウド実行では代表者認証が未設定のため、変更操作を受け付けません(OWNER_AUTH_PROVIDER未設定・fail closed)";
  }
  if (!IMPLEMENTED_OWNER_AUTH_PROVIDERS.includes(provider)) {
    return `クラウド実行の認証方式「${provider}」は未実装のため、変更操作を受け付けません(fail closed)`;
  }
  return null;
}

/**
 * V6再レビューP1-3: 機微な読み取り(改善提案・CEO判断・適用履歴・受注金額・匿名メモ等)の
 * クラウド保護。owner認証が未確定のcloud環境では読み取りもfail closedで拒否する。
 * ローカル単一ユーザー運用(既定)はnull(従来どおり閲覧可能)。即席認証は作らない。
 */
export function cloudSensitiveReadBlockedReason(env: EnvLike): string | null {
  if (resolveRuntimeMode(env) !== "cloud") return null;
  if (ownerAuthConfigured(env)) return null;
  return "クラウド実行では代表者認証が未確定のため、分析・改善提案・事業成果の閲覧を制限しています(fail closed)";
}
