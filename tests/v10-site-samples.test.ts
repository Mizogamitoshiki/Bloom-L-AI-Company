/**
 * V10 サイトサンプル(docs/32)のテスト。
 * - 通常コードの検査(外部URL/JS/実在情報/価格/素材参照、価格帯ガード)は純粋関数として検証
 * - intake(owner専用・権利宣言必須)→ ビルド(書き出し・Playwright撮影・hash刻印)→ 紬QA → tpl-sample投稿のレンダリングまでを実DBで通す
 * 素材・撮影画像は全て架空(sharpで生成)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDb, type OpenedDb } from "@adapters/db/client";
import { ensureSeedOrg, createTask, startTask, submitArtifact, createPost } from "@adapters/db/store";
import {
  createSampleRequest, addSampleAsset, listSampleRequestsForAi, recordSampleDesignQa, getSiteSample, siteSamplesBuiltToday, declineSampleRequest,
} from "@adapters/db/samples";
import { buildSiteSample, decorateSampleHtml, SampleBuildError } from "@adapters/samples/build";
import { renderPost, RightsError } from "@adapters/render/render-post";
import { sampleInputDir } from "@adapters/render/sample-media";
import { findSampleIntegrityViolations, findPriceViolations } from "@core/sample-guards";
import { siteSampleArtifactSchema, sampleCopyArtifactSchema, visualQaArtifactSchema, type Pricing } from "@core/schemas";
import { loadPricing } from "@adapters/config";
import { PLAN } from "./fixtures";

const DATE = "2026-08-27";

const PRICING: Pricing = {
  approved_on: "2026-08-28",
  approved_public_price_bands: {
    ume: { label: "梅プラン", build: "45,000円〜 +tax", maintenance: "月7,000円〜 +tax" },
    take: { label: "竹プラン", build: "120,000円〜 +tax", maintenance: "月12,000円〜 +tax" },
    matsu: { label: "松プラン", build: "500,000円〜 +tax", maintenance: "応相談" },
  },
  disclaimer: "価格は税別(+tax)の目安です。",
};

const CLEAN_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>泉州ワークス(サンプル)</title></head>
<body><header class="hero"><img src="./assets/hero.png" alt=""><h1>泉州ワークス(サンプル)</h1><p>紙の見積もりを、その日のうちに。</p></header>
<section class="cards"><article><h2>施工の流れ</h2><p>ヒアリング→現地確認→お見積もり→施工</p></article><article><h2>会社概要</h2><p>〒000-0000 大阪府泉州市サンプル1-2-3 / TEL 000-0000-0000 / info@example.com</p></article></section>
</body></html>`;
const CLEAN_CSS = `body{margin:0;font-family:sans-serif;color:#1b2a4a;background:#fbfbf8}.hero{padding:48px 24px;background:#1f2a44;color:#fff}.hero img{width:100%;max-width:640px;display:block;border-radius:16px}.cards{display:grid;gap:16px;padding:24px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}article{background:#fff;border:1px solid #dfe3ea;border-radius:16px;padding:20px}@media (max-width:600px){.hero{padding:24px 16px}}`;

function sampleArtifact(requestId: string, overrides: Partial<{ html: string; css: string; assetsUsed: string[] }> = {}) {
  return siteSampleArtifactSchema.parse({
    kind: "site_sample",
    requestId,
    siteTitle: "泉州ワークス(サンプル)",
    concept: "紙の見積もり中心の工務店が、初めての人に会社を見せるための1ページ",
    pages: [{ path: "index.html", title: "泉州ワークス(サンプル)", html: overrides.html ?? CLEAN_HTML }],
    css: overrides.css ?? CLEAN_CSS,
    assetsUsed: overrides.assetsUsed ?? ["hero.png"],
    planFit: "ume",
    planFitReason: "TOP1ページ+問い合わせ導線で梅の標準構成に収まる",
    notes: [],
  });
}

const SAMPLE_COPY = sampleCopyArtifactSchema.parse({
  kind: "sample_copy",
  headline: "紙の見積もりだけの工務店が、HPを持ったら(サンプル)",
  body: "架空の工務店を想定して、デザイン画像からサンプルサイトを組みました。初めての人に会社が見える状態を、1ページで作っています。\n梅プラン(45,000円〜 +tax)の範囲で制作できる構成です。価格は税別(+tax)の目安で、内容により個別にお見積もりします。\n※架空のサンプルです。実在の事業者・実績ではありません。",
  cta: "同じ業種のサンプルを見たい方は、DMで「サンプル」と送ってください。",
  hashtags: ["#泉州", "#岸和田", "#工務店", "#ホームページ制作", "#サンプル"],
  slides: {
    cover: { title: "紙の見積もりだけの工務店が、HPを持ったら", subtitle: "架空の工務店を想定したサンプル" },
    scene: { heading: "紹介頼みで、初めての人に会社が見えない", body: "相見積もりの相手に「どんな会社か」を伝える手段が名刺と口頭だけ、という場面を想定しました。" },
    screens: [{ caption: "スマホでは施工の流れと連絡先を最初に" }, { caption: "PCでは会社の雰囲気を一覧で" }],
    behind: { heading: "1ページに絞って、迷わせない", body: "ページを増やさず、TOP1枚で「何をしている会社か・どう頼むか」が終わる構成にしました。" },
    plan: { planId: "ume", note: "TOP1ページ+問い合わせ導線で、梅プランの標準構成に収まります。" },
    ctaMessage: "同じ業種でサンプルを見たい方は、\nDMで「サンプル」と送ってください。",
  },
});

const PASS_QA = visualQaArtifactSchema.parse({
  kind: "visual_qa", result: "pass", fidelity: "high", criticalIssues: [], minorIssues: [], revisionInstructions: [],
  pageFindings: [{ page: 1, severity: "minor", finding: "テスト設定(目視相当)" }],
});

async function writePng(file: string, w: number, h: number): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: "#c9a24b" } }).png().toFile(file);
}

describe("V10 通常コードの検査(純粋関数)", () => {
  it("クリーンなサンプルは違反なし", () => {
    expect(findSampleIntegrityViolations(sampleArtifact("r1"), ["hero.png"], [])).toEqual([]);
  });

  it("外部URL・script・イベント属性・iframe・実在し得る電話/メール/郵便番号・価格・未宣言素材・参考画像を検出する", () => {
    const bad = sampleArtifact("r1", {
      html: CLEAN_HTML
        .replace("</head>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto"><script src="./a.js"></script></head>')
        .replace("<body>", '<body onload="x()"><iframe src="//example.org"></iframe>')
        .replace("000-0000-0000", "072-123-4567")
        .replace("info@example.com", "info@real-company.co.jp")
        .replace("〒000-0000", "〒596-0001")
        .replace("会社概要", "会社概要 制作費45,000円")
        .replace('src="./assets/hero.png"', 'src="./assets/ref.png"'),
    });
    const codes = findSampleIntegrityViolations(bad, ["hero.png"], ["ref.png"]).map((v) => v.code);
    for (const c of ["external_url", "script", "event_handler", "iframe", "phone", "email", "postal", "price", "reference_asset_used"]) {
      expect(codes, c).toContain(c);
    }
    expect(findSampleIntegrityViolations(sampleArtifact("r1", { assetsUsed: ["missing.png"] }), ["hero.png"]).map((v) => v.code)).toContain("asset_not_attested");
    expect(findSampleIntegrityViolations(sampleArtifact("r1", { html: CLEAN_HTML.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', "") }), ["hero.png"]).map((v) => v.code)).toContain("missing_viewport");
  });

  it("価格帯ガード: 承認済み表記だけを許し、それ以外の円表記を拒否する", () => {
    expect(findPriceViolations("梅プランは45,000円〜 +tax(保守は月7,000円〜 +tax)。松は500,000円〜 +tax・応相談。", PRICING)).toEqual([]);
    expect(findPriceViolations("制作費45,000円で作れます", PRICING)).toEqual(["45,000円"]);
    expect(findPriceViolations("梅プランは45,000円〜(税込)", PRICING)).toEqual(["45,000円"]); // +tax抜きは不可(2026-08-28)
    expect(findPriceViolations("4.5万円〜 / ¥120,000 / 納期は3万円分の作業", PRICING).length).toBe(3);
    expect(findPriceViolations("価格の話はしません。無料相談へ。", PRICING)).toEqual([]);
  });

  it("config/pricing.yaml は承認済み価格帯(税別+tax表記・2026-08-28)と一致する", () => {
    const p = loadPricing();
    expect(p.approved_public_price_bands.ume.build).toBe("45,000円〜 +tax");
    expect(p.approved_public_price_bands.take.build).toBe("120,000円〜 +tax");
    expect(p.approved_public_price_bands.matsu.maintenance).toBe("応相談");
  });

  it("decorateSampleHtml は robots noindex・style.css参照・サンプル帯を注入する(重複注入しない)", () => {
    const once = decorateSampleHtml(CLEAN_HTML);
    expect(once).toContain('name="robots" content="noindex,nofollow"');
    expect(once).toContain('href="./style.css"');
    expect(once).toContain("bl-sample-notice");
    expect(decorateSampleHtml(once)).toBe(once);
  });
});

describe("V10 intake → ビルド(撮影) → 紬QA → tpl-sample投稿", () => {
  let dir: string;
  let opened: OpenedDb;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "bloom-v10-"));
    prevWorkspace = process.env.BLOOM_WORKSPACE_PATH;
    process.env.BLOOM_WORKSPACE_PATH = path.join(dir, "workspace");
    mkdirSync(process.env.BLOOM_WORKSPACE_PATH, { recursive: true });
    opened = openDb(path.join(dir, "test.db"));
    ensureSeedOrg(opened.db);
  });

  afterEach(() => {
    opened.sqlite.close();
    if (prevWorkspace === undefined) delete process.env.BLOOM_WORKSPACE_PATH;
    else process.env.BLOOM_WORKSPACE_PATH = prevWorkspace;
    rmSync(dir, { recursive: true, force: true });
  });

  const BRIEF = { slug: "senshu-works", industry: "工務店", persona: "P1", planTarget: "ume", pages: ["TOP"], brief: "紙の見積もり中心の工務店", attest: true };

  it("intakeはowner専用で、権利宣言(attest:true)が無いと登録できない", () => {
    expect(() => createSampleRequest(opened.db, BRIEF, "aoi")).toThrow(/owner/);
    expect(() => createSampleRequest(opened.db, { ...BRIEF, attest: false }, "owner")).toThrow(/権利宣言/);
    const req = createSampleRequest(opened.db, BRIEF, "owner");
    expect(req.status).toBe("new");
    expect(() => createSampleRequest(opened.db, BRIEF, "owner")).toThrow(/既に使われています/);
  });

  it("颯のHTMLに外部URLがあるとビルドは拒否され、タスクは失敗として記録される", async () => {
    const req = createSampleRequest(opened.db, BRIEF, "owner");
    await writePng(path.join(sampleInputDir(req.id), "hero.png"), 640, 400);
    await addSampleAsset(opened.db, req.id, { fileName: "hero.png", kind: "hero" }, "owner");
    const task = createTask(opened.db, { type: "build_site", title: "サンプル制作", assigneeId: "emp_hayate", stepKey: `build-${req.id}`, priority: 5 }, DATE).task;
    startTask(opened.db, task.id, "hayate");
    const bad = sampleArtifact(req.id, { html: CLEAN_HTML.replace("</head>", '<script src="https://cdn.example.net/x.js"></script></head>') });
    await expect(buildSiteSample(opened.db, task.id, bad, "hayate")).rejects.toThrow(SampleBuildError);
    const row = opened.sqlite.prepare("select status, error from tasks where id = ?").get(task.id) as { status: string; error: string };
    expect(["queued", "failed"]).toContain(row.status);
    expect(row.error).toMatch(/external_url|外部URL/);
    expect(siteSamplesBuiltToday(opened.db)).toBe(0);
  });

  it("ビルド→撮影4枚→紬QA pass→tpl-sample投稿がレンダリングできる(価格帯は通常コードが注入)", async () => {
    const req = createSampleRequest(opened.db, BRIEF, "owner");
    await writePng(path.join(sampleInputDir(req.id), "hero.png"), 640, 400);
    await writePng(path.join(sampleInputDir(req.id), "ref.png"), 800, 600);
    await addSampleAsset(opened.db, req.id, { fileName: "hero.png", kind: "hero" }, "owner");
    await addSampleAsset(opened.db, req.id, { fileName: "ref.png", kind: "reference" }, "owner");
    const ai = listSampleRequestsForAi(opened.db, "new");
    expect(ai).toHaveLength(1);
    expect(ai[0]!.assets.find((a) => a.fileName === "ref.png")?.usableInScreen).toBe(false);

    const task = createTask(opened.db, { type: "build_site", title: "サンプル制作", assigneeId: "emp_hayate", stepKey: `build-${req.id}`, priority: 5 }, DATE).task;
    startTask(opened.db, task.id, "hayate");
    const built = await buildSiteSample(opened.db, task.id, sampleArtifact(req.id), "hayate");
    expect(built.version).toBe(1);
    expect(built.screenshots.map((s) => s.name).sort()).toEqual(["pc-fold", "pc-full", "sp-fold", "sp-full"]);
    for (const s of built.screenshots) {
      expect(existsSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, s.safeRelativePath))).toBe(true);
      expect(s.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const pc = built.screenshots.find((s) => s.name === "pc-fold")!;
    const sp = built.screenshots.find((s) => s.name === "sp-fold")!;
    expect([pc.width, pc.height]).toEqual([1440, 900]);
    expect([sp.width, sp.height]).toEqual([780, 1688]);
    const indexHtml = readFileSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, built.dirPath, "index.html"), "utf8");
    expect(indexHtml).toContain("noindex");
    expect(indexHtml).toContain("bl-sample-notice");
    expect(siteSamplesBuiltToday(opened.db)).toBe(1);
    expect(getSiteSample(opened.db, built.sampleId).designQaResult).toBeNull();

    // QA未合格のサンプルは投稿に使えない
    expect(() => createPost(opened.db, { pillar: "5", format: "carousel", title: "サンプル投稿", templateId: "tpl-sample", sampleId: built.sampleId }, "aoi")).toThrow(/視覚QA/);
    expect(() => recordSampleDesignQa(opened.db, built.sampleId, PASS_QA, "shion")).toThrow(/tsumugi/);
    expect(() => recordSampleDesignQa(opened.db, built.sampleId, { ...PASS_QA, fidelity: "low" }, "tsumugi")).toThrow(/忠実度low/);
    startTask(opened.db, built.designQaTaskId, "tsumugi");
    recordSampleDesignQa(opened.db, built.sampleId, PASS_QA, "tsumugi");
    submitArtifact(opened.db, built.designQaTaskId, PASS_QA, "tsumugi");
    expect(listSampleRequestsForAi(opened.db, "ready")).toHaveLength(1);

    // 1日1本の上限
    const task2 = createTask(opened.db, { type: "build_site", title: "サンプル制作2", assigneeId: "emp_hayate", stepKey: `build2-${req.id}`, priority: 5 }, DATE).task;
    startTask(opened.db, task2.id, "hayate");
    await expect(buildSiteSample(opened.db, task2.id, sampleArtifact(req.id), "hayate")).rejects.toThrow(/上限/);

    // 投稿: sampleIdはtpl-sample以外では拒否
    expect(() => createPost(opened.db, { pillar: "5", format: "carousel", title: "x", templateId: "tpl-howto", sampleId: built.sampleId }, "aoi")).toThrow(/tpl-sample/);
    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "サンプル投稿", templateId: "tpl-sample", sampleId: built.sampleId }, "aoi");
    const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
    startTask(opened.db, planTask.id, "sora");
    submitArtifact(opened.db, planTask.id, { ...PLAN, pillar: "5" }, "sora");
    const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
    startTask(opened.db, copyTask.id, "kotoha");
    submitArtifact(opened.db, copyTask.id, SAMPLE_COPY, "kotoha");

    const imgDir = path.join(dir, "img");
    const result = await renderPost(opened.db, post.id, "system", { outDirBase: imgDir });
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.pageCount).toBe(7);
    const meta = await sharp(result.files[0]!).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    const specRow = opened.sqlite.prepare("select content_json from artifacts where post_id = ? and kind = 'carousel_spec' order by created_at desc limit 1").get(post.id) as { content_json: string };
    const spec = JSON.parse(specRow.content_json) as { templateId: string; priceBand: { build: string; label: string }; screenshots: { pcFold: { sha256: string } } };
    expect(spec.templateId).toBe("tpl-sample");
    expect(spec.priceBand.build).toBe("45,000円〜 +tax");
    expect(spec.screenshots.pcFold.sha256).toBe(pc.sha256);
    const render = opened.sqlite.prepare("select design_qa_result from post_renders where post_id = ? order by created_at desc limit 1").get(post.id) as { design_qa_result: string };
    expect(render.design_qa_result).toBe("pass");
  }, 180_000);

  it("見送りはowner専用・理由必須", () => {
    const req = createSampleRequest(opened.db, BRIEF, "owner");
    expect(() => declineSampleRequest(opened.db, req.id, "x", "aoi")).toThrow(/owner/);
    expect(() => declineSampleRequest(opened.db, req.id, "  ", "owner")).toThrow(/理由/);
    declineSampleRequest(opened.db, req.id, "素材が揃わない", "owner");
    expect(listSampleRequestsForAi(opened.db, "declined")).toHaveLength(1);
  });

  it("QA未合格のサンプルはレンダリング前に拒否される(RightsError)", async () => {
    const req = createSampleRequest(opened.db, BRIEF, "owner");
    await writePng(path.join(sampleInputDir(req.id), "hero.png"), 640, 400);
    await addSampleAsset(opened.db, req.id, { fileName: "hero.png", kind: "hero" }, "owner");
    const task = createTask(opened.db, { type: "build_site", title: "サンプル制作", assigneeId: "emp_hayate", stepKey: `build-${req.id}`, priority: 5 }, DATE).task;
    startTask(opened.db, task.id, "hayate");
    const built = await buildSiteSample(opened.db, task.id, sampleArtifact(req.id), "hayate");
    // 紬QAをpassにして投稿を作った後、QAをfailに更新した場合(状態変化)はレンダリングを拒否する
    recordSampleDesignQa(opened.db, built.sampleId, PASS_QA, "tsumugi");
    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "サンプル投稿", templateId: "tpl-sample", sampleId: built.sampleId }, "aoi");
    recordSampleDesignQa(opened.db, built.sampleId, { ...PASS_QA, result: "fail", fidelity: "low", criticalIssues: ["配色が違う"], revisionInstructions: ["配色を直す"] }, "tsumugi");
    const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
    startTask(opened.db, planTask.id, "sora");
    submitArtifact(opened.db, planTask.id, { ...PLAN, pillar: "5" }, "sora");
    const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
    startTask(opened.db, copyTask.id, "kotoha");
    submitArtifact(opened.db, copyTask.id, SAMPLE_COPY, "kotoha");
    await expect(renderPost(opened.db, post.id, "system", { outDirBase: path.join(dir, "img") })).rejects.toThrow(RightsError);
  }, 180_000);
});
