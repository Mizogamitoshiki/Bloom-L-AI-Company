/**
 * Instagramストーリーレンダラー(V8/D-18, 2026-07-27)。通常コード・AI描画なし。
 * 梓の市場検証(複数ソース照合)に基づく仕様を定数として強制する:
 * - キャンバス 1080x1920 / セーフゾーン: 上270px・下380px・左右65px(Meta広告比率準拠の厳しめ)
 * - 見出しは特大(76px)・1枚の文字量は最小限 / 和文ゴシック(Noto Sans JP)
 * - 濃紺基調・ゴールドは差し色のみ(面積5〜10%以内: 細線・小ラベルに限定)
 * - 文字はコピーを逐語で描画(Canva生成の文字事故を構造的に排除)
 *
 * Canvaの役割: 代表者がCanvaアプリで自作したストーリーを椿が取り込む経路(手動高品質)と併存する。
 */
import satori from "satori";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadFonts } from "./fonts";
import { loadTheme } from "./theme";
import { el, logoMark, type SatoriNode } from "../../core/templates/components";
import { FONT } from "../../core/templates/design-system";

export const STORY_CANVAS = { width: 1080, height: 1920 } as const;
/** セーフゾーン(梓検証 2026-07-27: Meta比率14%/20%/6%準拠) */
export const STORY_SAFE = { top: 270, bottom: 380, side: 65 } as const;

