/** テスト共有フィクスチャ(架空データのみ) */

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
