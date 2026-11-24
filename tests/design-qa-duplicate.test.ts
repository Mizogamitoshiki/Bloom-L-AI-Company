/**
 * design QAのページ重複検出(改善#5)。
 * buildPagesの索引バグやテンプレート分岐漏れで異なるページが同一バイト列になるのを
 * 通常コードで機械的に検出する(AIの視覚QAだけに頼らない第4の検証層)。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CarouselSpec } from "@core/schemas";
import { renderCarousel } from "@adapters/render/renderer";
import { runDesignQa } from "@adapters/render/design-qa";
import { computeFingerprint } from "@adapters/render/fingerprint";
import { loadTheme } from "@adapters/render/theme";

const SPEC: CarouselSpec = {
  kind: "carousel_spec",
  templateId: "tpl-howto",
  pillar: "6",
  sourceCopyArtifactId: "copy-test-0001",
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

describe("design QA > ページ重複検出", () => {
  it("正常なレンダリングは全ページ相異なり、no-duplicate-pagesがpass", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-dqa-ok-"));
    try {
      const result = await renderCarousel(SPEC, dir);
      const theme = loadTheme();
      const fingerprint = computeFingerprint(SPEC.templateId, 1, theme);
      const qa = await runDesignQa(SPEC, {
        files: result.files, pageCount: result.pageCount, variant: result.variant, fingerprint, templateVersion: 1,
      }, theme);
      const check = qa.checks.find((c) => c.id === "no-duplicate-pages");
      expect(check?.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("2ページが同一バイト列の場合、no-duplicate-pagesがfailし、design QA全体もfailになる", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-dqa-dup-"));
    try {
      const result = await renderCarousel(SPEC, dir);
      // 03.pngを02.pngで上書きし、異なるページが同一内容になる状態を人工的に再現する
      copyFileSync(result.files[1]!, result.files[2]!);
      const theme = loadTheme();
      const fingerprint = computeFingerprint(SPEC.templateId, 1, theme);
      const qa = await runDesignQa(SPEC, {
        files: result.files, pageCount: result.pageCount, variant: result.variant, fingerprint, templateVersion: 1,
      }, theme);
      const check = qa.checks.find((c) => c.id === "no-duplicate-pages");
      expect(check?.ok).toBe(false);
      expect(check?.detail).toContain("02.png");
      expect(check?.detail).toContain("03.png");
      expect(qa.result).toBe("fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("design QA > ページ数レンジ(改善: 6ステップhowto投稿の誤fail再発防止)", () => {
  // 実際に発生した不具合: slidesSchemaはpages 3〜6件を許可するため、tpl-howtoは
  // 最大9枚(表紙+6+まとめ+CTA)になり得るが、design-qa.tsの妥当性レンジが5〜7に
  // 固定されていたため、5ステップ(8枚)の投稿がpage-countチェックで誤ってfailし、
  // 承認済み投稿がexport不能になった(qa_report/visual_qaはAI判定のためこの不整合に気づけない)。
  const SIX_STEP_SPEC: CarouselSpec = {
    ...SPEC,
    slides: {
      ...SPEC.slides,
      pages: [
        ...SPEC.slides.pages,
        { heading: "ステップ4", body: "4番目の手順を短くまとめた本文です。" },
        { heading: "ステップ5", body: "5番目の手順を短くまとめた本文です。" },
        { heading: "ステップ6", body: "6番目の手順を短くまとめた本文です。" },
      ],
    },
  };

  it("6ステップ(9枚)のhowto投稿はpage-countチェックをpassする", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-dqa-6step-"));
    try {
      const result = await renderCarousel(SIX_STEP_SPEC, dir);
      expect(result.pageCount).toBe(9);
      const theme = loadTheme();
      const fingerprint = computeFingerprint(SIX_STEP_SPEC.templateId, 1, theme);
      const qa = await runDesignQa(SIX_STEP_SPEC, {
        files: result.files, pageCount: result.pageCount, variant: result.variant, fingerprint, templateVersion: 1,
      }, theme);
      const check = qa.checks.find((c) => c.id === "page-count");
      expect(check?.ok).toBe(true);
      expect(qa.result).toBe("pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("5ステップ(8枚)のhowto投稿もpage-countチェックをpassする", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-dqa-5step-"));
    try {
      const fiveStepSpec: CarouselSpec = {
        ...SPEC,
        slides: {
          ...SPEC.slides,
          pages: [
            ...SPEC.slides.pages,
            { heading: "ステップ4", body: "4番目の手順の本文です。" },
            { heading: "ステップ5", body: "5番目の手順の本文です。" },
          ],
        },
      };
      const result = await renderCarousel(fiveStepSpec, dir);
      expect(result.pageCount).toBe(8);
      const theme = loadTheme();
      const fingerprint = computeFingerprint(fiveStepSpec.templateId, 1, theme);
      const qa = await runDesignQa(fiveStepSpec, {
        files: result.files, pageCount: result.pageCount, variant: result.variant, fingerprint, templateVersion: 1,
      }, theme);
      const check = qa.checks.find((c) => c.id === "page-count");
      expect(check?.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
