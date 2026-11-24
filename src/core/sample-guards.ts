/**
 * V10 サイトサンプルの通常コード検査(docs/32 §6.1, §8)。AIの自己申告に依存しない。
 * - findSampleIntegrityViolations: 颯のHTML/CSSに外部リソース・JS・実在情報・価格・未許可素材が無いか
 * - findPriceViolations: 公開テキストの「円」表記が承認済み価格帯(config/pricing.yaml)だけか
 * どちらも純粋関数(I/Oなし)。ビルド時とQA時の両方で使う。
 */
import type { Pricing, SiteSampleArtifact } from "./schemas";

export interface SampleViolation {
  code:
    | "external_url"
    | "script"
    | "event_handler"
    | "iframe"
    | "data_uri"
    | "phone"
    | "email"
    | "postal"
    | "price"
    | "asset_not_attested"
    | "asset_not_declared"
    | "reference_asset_used"
    | "missing_viewport";
  detail: string;
}

/** 実在情報として扱わないプレースホルダー(数字が全て0のもの) */
const PLACEHOLDER_PHONE = /^0+(-0+)+$/;
const PLACEHOLDER_POSTAL = /^000-0000$/;
const ALLOWED_EMAIL_DOMAINS = new Set(["example.com", "example.jp", "example.net", "example.org"]);

const RE_EXTERNAL = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#][^\s"'<>)]*)?/gi;
const RE_SCRIPT = /<script[\s>]/i;
const RE_HANDLER = /\son[a-z]+\s*=/i;
const RE_IFRAME = /<(iframe|object|embed)[\s>]/i;
const RE_DATA_URI = /data:\s*(?!image\/svg\+xml)[a-z]+\/[a-z0-9.+-]+\s*;/i;
const RE_PHONE = /0\d{1,4}-\d{1,4}-\d{3,4}/g;
const RE_EMAIL = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi;
const RE_POSTAL = /〒\s*(\d{3}-\d{4})/g;
const RE_PRICE = /[0-9０-９][0-9０-９,，.]*\s*(?:万)?\s*円|[¥￥]\s*[0-9０-９][0-9０-９,，]*/g;
const RE_ASSET_REF = /(?:src|href)\s*=\s*["']\.\/assets\/([^"']+)["']/gi;
const RE_CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

function stripComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 颯のHTML/CSSを検査する。attestedAssets=権利宣言済み素材ファイル名、referenceAssets=参考画像(画面に出せない)。
 */
export function findSampleIntegrityViolations(
  sample: SiteSampleArtifact,
  attestedAssets: readonly string[],
  referenceAssets: readonly string[] = [],
): SampleViolation[] {
  const v: SampleViolation[] = [];
  const attested = new Set(attestedAssets);
  const reference = new Set(referenceAssets);
  const docs = [...sample.pages.map((p) => ({ name: p.path, text: stripComments(p.html), html: true })), { name: "style.css", text: stripComments(sample.css), html: false }];

  for (const doc of docs) {
    const text = doc.text;
    for (const m of text.matchAll(RE_EXTERNAL)) {
      // 自サイト内の相対パスは対象外。外部ドメインは全て禁止(CDN・Webフォント・iframe含む)
      v.push({ code: "external_url", detail: `${doc.name}: 外部URL「${m[0].slice(0, 80)}」` });
    }
    if (doc.html) {
      if (RE_SCRIPT.test(text)) v.push({ code: "script", detail: `${doc.name}: <script>は使用できません(静的HTML/CSSのみ)` });
      if (RE_HANDLER.test(text)) v.push({ code: "event_handler", detail: `${doc.name}: on〜=のイベント属性は使用できません` });
      if (RE_IFRAME.test(text)) v.push({ code: "iframe", detail: `${doc.name}: iframe/object/embedは使用できません` });
      if (!/<meta\s+[^>]*name\s*=\s*["']viewport["']/i.test(text)) v.push({ code: "missing_viewport", detail: `${doc.name}: viewport metaが必要です(スマホ対応)` });
    }
    if (RE_DATA_URI.test(text)) v.push({ code: "data_uri", detail: `${doc.name}: data:URI(画像の埋め込み)は使用できません。素材は./assets/から参照` });
    for (const m of text.matchAll(RE_PHONE)) {
      if (!PLACEHOLDER_PHONE.test(m[0])) v.push({ code: "phone", detail: `${doc.name}: 実在し得る電話番号「${m[0]}」(000-0000-0000形式のプレースホルダーのみ可)` });
    }
    for (const m of text.matchAll(RE_EMAIL)) {
      if (!ALLOWED_EMAIL_DOMAINS.has(m[1]!.toLowerCase())) v.push({ code: "email", detail: `${doc.name}: 実在し得るメール「${m[0]}」(example.comのみ可)` });
    }
    for (const m of text.matchAll(RE_POSTAL)) {
      if (!PLACEHOLDER_POSTAL.test(m[1]!)) v.push({ code: "postal", detail: `${doc.name}: 実在し得る郵便番号「〒${m[1]}」(〒000-0000のみ可)` });
    }
    for (const m of text.matchAll(RE_PRICE)) {
      v.push({ code: "price", detail: `${doc.name}: サンプル画面に価格「${m[0]}」は載せられません(料金は投稿側の承認済み価格帯のみ)` });
    }
    const refs = doc.html ? [...text.matchAll(RE_ASSET_REF)].map((m) => m[1]!) : [...text.matchAll(RE_CSS_URL)].map((m) => m[1]!.replace(/^\.\/assets\//, ""));
    for (const ref of refs) {
      const name = ref.split("?")[0]!.split("#")[0]!;
      if (reference.has(name)) v.push({ code: "reference_asset_used", detail: `${doc.name}: 参考画像「${name}」は画面に使用できません(雰囲気の参考専用)` });
      else if (!attested.has(name)) v.push({ code: "asset_not_attested", detail: `${doc.name}: 権利宣言のない素材「${name}」を参照しています` });
      else if (!sample.assetsUsed.includes(name)) v.push({ code: "asset_not_declared", detail: `${doc.name}: 素材「${name}」がassetsUsedに未申告です` });
    }
  }
  for (const used of sample.assetsUsed) {
    if (!attested.has(used)) v.push({ code: "asset_not_attested", detail: `assetsUsed: 権利宣言のない素材「${used}」` });
    if (reference.has(used)) v.push({ code: "reference_asset_used", detail: `assetsUsed: 参考画像「${used}」は使用できません` });
  }
  return v;
}

/** 承認済み価格帯トークン(build/maintenance)を列挙する */
export function approvedPriceTokens(pricing: Pricing): string[] {
  const bands = Object.values(pricing.approved_public_price_bands);
  return [...new Set(bands.flatMap((b) => [b.build, b.maintenance]).filter((s) => /[0-9０-９]/.test(s)))];
}

/**
 * 公開テキスト中の価格表記を検査する。承認済みトークン(例「45,000円〜 +tax」)を先に取り除き、
 * 残った「円」「¥」付き数字は全て違反(「〜」抜き・万円表記・値引き・納期の金額など)。
 */
export function findPriceViolations(text: string, pricing: Pricing): string[] {
  let stripped = text;
  for (const token of approvedPriceTokens(pricing)) stripped = stripped.split(token).join(" ");
  return [...stripped.matchAll(RE_PRICE)].map((m) => m[0]);
}
