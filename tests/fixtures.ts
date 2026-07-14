/** テスト共有フィクスチャ(架空データのみ) */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "@adapters/root";

/**
 * 実在する許可証跡ファイル(P1-3: evidencePathは実在ファイルのみ受け付けるため)。
 * data/workspace/07_customer-permissions/ 配下(gitignore)にテスト用1byteファイルを作り、論理パスを返す。
 */
export function ensureEvidenceFile(name = "_test-evidence.png"): string {
  const dir = path.join(findRepoRoot(), "data", "workspace", "07_customer-permissions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), "x");
  return `07_customer-permissions/${name}`;
}

export const PLAN = {
  kind: "post_plan",
  theme: "HPがない事業者の見せ方",
  pillar: "6",
  format: "carousel",
  target: "泉州地域のHP未保有の個人事業主",
  outline: ["現状の課題", "できること3つ", "まとめ"],
  ctaIdea: "DMで相談",
  sourceIds: [],
};

export const COPY = {
  kind: "copy",
  headline: "HPがなくても、まず「見せ方」から",
  body: "泉州地域でHPをまだ持っていない事業者さま向けに、今すぐできる情報発信の整え方を3つにまとめました。保存して見返してください。",
  cta: "気になった方はDMで「相談」とお送りください",
  hashtags: ["#泉州", "#岸和田", "#ホームページ制作", "#個人事業主", "#集客"],
  slides: {
    cover: { title: "HPがなくても始める見せ方", subtitle: "泉州の事業者さま向け・保存版" },
    pages: [
      { heading: "課題を知る", body: "検索しても情報が出てこないと、お客様は不安になります。" },
      { heading: "できること", body: "営業時間・場所・実績を、まず1か所に整理しましょう。" },
      { heading: "次の一歩", body: "反応が出てきたら、HPで信頼をさらに積み上げます。" },
    ],
    ctaMessage: "続きはDMでご相談ください",
  },
};

export const QA_PASS = {
  kind: "qa_report",
  result: "pass",
  checklist: [
    { item: "誤字脱字", ok: true },
    { item: "禁止表現(効果保証・価格)", ok: true },
    { item: "文字数・文字切れ検査結果", ok: true },
  ],
  issues: [],
};

export const NEWS_COPY = {
  kind: "news_copy",
  headline: "検索のしかたが変わり始めています",
  body: "検索サービスにAIが組み込まれ、調べ方が少しずつ変わってきています。泉州の事業者さまにとっても、自社の情報を「見つけてもらえる形」で整えておく大切さが増しています。詳しくはスライドをご覧ください。",
  cta: "自社への影響が気になる方はDMでご相談ください",
  hashtags: ["#泉州", "#岸和田", "#AI", "#ホームページ制作", "#ITニュース"],
  slides: {
    cover: { title: "検索が変わる、\n届け方も変わる", subtitle: "AI時代の「見つけてもらう」準備" },
    facts: [
      { text: "大手検索サービスにAIによる回答表示が組み込まれ始めています。" },
      { text: "利用者は検索結果を開く前に、要約された答えを目にする機会が増えています。" },
    ],
    opinion: { heading: "Bloom-Lの見解", body: "情報を構造的に整えたHPほどAIにも人にも伝わりやすい、というのが私たちの見方です。" },
    impact: { heading: "事業者への影響", body: "営業時間・サービス内容・実績を整理して掲載しておくことが、これまで以上に大切になりそうです。" },
    ctaMessage: "自社の場合はどうなる?と思ったらDMへ",
  },
};

export const PORTFOLIO_COPY = {
  kind: "portfolio_copy",
  headline: "実績紹介: 予約の取りこぼしを減らしたHP",
  body: "泉州地域の事業者さまのHP制作事例をご紹介します。課題の整理から公開までの工夫をスライドにまとめました。同じお悩みがあればDMでご相談ください。",
  cta: "同じお悩みはDMで「相談」とお送りください",
  hashtags: ["#泉州", "#制作実績", "#ホームページ制作", "#個人事業主", "#岸和田"],
  slides: {
    cover: { title: "予約の取りこぼしを\n減らしたHP", subtitle: "制作実績のご紹介" },
    challenge: { heading: "課題", body: "電話でしか予約を受け付けられず、営業時間外の予約希望を取りこぼしていました。" },
    approach: { heading: "対応", body: "スマホで見やすいHPに、24時間受け付けられる問い合わせフォームを設置しました。" },
    result: { heading: "成果", body: "営業時間外でも予約希望が形に残るようになり、折り返し対応が楽になりました。" },
    tech: { items: ["Next.js", "問い合わせフォーム", "スマホ対応"] },
    ctaMessage: "同じお悩みはDMでご相談ください",
  },
};

export const SOURCE_A = {
  title: "大手検索サービスがAI回答表示を拡大",
  url: "https://example.com/news/ai-search-2026",
  publisher: "架空ITニュース",
  publishedAt: "2026-07-10",
  factOrInference: "fact",
  reliability: "medium",
  isPrimary: false,
  summary: "検索結果にAI要約が表示される範囲が拡大された(架空のテスト用データ)",
  fetched: true,
} as const;
