/** テンプレート共通の決定的ヘルパー(通常コード・AI不使用)。 */
import type { CarouselSpec } from "../schemas";

type Pillar = CarouselSpec["pillar"];

export const PILLAR_LABEL: Record<Pillar, string> = {
  "1": "IT・AIニュース",
  "2": "HPの役割",
  "3": "HPで変わる",
  "4": "Web・ITの気になる話",
  "5": "制作実績",
  "6": "泉州の事業者さまへ",
};

/** ヘッダー右のkicker(系統/柱ラベル) */
export function pillarKicker(pillar: Pillar): string {
  return PILLAR_LABEL[pillar];
}

/** CTAの行動喚起(内容に応じて決定的に選ぶ。毎回同じにしない) */
export function ctaHint(pillar: Pillar): { badge: string; sub: string } {
  // 実績・HP変化=DM相談、ニュース=プロフィール確認、それ以外=保存
  if (pillar === "5" || pillar === "3") return { badge: "DMで相談", sub: "「相談」とメッセージしてください" };
  if (pillar === "1" || pillar === "4") return { badge: "プロフィールへ", sub: "リンクから詳しく見られます" };
  return { badge: "保存する", sub: "あとで見返せます" };
}
