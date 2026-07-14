/**
 * テンプレート共有部品(V3-D)。1080×1350、セーフエリア、ブランドバー、ページドット。
 * 全テンプレートで一貫した枠組みを使う(docs/11: ページ間の一貫性)。
 */
export const CANVAS = { width: 1080, height: 1350 } as const;
export const SAFE = 64;
export const CONTENT_WIDTH = CANVAS.width - SAFE * 2; // 952
export const FONT = "Noto Sans JP";

export interface BrandColors {
  primary: string;
  primaryDark: string;
  accent: string;
  surface: string;
  ink: string;
  inkMuted: string;
}

export interface SatoriNode {
  type: string;
  props: Record<string, unknown> & { children?: SatoriNode | SatoriNode[] | string };
}

export interface SlotDef {
  id: string;
  width: number;
  fontSize: number;
  lineHeight: number;
  weight: 400 | 700;
  maxHeight: number;
}

export interface SlotText {
  def: SlotDef;
  slotPath: string;
  text: string;
}

export function el(
  type: string,
  style: Record<string, unknown>,
  children?: SatoriNode | SatoriNode[] | string,
): SatoriNode {
  return { type, props: { style, children } };
}

/** テキストスロット共通ノード(計測と同一条件: pre-wrap+上限高さ) */
export function textSlot(def: SlotDef, text: string, extra: Record<string, unknown> = {}): SatoriNode {
  return el(
    "div",
    {
      fontSize: def.fontSize,
      lineHeight: def.lineHeight,
      fontWeight: def.weight,
      whiteSpace: "pre-wrap",
      display: "flex",
      maxHeight: def.maxHeight,
      overflow: "hidden",
      ...extra,
    },
    text,
  );
}

export function frame(colors: BrandColors, children: SatoriNode[]): SatoriNode {
  return el(
    "div",
    {
      width: CANVAS.width,
      height: CANVAS.height,
      display: "flex",
      flexDirection: "column",
      backgroundColor: colors.surface,
      fontFamily: FONT,
      color: colors.ink,
      padding: SAFE,
    },
    children,
  );
}

export function brandBar(colors: BrandColors, right: string): SatoriNode {
  return el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }, [
    el("div", { display: "flex", alignItems: "center", gap: 12 }, [
      el("div", { width: 28, height: 28, backgroundColor: colors.primary, borderRadius: 6, display: "flex" }),
      el("div", { fontSize: 32, fontWeight: 700, color: colors.primaryDark, display: "flex" }, "Bloom-L"),
    ]),
    el("div", { fontSize: 26, color: colors.inkMuted, display: "flex" }, right),
  ]);
}

export function pageDots(colors: BrandColors, total: number, current: number): SatoriNode {
  const dots: SatoriNode[] = [];
  for (let i = 0; i < total; i++) {
    dots.push(
      el("div", {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: i === current ? colors.primary : "#c9c2b2",
        display: "flex",
      }),
    );
  }
  return el("div", { display: "flex", gap: 10, justifyContent: "center", width: "100%" }, dots);
}

/** 中央寄せの本文カラム */
export function centerColumn(children: SatoriNode[], gap = 40): SatoriNode {
  return el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap }, children);
}

/** セクション見出し(ラベルタグ) */
export function sectionTag(colors: BrandColors, label: string, bg?: string): SatoriNode {
  return el(
    "div",
    {
      backgroundColor: bg ?? colors.primary,
      color: "#ffffff",
      fontSize: 30,
      fontWeight: 700,
      padding: "8px 24px",
      borderRadius: 8,
      display: "flex",
      alignSelf: "flex-start",
    },
    label,
  );
}

export const PILLAR_LABEL: Record<"1" | "2" | "3" | "4" | "5" | "6", string> = {
  "1": "IT・AIニュース",
  "2": "HPの役割",
  "3": "HPで変わる",
  "4": "Web・ITの気になる話",
  "5": "制作実績",
  "6": "泉州の事業者さまへ",
};