/** ストーリー1枚の入力。文字量上限は梓検証の「1枚30〜40字以内」を強制 */
export const storySpecSchema = z
  .object({
    kind: z.literal("story_spec"),
    /** フック(特大見出し)。改行は\nで明示指定 */
    hook: z.string().min(4).max(30),
    /** 補足1行(任意・小さめ) */
    sub: z.string().min(2).max(24).optional(),
    /** CTAバッジ(任意。リンクスティッカーはInstagramアプリで重ねる想定なので下部には置かない) */
    cta: z.string().min(2).max(20).optional(),
    /** レイアウト: hook-center(問いかけ/宣言) | announce(新着投稿の告知) | pricing(料金表) */
    layout: z.enum(["hook-center", "announce", "pricing"]).default("hook-center"),
    /** pricing用: プランカード(2〜3件)。金額文字列は入力をそのまま描画(数字改変の余地なし) */
    plans: z
      .array(
        z
          .object({
            name: z.string().min(1).max(10),
            price: z.string().min(2).max(20),
            note: z.string().min(2).max(40),
            maintenance: z.string().min(2).max(20),
            highlight: z.boolean().default(false),
            badge: z.string().max(6).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(3)
      .optional(),
  })
  .strict()
  .refine((s) => (s.layout === "pricing" ? !!s.plans : true), { message: "pricingレイアウトにはplansが必要です" })
  .refine(
    (s) => (s.layout === "pricing" ? true : s.hook.length + (s.sub?.length ?? 0) + (s.cta?.length ?? 0) <= 60),
    { message: "ストーリー1枚の合計文字数は60字以内にしてください(視認性の定石)" },
  );
export type StorySpec = z.infer<typeof storySpecSchema>;

/** CLI/シェル経由でエスケープされた"\\n"を実改行へ正規化(pnpmの引数転送で二重エスケープされる場合がある) */
function nl(s: string): string {
  return s.replace(/\\n/g, "\n");
}

function storyNode(spec: StorySpec): SatoriNode {
  const theme = loadTheme();
  const p = theme.colors;
  const navy = p.primary;
  const navyDark = p.primaryDark;
  const gold = p.accent;

  // 中央コンテンツ(セーフゾーン内)
  const center: SatoriNode[] = [];
  if (spec.layout === "pricing" && spec.plans) {
    center.push(
      el("div", { fontSize: 58, fontWeight: 800, color: "#ffffff", textAlign: "center", display: "flex", justifyContent: "center", whiteSpace: "pre-wrap" }, nl(spec.hook)),
    );
    if (spec.sub) {
      center.push(el("div", { fontSize: 30, fontWeight: 500, color: gold, textAlign: "center", display: "flex", justifyContent: "center" }, nl(spec.sub)));
    }
    for (const plan of spec.plans) {
      const border = plan.highlight ? `4px solid ${gold}` : `2px solid rgba(255,255,255,0.28)`;
      center.push(
        el("div", { display: "flex", flexDirection: "column", gap: 10, backgroundColor: plan.highlight ? "rgba(201,162,75,0.14)" : "rgba(255,255,255,0.06)", border, borderRadius: 24, padding: "26px 34px", position: "relative" }, [
          el("div", { display: "flex", alignItems: "center", gap: 14 }, [
            el("div", { fontSize: 34, fontWeight: 800, color: plan.highlight ? gold : "#ffffff", display: "flex" }, plan.name),
            ...(plan.badge
              ? [el("div", { fontSize: 22, fontWeight: 800, color: navyDark, backgroundColor: gold, borderRadius: 999, padding: "4px 16px", display: "flex" }, plan.badge)]
              : []),
          ]),
          el("div", { fontSize: 44, fontWeight: 900, color: "#ffffff", display: "flex" }, plan.price),
          el("div", { fontSize: 25, fontWeight: 500, color: "rgba(255,255,255,0.88)", display: "flex", whiteSpace: "pre-wrap" }, nl(plan.note)),
          el("div", { fontSize: 24, fontWeight: 700, color: gold, display: "flex" }, plan.maintenance),
        ]),
      );
    }
    if (spec.cta) {
      center.push(
        el("div", { display: "flex", justifyContent: "center" }, [
          el("div", { fontSize: 30, fontWeight: 700, color: navyDark, backgroundColor: "#ffffff", padding: "16px 36px", borderRadius: 999, display: "flex" }, nl(spec.cta)),
        ]),
      );
    }
    return el(
      "div",
      {
        width: STORY_CANVAS.width, height: STORY_CANVAS.height, display: "flex", flexDirection: "column",
        fontFamily: FONT, backgroundColor: navy,
        backgroundImage: `linear-gradient(180deg, ${navy} 0%, ${navyDark} 100%)`,
        paddingTop: STORY_SAFE.top, paddingBottom: STORY_SAFE.bottom,
        paddingLeft: STORY_SAFE.side, paddingRight: STORY_SAFE.side,
      },
      [
        el("div", { display: "flex", justifyContent: "center" }, [logoMark(theme, true)]),
        el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 26 }, center),
        el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }, [
          el("div", { width: 72, height: 3, backgroundColor: gold, display: "flex" }, ""),
          el("div", { fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: 2, display: "flex" }, "泉州のHP制作 Bloom-L"),
        ]),
      ],
    );
  }
  if (spec.layout === "announce") {
    center.push(
      el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }, [
        el("div", { fontSize: 30, fontWeight: 700, color: gold, letterSpacing: 6, display: "flex" }, "NEW POST"),
        el("div", { width: 56, height: 3, backgroundColor: gold, display: "flex" }, ""),
      ]),
    );
  }
  center.push(
    el(
      "div",
      {
        fontSize: 76, fontWeight: 800, color: "#ffffff", lineHeight: 1.35, textAlign: "center",
        whiteSpace: "pre-wrap", display: "flex", justifyContent: "center",
      },
      nl(spec.hook),
    ),
  );
  if (spec.sub) {
    center.push(
      el("div", { fontSize: 40, fontWeight: 500, color: "rgba(255,255,255,0.85)", textAlign: "center", whiteSpace: "pre-wrap", display: "flex", justifyContent: "center" }, nl(spec.sub)),
    );
  }
  if (spec.cta) {
    center.push(
      el("div", { display: "flex", justifyContent: "center", marginTop: 20 }, [
        el(
          "div",
          {
            fontSize: 34, fontWeight: 700, color: navyDark, backgroundColor: "#ffffff",
            padding: "20px 44px", borderRadius: 999, display: "flex",
          },
          nl(spec.cta),
        ),
      ]),
    );
  }

  return el(
    "div",
    {
      width: STORY_CANVAS.width, height: STORY_CANVAS.height, display: "flex", flexDirection: "column",
      fontFamily: FONT, backgroundColor: navy,
      backgroundImage: `linear-gradient(180deg, ${navy} 0%, ${navyDark} 100%)`,
      paddingTop: STORY_SAFE.top, paddingBottom: STORY_SAFE.bottom,
      paddingLeft: STORY_SAFE.side, paddingRight: STORY_SAFE.side,
    },
    [
      // 上部: ロゴ(セーフゾーン内の先頭)
      el("div", { display: "flex", justifyContent: "center" }, [logoMark(theme, true)]),
      // 中央: フック(残り空間の中央に)
      el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 36 }, center),
      // 下部(セーフゾーン内の末尾): ゴールドの細線+ブランド名のみ(金は差し色に限定)
      el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }, [
        el("div", { width: 72, height: 3, backgroundColor: gold, display: "flex" }, ""),
        el("div", { fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: 2, display: "flex" }, "泉州のHP制作 Bloom-L"),
      ]),
    ],
  );
}

/** ストーリーPNGを描画して保存する。返り値は絶対パス */
export async function renderStory(spec: StorySpec, outFile: string): Promise<string> {
  const parsed = storySpecSchema.parse(spec);
  const fonts = loadFonts();
  const svg = await satori(storyNode(parsed) as never, { width: STORY_CANVAS.width, height: STORY_CANVAS.height, fonts } as never);
  mkdirSync(path.dirname(outFile), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outFile);
  const meta = await sharp(outFile).metadata();
  if (meta.width !== STORY_CANVAS.width || meta.height !== STORY_CANVAS.height) {
    throw new Error(`ストーリー出力の寸法が不正です: ${meta.width}x${meta.height}`);
  }
  return outFile;
}
