/**
 * APIエラーを代表者向けの日本語メッセージへ変換する(V3-J)。
 * Zodの生JSONエラーを利用者画面へそのまま出さない。
 */
export function toFriendlyMessage(err: unknown): string {
  if (err instanceof Error) {
    // Zodエラー(検証失敗)は配列JSONがmessageに入る
    if (err.name === "ZodError" || err.message.trimStart().startsWith("[")) {
      return "投稿データの形式が不正です(旧形式の可能性)。「pnpm company doctor」で確認し、必要なら再レンダリング(pnpm company render --post <投稿ID>)してください";
    }
    return err.message;
  }
  return "不明なエラーが発生しました";
}
