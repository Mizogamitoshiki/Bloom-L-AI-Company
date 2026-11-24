import type { InstagramConfig } from "./config";

export interface InstagramPublishPlan {
  kind: "image" | "carousel";
  mediaUrls: string[];
  caption: string;
}

export interface MetaPublishResult {
  childContainerIds: string[];
  containerId: string;
  instagramMediaId: string;
}

/**
 * 公開処理のどの段階で失敗したか。
 * - prepare: コンテナ作成・準備待ち。media_publish未到達のため「Instagramには何も公開されていない」と断定できる
 * - publish: media_publish呼び出し中。公開されたか不明(要リコンサイル)
 */
export type MetaPublishPhase = "prepare" | "publish";

export class MetaApiError extends Error {
  public phase?: MetaPublishPhase;
  constructor(public readonly safeCode: string, message: string) {
    super(message);
    this.name = "MetaApiError";
  }
}

type FetchLike = typeof fetch;

interface GraphIdResponse { id?: string; error?: { message?: string; code?: number | string } }
interface StatusResponse { status_code?: string; error?: { message?: string; code?: number | string } }

function safeApiError(status: number, body: unknown): MetaApiError {
  const parsed = body as GraphIdResponse;
  const code = parsed?.error?.code ? String(parsed.error.code) : `HTTP_${status}`;
  const message = parsed?.error?.message?.slice(0, 300) || "Meta APIがリクエストを拒否しました";
  return new MetaApiError(code, `Meta APIエラー(${code}): ${message}`);
}

export class MetaInstagramClient {
  constructor(
    private readonly config: InstagramConfig,
    private readonly fetchFn: FetchLike = fetch,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private endpoint(path: string): string {
    return `${this.config.graphBaseUrl}/${this.config.apiVersion}/${path}`;
  }

  private async post(path: string, params: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({ ...params, access_token: this.config.accessToken });
    const response = await this.fetchFn(this.endpoint(path), { method: "POST", body });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw safeApiError(response.status, json);
    const id = (json as GraphIdResponse).id;
    if (!id) throw new MetaApiError("INVALID_RESPONSE", "Meta APIの応答にIDがありません");
    return id;
  }

  /**
   * コンテナ作成直後の状態照会は、Meta側の伝播遅延により一時的にエラーが返ることがある:
   * - 9007「Media ID is not available」(実運用2026-07-19に発生。準備完了前の照会で返る)
   * - 100「Unsupported get request」(作成直後のID未伝播)
   * これらは「まだ準備中」を意味するため失敗にせずポーリングを続行する(上限で打ち切り)。
   */
  private static readonly TRANSIENT_POLL_CODES = new Set(["9007", "100"]);

  private async waitUntilReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const url = new URL(this.endpoint(containerId));
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", this.config.accessToken);
      const response = await this.fetchFn(url, { method: "GET" });
      const json: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = safeApiError(response.status, json);
        if (MetaInstagramClient.TRANSIENT_POLL_CODES.has(error.safeCode)) {
          await this.wait(2_000);
          continue;
        }
        throw error;
      }
      const status = (json as StatusResponse).status_code;
      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new MetaApiError(`CONTAINER_${status}`, `Instagramメディアコンテナが${status}になりました`);
      }
      await this.wait(2_000);
    }
    throw new MetaApiError("CONTAINER_TIMEOUT", "Instagramメディアコンテナの準備が時間内に完了しませんでした");
  }

  /** 段階タグ付き実行。prepare段階の失敗は「未公開」と断定でき、呼び出し側が安全に再試行を許可できる */
  private async inPhase<T>(phase: MetaPublishPhase, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof MetaApiError) {
        error.phase ??= phase;
        throw error;
      }
      const wrapped = new MetaApiError(
        phase === "publish" ? "PUBLISH_UNKNOWN" : "PREPARE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
      wrapped.phase = phase;
      throw wrapped;
    }
  }

  async publish(plan: InstagramPublishPlan): Promise<MetaPublishResult> {
    if (plan.mediaUrls.length < 1 || plan.mediaUrls.length > 10) {
      throw new Error("Instagram画像は1〜10枚で指定してください");
    }
    if (plan.caption.length > 2_200) throw new Error("Instagramキャプションは2,200文字以内にしてください");

    if (plan.kind === "image") {
      const containerId = await this.inPhase("prepare", async () => {
        const id = await this.post(`${this.config.igUserId}/media`, {
          image_url: plan.mediaUrls[0]!, caption: plan.caption,
        });
        await this.waitUntilReady(id);
        return id;
      });
      const instagramMediaId = await this.inPhase("publish", () =>
        this.post(`${this.config.igUserId}/media_publish`, { creation_id: containerId }));
      return { childContainerIds: [], containerId, instagramMediaId };
    }

    const { childContainerIds, containerId } = await this.inPhase("prepare", async () => {
      const children: string[] = [];
      for (const imageUrl of plan.mediaUrls) {
        const id = await this.post(`${this.config.igUserId}/media`, { image_url: imageUrl, is_carousel_item: "true" });
        await this.waitUntilReady(id);
        children.push(id);
      }
      const carouselId = await this.post(`${this.config.igUserId}/media`, {
        media_type: "CAROUSEL", children: children.join(","), caption: plan.caption,
      });
      await this.waitUntilReady(carouselId);
      return { childContainerIds: children, containerId: carouselId };
    });
    const instagramMediaId = await this.inPhase("publish", () =>
      this.post(`${this.config.igUserId}/media_publish`, { creation_id: containerId }));
    return { childContainerIds, containerId, instagramMediaId };
  }
}
