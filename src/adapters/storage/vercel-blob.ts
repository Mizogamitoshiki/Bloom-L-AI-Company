/**
 * V5.2 Vercel Blob adapter(MediaStoragePortの実装)。
 * SDKを追加せず、Vercel BlobのREST API(PUT https://blob.vercel-storage.com/<pathname>)を直接使う。
 * - トークン(BLOB_READ_WRITE_TOKEN)は環境変数からだけ読み、戻り値・ログ・エラー文へ出さない
 * - access=public・同一pathnameへの再PUTは上書き(content-addressedキーと組み合わせて冪等)
 * - fetchは注入可能(テストでは実通信しない)
 */
import { assertSafePublicMediaUrl, type MediaStoragePort, type MediaUploadResult } from "./media-storage";

const BLOB_API_BASE = "https://blob.vercel-storage.com";
const BLOB_API_VERSION = "7";

type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class VercelBlobStorage implements MediaStoragePort {
  readonly provider = "vercel-blob";
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike) {
    this.token = env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
    this.fetchImpl = fetchImpl ?? (fetch as unknown as FetchLike);
  }

  isConfigured(): boolean {
    return this.token.length > 0;
  }

  configurationHelp(): string {
    return [
      "Vercel Blobのトークンが未設定のため、公開画像のアップロードを開始できません(外部通信は行っていません)。",
      "設定方法: Vercelダッシュボード → Storage → Blob でストアを作成し、Read/Writeトークンを発行して",
      "ローカルの .env に BLOB_READ_WRITE_TOKEN=<トークン> を追記してください(.envはgitignore済み。コミット禁止)。",
    ].join(" ");
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<MediaUploadResult> {
    if (!this.isConfigured()) {
      // 外部通信前に停止(絶対条件)
      throw new Error(this.configurationHelp());
    }
    if (!/^[\w\-/.]+$/.test(key) || key.includes("..")) {
      throw new Error(`アップロードキーが不正です: ${key.slice(0, 80)}`);
    }
    const response = await this.fetchImpl(`${BLOB_API_BASE}/${key}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.token}`,
        "x-api-version": BLOB_API_VERSION,
        "x-content-type": contentType,
        // 同一pathnameへの再実行を冪等にする(ランダムsuffixを付けない・上書き許可)
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-cache-control-max-age": "31536000",
      },
      body: new Uint8Array(data),
    });
    if (!response.ok) {
      // レスポンス本文は秘密情報を含む可能性があるため保存・表示しない
      throw new Error(`Vercel Blobへのアップロードに失敗しました(HTTP ${response.status})。トークンの有効性とストア設定を確認してください`);
    }
    const body = (await response.json()) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url : "";
    assertSafePublicMediaUrl(url);
    return { url };
  }
}
