/**
 * variant差分の構造判定(V4.5 v3)。通常コード・純関数。
 * 承認候補の2variantは、01〜05ページのうち最低3ページで「layoutId が異なり かつ 画像ハッシュも異なる」必要がある。
 * - 表紙だけ違い本文が同一 → 失敗(差分1)
 * - 01〜05が画像ハッシュ上すべて同一 → 失敗(差分0)
 * - 同一レンダリングをlayoutId名だけ変えて回避 → hashが同一のためカウントされず失敗
 * CTA(最終ページ=index5)は family 内で共通でよい(判定対象外)。
 */
export interface VariantPages {
  layoutIds: string[];
  pageHashes: string[];
}

export const MIN_DISTINCT_INTERIOR_PAGES = 3;
const COMPARED_RANGE = 5; // 01〜05(index 0..4)

/** 01〜05のうち「layoutIdが異なり かつ 画像ハッシュも異なる」ページ数 */
export function distinctInteriorPageCount(a: VariantPages, b: VariantPages): number {
  let n = 0;
  for (let i = 0; i < COMPARED_RANGE; i++) {
    const idA = a.layoutIds[i];
    const idB = b.layoutIds[i];
    const hA = a.pageHashes[i];
    const hB = b.pageHashes[i];
    if (idA !== undefined && idB !== undefined && hA !== undefined && hB !== undefined && idA !== idB && hA !== hB) n++;
  }
  return n;
}

export function variantsSufficientlyDistinct(a: VariantPages, b: VariantPages, min = MIN_DISTINCT_INTERIOR_PAGES): boolean {
  return distinctInteriorPageCount(a, b) >= min;
}
