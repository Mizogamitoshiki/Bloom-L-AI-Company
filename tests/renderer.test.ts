/**
 * V2: レンダラー(Satori+Sharp)のテスト。
 * AC-6(文字数上限の事前差し戻し)/ AC-7(決定的レンダリング)/ 解像度検証 / 文字あふれ実測
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { carouselSpecSchema, slidesSchema, type CarouselSpec } from "@core/schemas";
import { enumerateSlots } from "@core/templates/tpl-howto";
import { measureSlotOverflows, renderCarousel, OverflowError } from "@adapters/render/renderer";
import sharp from "sharp";

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

describe("スロット文字数(第1層・Zod)", () => {
  it("上限超過のスライド文言はスキーマで拒否される(AC-6)", () => {
    const bad = {
      ...SPEC.slides,
      cover: { title: "こ".repeat(27), subtitle: "" }, // max 26
    };
    expect(slidesSchema.safeParse(bad).success).toBe(false);
    expect(carouselSpecSchema.safeParse({ ...SPEC, slides: bad }).success).toBe(false);
  });

  it("enumerateSlotsが全テキストスロットを列挙する", () => {
    const slots = enumerateSlots(SPEC);
    // cover.title + cover.subtitle + 3ページ×(heading/body/summary) + cta = 12
    expect(slots).toHaveLength(12);
    expect(slots.map((s) => s.slotPath)).toContain("pages[2].body");
  });
});

describe("文字あふれ実測(第2層・Satori)", () => {
  it("正常なspecはあふれなし", async () => {
    const overflows = await measureSlotOverflows(SPEC);
    expect(overflows).toEqual([]);
  });

  it("スキーマ上限内でも改行を多用した本文は実測で検出される", async () => {
    // 90字以内だが改行7個で行数が膨らむ(maxHeight 700pxを超える)ケース
    const tricky: CarouselSpec = {
      ...SPEC,
      slides: {
        ...SPEC.slides,
        pages: [
          { heading: "改行の多い本文", body: "一行目です\n二行目です\n三行目です\n四行目です\n五行目です\n六行目です\n七行目です\n八行目です\n九行目です\n十行目です\n十一行目\n十二行目" },
          ...SPEC.slides.pages.slice(1),
        ],
      },
    };
    const overflows = await measureSlotOverflows(tricky);
    expect(overflows.length).toBeGreaterThan(0);
    expect(overflows[0]!.slotPath).toBe("pages[0].body");
    expect(overflows[0]!.measuredHeight).toBeGreaterThan(overflows[0]!.maxHeight);
  });
});

describe("レンダリング(Sharp出力)", () => {
  it("表紙+本文3+まとめ+CTA=6枚の1080×1350 PNGが生成される", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-render-"));
    try {
      const result = await renderCarousel(SPEC, dir);
      expect(result.pageCount).toBe(6);
      expect(result.files).toHaveLength(6);
      const meta = await sharp(result.files[0]!).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1350);
      expect(meta.format).toBe("png");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("同一specから同一バイト列のPNGが生成される(AC-7 決定性)", async () => {
    const dir1 = mkdtempSync(path.join(tmpdir(), "bloom-det1-"));
    const dir2 = mkdtempSync(path.join(tmpdir(), "bloom-det2-"));
    try {
      const r1 = await renderCarousel(SPEC, dir1);
      const r2 = await renderCarousel(SPEC, dir2);
      const b1 = readFileSync(r1.files[0]!);
      const b2 = readFileSync(r2.files[0]!);
      expect(b1.equals(b2)).toBe(true);
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  }, 60_000);

  it("あふれるspecはOverflowErrorでレンダリングされない", async () => {
    const tricky: CarouselSpec = {
      ...SPEC,
      slides: {
        ...SPEC.slides,
        pages: [{ heading: "検査", body: "行\n".repeat(30).trim() }, ...SPEC.slides.pages.slice(1)],
      },
    };
    const dir = mkdtempSync(path.join(tmpdir(), "bloom-ovf-"));
    try {
      await expect(renderCarousel(tricky, dir)).rejects.toThrow(OverflowError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
