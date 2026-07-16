/**
 * V5.2 公開メディアストレージのport(抽象)。
 * Instagram公式APIはMetaが取得できる公開HTTPS URLを要求するため、
 * export bundleの確定画像だけをここ経由で公開ストレージへ配置する。
 * 実装(Vercel Blob等)はadapter層に置き、将来S3等へ差し替え可能にする。
 * トークン等の秘密値はこの層を通過するだけで、戻り値・ログ・URLへ含めない。
 */

export interface MediaUploadResult {
  /** Metaが取得できる公開HTTPS URL */
  url: string;
}

export interface MediaStoragePort {
  /** 監査・DB記録に使うprovider名(例: "vercel-blob") */
  readonly provider: string;
  /** 設定済みか(トークン等)。falseなら外部通信前に停止する */
  isConfigured(): boolean;
  /** 未設定時に代表者へ示す日本語の理由・設定方法 */
  configurationHelp(): string;
  /** keyへdataを公開アップロードし、公開URLを返す。冪等(同一keyへの再PUTは同一内容で上書き) */
  upload(key: string, data: Buffer, contentType: string): Promise<MediaUploadResult>;
}

/** 公開URLとして安全か検証する。HTTPSのみ・localhost/プライベート不可・危険スキーム不可 */
export function assertSafePublicMediaUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`公開URLとして不正です(URL解釈不可): ${value.slice(0, 80)}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`公開URLはHTTPSである必要があります(${url.protocol}//は使用できません)`);
  }
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host) || host.endsWith(".local")) {
    throw new Error("公開URLにローカルホストは使用できません(Metaが取得できません)");
  }
  // トークン・秘密情報がURLへ混入していないこと(クエリ・フラグメント検査)
  const suspect = /(access_token|token|secret|authorization|signature|sig|key)=/i;
  if (suspect.test(url.search) || suspect.test(url.hash)) {
    throw new Error("公開URLにトークンらしきパラメータが含まれています。秘密情報を含まないURLだけを使用してください");
  }
}
