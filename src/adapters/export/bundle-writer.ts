/**
 * export_bundle のファイル生成(V4-B)。DB非依存の純粋なファイルI/O。
 * 呼び出し側(store.exportPost)が一時ディレクトリへ書き、成功後に atomic rename する。
 * 秘密情報・許可範囲外の顧客情報は含めない(呼び出し側が権利検査済みの値のみ渡す)。
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

export const BUNDLE_SCHEMA_VERSION = "export-v1";

export interface BundleCaption {
  headline: string;
  body: string;
  cta: string;
  hashtags: string[];
}

export interface BundleSourceRef {
  publisher: string;
  title: string;
  publishedAt: string;
}

export interface BundleData {
  postId: string;
  title: string;
  templateId: string;
  pillar: string;
  /** レンダリング済みPNGの絶対パス(投稿順) */
  imageFilePaths: string[];
  caption: BundleCaption;
  sources: BundleSourceRef[];
  rightsState: string;
  exportedAt: string; // ISO
  businessDate: string; // YYYY-MM-DD(Asia/Tokyo)
}

function captionText(c: BundleCaption): string {
  return [c.headline, "", c.body, "", c.cta, "", c.hashtags.join(" "), ""].join("\n");
}

function checklistMd(data: BundleData, imageNames: string[]): string {
  return `# 手動投稿チェックリスト — ${data.title}

対象: Instagram(フィード / カルーセル)。**投稿は代表者が手動で行います。AIは自動投稿しません。**

## 1. 画像の準備
- このフォルダの画像を順番どおりに使用してください: ${imageNames.join(" → ")}
- 画像はスマートフォンへ転送(AirDrop / 共有フォルダ)、または Meta Business Suite にアップロード

## 2. キャプション
- \`caption.txt\` の内容(見出し・本文・CTA・ハッシュタグ)をコピーして貼り付け

## 3. 投稿設定
- [ ] 画像の順番が 01 → 02 → ... の順になっているか
- [ ] 位置情報(泉州地域)を設定するか確認
- [ ] タグ付け(必要なら)
- [ ] 誤字・改行の最終確認(公開後の修正は手間がかかります)

## 4. 公開
- Instagramアプリ、または Meta Business Suite の公式予約機能(利用可能なアカウント種別のみ)で公開

## 5. 投稿後の記録
- ダッシュボードの投稿パイプラインで「投稿済みにする」を実行
  - これにより 3日後・7日後の実績値入力タスクが自動作成されます
- 3日後・7日後に Instagram インサイトから reach / 保存 / プロフィール閲覧 / DM開始 などを入力してください

---
権利状態: ${data.rightsState} / 書き出し日時: ${data.exportedAt}
`;
}

function metaJson(data: BundleData, imageNames: string[]): string {
  return JSON.stringify(
    {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      postId: data.postId,
      title: data.title,
      templateId: data.templateId,
      pillar: data.pillar,
      exportedAt: data.exportedAt,
      businessDate: data.businessDate,
      images: imageNames,
      rightsState: data.rightsState,
      // source は公開に出す出典情報のみ(URL本文や秘密情報は含めない)
      sources: data.sources.map((s) => ({ publisher: s.publisher, title: s.title, publishedAt: s.publishedAt })),
    },
    null,
    2,
  );
}

/** ディレクトリへ bundle 一式を書き込み、生成した相対ファイル名一覧を返す */
export function writeBundleToDir(dir: string, data: BundleData): string[] {
  mkdirSync(dir, { recursive: true });
  const imageNames: string[] = [];
  data.imageFilePaths.forEach((src, i) => {
    const name = `${String(i + 1).padStart(2, "0")}.png`;
    copyFileSync(src, path.join(dir, name));
    imageNames.push(name);
  });
  writeFileSync(path.join(dir, "caption.txt"), captionText(data.caption));
  writeFileSync(path.join(dir, "checklist.md"), checklistMd(data, imageNames));
  writeFileSync(path.join(dir, "meta.json"), metaJson(data, imageNames));
  return [...imageNames, "caption.txt", "checklist.md", "meta.json"];
}
