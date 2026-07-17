/**
 * ローカル単一ユーザーMVPのowner操作ガード。
 * 認証基盤を持たないV4では、同一OriginのUIが明示ヘッダーを付けた操作だけを受理する。
 * 外部サイトのform POSTや、owner確認なしの単純なHTTP呼び出しを拒否する。
 * V5.4: クラウド実行(Vercel等)では、owner認証が未確定の間すべての変更操作をfail closedで拒否する。
 */
import { cloudMutationBlockedReason } from "@core/runtime";

export const OWNER_ACTION_HEADER = "x-bloom-owner-action";
export const OWNER_ACTION_VALUE = "confirmed-in-ui";

export function assertOwnerRequest(req: Request, env: Record<string, string | undefined> = process.env): void {
  // クラウド実行の認証未設定はヘッダー検査より先に拒否する(ローカル既定では何も変えない)
  const cloudBlocked = cloudMutationBlockedReason(env);
  if (cloudBlocked) throw new Error(cloudBlocked);
  if (req.headers.get(OWNER_ACTION_HEADER) !== OWNER_ACTION_VALUE) {
    throw new Error("代表者画面からの確認済み操作ではありません");
  }
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) throw new Error("操作元を確認できません");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("操作元が不正です");
  }
  if (originHost !== host) throw new Error("別Originからの代表者操作は拒否されました");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new Error("別サイトからの代表者操作は拒否されました");
}
