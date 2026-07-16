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

export class MetaApiError extends Error {
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

  private async waitUntilReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const url = new URL(this.endpoint(containerId));
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", this.config.accessToken);
      const response = await this.fetchFn(url, { method: "GET" });
      const json: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw safeApiError(response.status, json);
      const status = (json as StatusResponse).status_code;
      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new MetaApiError(`CONTAINER_${status}`, `Instagramメディアコンテナが${status}になりました`);
      }
      await this.wait(1_000);
    }
    throw new MetaApiError("CONTAINER_TIMEOUT", "Instagramメディアコンテナの準備が時間内に完了しませんでした");
  }

  async publish(plan: InstagramPublishPlan): Promise<MetaPublishResult> {
    if (plan.mediaUrls.length < 1 || plan.mediaUrls.length > 10) {
      throw new Error("Instagram画像は1〜10枚で指定してください");
    }
    if (plan.caption.length > 2_200) throw new Error("Instagramキャプションは2,200文字以内にしてください");

    if (plan.kind === "image") {
      const containerId = await this.post(`${this.config.igUserId}/media`, {
        image_url: plan.mediaUrls[0]!, caption: plan.caption,
      });
      await this.waitUntilReady(containerId);
      const instagramMediaId = await this.post(`${this.config.igUserId}/media_publish`, { creation_id: containerId });
      return { childContainerIds: [], containerId, instagramMediaId };
    }

    const childContainerIds: string[] = [];
    for (const imageUrl of plan.mediaUrls) {
      const id = await this.post(`${this.config.igUserId}/media`, { image_url: imageUrl, is_carousel_item: "true" });
      await this.waitUntilReady(id);
      childContainerIds.push(id);
    }
    const containerId = await this.post(`${this.config.igUserId}/media`, {
      media_type: "CAROUSEL", children: childContainerIds.join(","), caption: plan.caption,
    });
    await this.waitUntilReady(containerId);
    const instagramMediaId = await this.post(`${this.config.igUserId}/media_publish`, { creation_id: containerId });
    return { childContainerIds, containerId, instagramMediaId };
  }
}
