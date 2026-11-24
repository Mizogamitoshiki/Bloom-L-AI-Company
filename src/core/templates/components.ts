/**
 * 再利用可能なカルーセルcomponent(V4.5)。すべてdesign-systemのトークンだけを参照する。
 * 通常コード(AI不使用)。Satoriが解釈できるflexboxのサブセットのみ使用する。
 *
 * 提供物: ページ枠、実ロゴ入りヘッダー、ドット+CTAのフッター、見出し、番号ステップ、
 * チェック項目、強調数値(stat)、比較表、端末モック、引用/出典カード、タグ、アイコン。
 */
import {
  CANVAS, SAFE, SPACE, RADIUS, STROKE, TYPE, FONT, CONTENT_WIDTH,
  LOGO_DISPLAY_WIDTH, type TypeToken, type TypeStyle, type Theme, type Palette,
} from "./design-system";

export interface SatoriNode {
  type: string;
  props: Record<string, unknown> & { children?: SatoriNode | SatoriNode[] | string };
}

/** ページとそのlayoutId(variant差分の構造判定に使う) */
export interface RenderedPage {
  layoutId: string;
  node: SatoriNode;
}
export function pg(layoutId: string, node: SatoriNode): RenderedPage {
  return { layoutId, node };
}

/** あふれ検査用スロット(renderer.measureSlotOverflowsが使用) */
export interface SlotDef {
  width: number;
  fontSize: number;
  lineHeight: number;
  weight: 400 | 500 | 700 | 800 | 900;
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

/** type tokenからテキストstyleを作る */
export function typeStyle(token: TypeToken, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const t: TypeStyle = TYPE[token];
  return {
    fontSize: t.size,
    lineHeight: t.lh,
    fontWeight: t.weight,
    ...(t.tracking ? { letterSpacing: t.tracking } : {}),
    display: "flex",
    ...extra,
  };
}

/** テキストノード(display:flexで単一ブロック) */
export function text(token: TypeToken, value: string, extra: Record<string, unknown> = {}): SatoriNode {
  return el("div", { ...typeStyle(token, { whiteSpace: "pre-wrap" }), ...extra }, value);
}

/** あふれ検査スロット。maxHeight = size*lh*maxLines を許容にする(端数の丸め込みで+2px) */
export function slot(slotPath: string, value: string, token: TypeToken, width: number, maxLines: number): SlotText {
  const t = TYPE[token];
  return {
    slotPath,
    text: value,
    def: {
      width,
      fontSize: t.size,
      lineHeight: t.lh,
      weight: t.weight,
      maxHeight: Math.ceil(t.size * t.lh * maxLines) + 2,
    },
  };
}

// ---------- ページ枠 ----------

export type Background = "white" | "soft" | "primary";

/** 1080×1350のページ枠。背景バリアント別に地色を切り替える */
export function page(theme: Theme, background: Background, children: SatoriNode[]): SatoriNode {
  const p = theme.colors;
  const bg =
    background === "primary"
      ? { backgroundColor: p.primary, color: p.onPrimary }
      : background === "soft"
        ? { backgroundColor: p.surfaceDark, color: p.ink }
        : { backgroundColor: p.surface, color: p.ink };
  return el(
    "div",
    {
      width: CANVAS.width,
      height: CANVAS.height,
      display: "flex",
      flexDirection: "column",
      fontFamily: FONT,
      padding: SAFE,
      ...bg,
    },
    children,
  );
}

// ---------- ロゴ ----------

/** 実ロゴ(縦横比固定・data URI)。無い場合のみ文字ロゴにフォールバック(doctorが警告) */
/** src・width・heightはstyleでなく直接props(Satori要件) */
function imgNode(src: string, width: number, height: number): SatoriNode {
  return { type: "img", props: { src, width, height, style: { display: "flex" } } };
}

// ---------- ベクターアイコン(フォント記号に依存しない。SVG data URIで確実に描画) ----------

function svgIcon(inner: string, size: number, bg?: string): SatoriNode {
  const circle = bg ? `<circle cx='12' cy='12' r='12' fill='${bg}'/>` : "";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24'>${circle}${inner}</svg>`;
  return imgNode(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, size, size);
}

/** チェック(丸地に白いレ点) */
export function iconCheck(color: string, size = 44): SatoriNode {
  return svgIcon(`<path d='M6.5 12.5l3.5 3.5L17.5 8.5' fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/>`, size, color);
}
/** バツ(丸地に白い×) */
export function iconCross(color: string, size = 44): SatoriNode {
  return svgIcon(`<path d='M8 8l8 8M16 8l-8 8' fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round'/>`, size, color);
}
/** 右向き矢印(丸地) */
export function iconArrow(color: string, size = 44): SatoriNode {
  return svgIcon(`<path d='M8 12h8M13 8l4 4-4 4' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/>`, size, color);
}
/** 注意(丸地に!) */
export function iconWarn(color: string, size = 44): SatoriNode {
  return svgIcon(`<path d='M12 7v6' stroke='#fff' stroke-width='2.6' stroke-linecap='round'/><circle cx='12' cy='16.5' r='1.4' fill='#fff'/>`, size, color);
}

export function logoMark(theme: Theme, onDark = false): SatoriNode {
  const l = theme.logo;
  if (l) {
    const h = Math.round((LOGO_DISPLAY_WIDTH * l.height) / l.width);
    const img = imgNode(l.dataUri, LOGO_DISPLAY_WIDTH, h);
    // 白背景ロゴを暗色帯に置く場合は白カードで縁取り、セーフエリアを確保
    if (onDark) {
      return el("div", { display: "flex", backgroundColor: "#ffffff", padding: "10px 16px", borderRadius: RADIUS.sm }, [img]);
    }
    return img;
  }
  return el("div", { ...typeStyle("h2"), color: onDark ? "#fff" : theme.colors.primaryDark }, "Bloom-L");
}

// ---------- ヘッダー / フッター ----------

/** 上部ヘッダー: 実ロゴ + 右にkicker(系統ラベル) */
export function header(theme: Theme, kicker: string, onDark = false): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" },
    [
      logoMark(theme, onDark),
      el(
        "div",
        {
          ...typeStyle("kicker"),
          color: onDark ? "rgba(255,255,255,0.9)" : p.inkMuted,
          textTransform: "none",
        },
        kicker,
      ),
    ],
  );
}

/** ページドット */
export function dots(theme: Theme, total: number, current: number, onDark = false): SatoriNode {
  const p = theme.colors;
  const nodes: SatoriNode[] = [];
  for (let i = 0; i < total; i++) {
    const active = i === current;
    nodes.push(
      el("div", {
        width: active ? 40 : 14,
        height: 14,
        borderRadius: RADIUS.pill,
        backgroundColor: active ? (onDark ? "#fff" : p.primary) : onDark ? "rgba(255,255,255,0.4)" : p.line,
        display: "flex",
      }),
    );
  }
  return el("div", { display: "flex", gap: SPACE.xs, alignItems: "center" }, nodes);
}

/** 下部フッター: ドット + 任意のCTAチップ。onDarkで反転 */
export function footer(theme: Theme, total: number, current: number, opts: { cta?: string; onDark?: boolean } = {}): SatoriNode {
  const p = theme.colors;
  const onDark = opts.onDark ?? false;
  const left = dots(theme, total, current, onDark);
  const right = opts.cta
    ? el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          gap: SPACE.xs,
          backgroundColor: onDark ? "#fff" : p.primary,
          color: onDark ? p.primaryDark : "#fff",
          padding: "12px 24px",
          borderRadius: RADIUS.pill,
          fontSize: TYPE.label.size,
          fontWeight: 700,
        },
        opts.cta,
      )
    : el("div", { display: "flex" }, "");
  return el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }, [left, right]);
}

/** 縦の主要領域(ヘッダーとフッターの間)。整列と余白のリズムを担う */
export function body(children: SatoriNode[], opts: { justify?: string; gap?: number } = {}): SatoriNode {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      flexGrow: 1,
      justifyContent: opts.justify ?? "center",
      gap: opts.gap ?? SPACE.xl,
      width: "100%",
    },
    children,
  );
}

// ---------- 見出し・ラベル ----------

/** 系統/セクションのラベルタグ(小さな帯) */
export function tag(theme: Theme, label: string, tone: "primary" | "accent" | "soft" = "primary"): SatoriNode {
  const p = theme.colors;
  const style =
    tone === "accent"
      ? { backgroundColor: p.accentSoft, color: "#8a5a0a" }
      : tone === "soft"
        ? { backgroundColor: p.primarySoft, color: p.primaryDark }
        : { backgroundColor: p.primary, color: "#fff" };
  return el(
    "div",
    {
      ...style,
      alignSelf: "flex-start",
      padding: "10px 22px",
      borderRadius: RADIUS.pill,
      fontSize: TYPE.label.size,
      fontWeight: 700,
      display: "flex",
    },
    label,
  );
}

/** 左に太いアクセントバーを持つ見出し(視線の起点) */
export function barHeading(theme: Theme, token: TypeToken, value: string): SatoriNode {
  const p = theme.colors;
  return el("div", { display: "flex", alignItems: "flex-start", gap: SPACE.md, width: "100%" }, [
    el("div", { width: STROKE.bold + 3, alignSelf: "stretch", backgroundColor: p.primary, borderRadius: RADIUS.pill, display: "flex" }),
    el("div", { ...typeStyle(token, { whiteSpace: "pre-wrap" }), color: p.ink, flexGrow: 1 }, value),
  ]);
}

// ---------- コンテンツ部品 ----------

/** 丸番号バッジ */
export function numberBadge(theme: Theme, n: number, size = 72): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    {
      width: size, height: size, borderRadius: RADIUS.pill, backgroundColor: p.primary, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.5), fontWeight: 800,
      flexShrink: 0,
    },
    String(n),
  );
}

/** 番号つきステップカード(見出し+本文) */
export function stepCard(theme: Theme, n: number, heading: string, bodyText: string): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    {
      display: "flex", gap: SPACE.lg, alignItems: "flex-start", width: "100%",
      backgroundColor: p.surface, border: `${STROKE.hair}px solid ${p.line}`, borderRadius: RADIUS.lg,
      padding: SPACE.lg, boxShadow: "0 6px 20px rgba(11,70,184,0.06)",
    },
    [
      numberBadge(theme, n, 64),
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.xs, flexGrow: 1 }, [
        el("div", { ...typeStyle("h3", { whiteSpace: "pre-wrap" }), color: p.ink }, heading),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.inkMuted }, bodyText),
      ]),
    ],
  );
}

/** チェック項目(✓アイコン+テキスト) */
export function checkItem(theme: Theme, value: string, tone: "ok" | "primary" = "primary"): SatoriNode {
  const p = theme.colors;
  const c = tone === "ok" ? p.ok : p.primary;
  return el(
    "div",
    {
      display: "flex", gap: SPACE.md, alignItems: "center", width: "100%",
      backgroundColor: p.surface, border: `${STROKE.hair}px solid ${p.line}`, borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
    },
    [checkMark(c, 44), el("div", { ...typeStyle("bodyStrong", { whiteSpace: "pre-wrap" }), color: p.ink, flexGrow: 1 }, value)],
  );
}

/** ✓丸アイコン(ベクター。フォント記号に依存しない) */
export function checkMark(color: string, size = 44): SatoriNode {
  return iconCheck(color, size);
}

/** ✕丸アイコン(ベクター) */
export function crossMark(color: string, size = 44): SatoriNode {
  return iconCross(color, size);
}

/** 強調数値ブロック(stat + 単位 + ラベル) */
export function statBlock(theme: Theme, value: string, unit: string, label: string): SatoriNode {
  const p = theme.colors;
  return el("div", { display: "flex", flexDirection: "column", gap: SPACE.xs }, [
    el("div", { display: "flex", alignItems: "flex-end", gap: SPACE.xs }, [
      el("div", { ...typeStyle("stat"), color: p.primary }, value),
      el("div", { ...typeStyle("statUnit"), color: p.primary, paddingBottom: 18 }, unit),
    ]),
    el("div", { ...typeStyle("body"), color: p.inkMuted }, label),
  ]);
}

/** 引用/見解カード(左に縦バー) */
export function quoteCard(theme: Theme, heading: string, bodyText: string, tone: "primary" | "accent" = "primary"): SatoriNode {
  const p = theme.colors;
  const accent = tone === "accent" ? p.accent : p.primary;
  const bg = tone === "accent" ? p.accentSoft : p.primarySoft;
  return el(
    "div",
    { display: "flex", gap: SPACE.md, width: "100%", backgroundColor: bg, borderRadius: RADIUS.lg, padding: SPACE.lg },
    [
      el("div", { width: STROKE.bold + 1, alignSelf: "stretch", backgroundColor: accent, borderRadius: RADIUS.pill, display: "flex" }),
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, flexGrow: 1 }, [
        el("div", { ...typeStyle("label"), color: tone === "accent" ? "#8a5a0a" : p.primaryDark }, heading),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink }, bodyText),
      ]),
    ],
  );
}

/** 出典カード(発行元・タイトル・日付を1行カードで明示) */
export function sourceCard(theme: Theme, publisher: string, title: string, publishedAt: string): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    {
      display: "flex", flexDirection: "column", gap: 4, width: "100%",
      backgroundColor: p.surface, border: `${STROKE.hair}px solid ${p.line}`, borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
    },
    [
      el("div", { display: "flex", gap: SPACE.sm, alignItems: "center" }, [
        el("div", { backgroundColor: p.primarySoft, color: p.primaryDark, fontSize: 22, fontWeight: 700, padding: "4px 14px", borderRadius: RADIUS.sm, display: "flex" }, "出典"),
        el("div", { fontSize: 24, fontWeight: 700, color: p.inkMuted, display: "flex" }, `${publisher}${publishedAt ? " ・ " + publishedAt : ""}`),
      ]),
      el("div", { ...typeStyle("caption", { whiteSpace: "pre-wrap" }), color: p.ink }, title),
    ],
  );
}

/** 2列比較行(左=課題/before, 右=解決/after) */
export function comparisonRow(theme: Theme, left: string, right: string, opts: { header?: boolean } = {}): SatoriNode {
  const p = theme.colors;
  const header = opts.header ?? false;
  const cell = (value: string, side: "l" | "r"): SatoriNode =>
    el(
      "div",
      {
        display: "flex", flexBasis: 0, flexGrow: 1, padding: `${SPACE.md}px ${SPACE.lg}px`, alignItems: "center", gap: SPACE.sm,
        ...(header
          ? { backgroundColor: side === "r" ? p.primary : p.surfaceDark, color: side === "r" ? "#fff" : p.inkMuted, fontWeight: 800, fontSize: TYPE.label.size }
          : { fontSize: TYPE.body.size, color: p.ink, fontWeight: side === "r" ? 700 : 400 }),
      },
      header ? value : [side === "r" ? checkMark(p.primary, 34) : crossMark(p.inkMuted, 34), el("div", { display: "flex", flexGrow: 1, whiteSpace: "pre-wrap" }, value)],
    );
  return el(
    "div",
    { display: "flex", width: "100%", borderTop: `${STROKE.hair}px solid ${p.line}` },
    [cell(left, "l"), el("div", { width: STROKE.hair, backgroundColor: p.line, display: "flex" }, ""), cell(right, "r")],
  );
}

/** 比較表(ヘッダー行+複数行のカード) */
export function comparisonTable(theme: Theme, headers: [string, string], rows: [string, string][]): SatoriNode {
  const p = theme.colors;
  const children: SatoriNode[] = [comparisonRow(theme, headers[0], headers[1], { header: true })];
  for (const [l, r] of rows) children.push(comparisonRow(theme, l, r));
  return el(
    "div",
    { display: "flex", flexDirection: "column", width: "100%", backgroundColor: p.surface, border: `${STROKE.hair}px solid ${p.line}`, borderRadius: RADIUS.lg, overflow: "hidden", boxShadow: "0 6px 20px rgba(11,70,184,0.06)" },
    children,
  );
}

/** 端末モック(スマホ枠の中に見出し+行を表示) */
export function deviceMock(theme: Theme, title: string, lines: string[]): SatoriNode {
  const p = theme.colors;
  const rows = lines.slice(0, 4).map((ln) =>
    el("div", { display: "flex", alignItems: "center", gap: SPACE.sm, width: "100%" }, [
      el("div", { width: 16, height: 16, borderRadius: 4, backgroundColor: p.primary, display: "flex" }),
      el("div", { flexGrow: 1, height: 20, borderRadius: RADIUS.pill, backgroundColor: p.surfaceDark, display: "flex" }, ""),
    ]),
  );
  void rows;
  return el(
    "div",
    {
      display: "flex", flexDirection: "column", width: 360, height: 500, borderRadius: RADIUS.xl, backgroundColor: "#fff",
      border: `10px solid ${p.ink}`, padding: 0, overflow: "hidden", boxShadow: "0 20px 50px rgba(22,35,63,0.22)",
    },
    [
      el("div", { display: "flex", alignItems: "center", justifyContent: "center", height: 92, flexShrink: 0, backgroundColor: p.primary, color: "#fff", fontSize: 26, fontWeight: 800, padding: "0 20px", textAlign: "center", overflow: "hidden" }, title),
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.md, padding: SPACE.lg, flexGrow: 1 }, [
        el("div", { width: "100%", height: 140, borderRadius: RADIUS.md, backgroundColor: p.primarySoft, display: "flex" }, ""),
        ...lines.slice(0, 3).map((ln) =>
          el("div", { display: "flex", flexDirection: "column", gap: 8 }, [
            el("div", { fontSize: 22, fontWeight: 700, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, ln),
            el("div", { width: "70%", height: 12, borderRadius: RADIUS.pill, backgroundColor: p.surfaceDark, display: "flex" }, ""),
          ]),
        ),
      ]),
    ],
  );
}

/** 表紙下部の「この投稿の内容」プレビュー(空白を埋め、構成を予告する) */
export function contentsCard(theme: Theme, title: string, items: string[], onSoft = false): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: SPACE.sm, backgroundColor: onSoft ? "#fff" : p.primarySoft, borderRadius: RADIUS.lg, padding: SPACE.lg },
    [
      el("div", { ...typeStyle("label"), color: p.primaryDark }, title),
      ...items.map((it, i) =>
        el("div", { display: "flex", alignItems: "center", gap: SPACE.md }, [
          el("div", { width: 44, height: 44, borderRadius: 999, backgroundColor: p.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, flexShrink: 0 }, String(i + 1)),
          el("div", { fontSize: 30, fontWeight: 700, color: p.ink, display: "flex", flexGrow: 1, whiteSpace: "pre-wrap" }, it),
        ]),
      ),
    ],
  );
}

/** 表紙のカルーセル導線ヒント(スワイプ誘導)。押せるボタンには見せない */
export function swipeHint(theme: Theme, pages: number): SatoriNode {
  const p = theme.colors;
  return el("div", { display: "flex", alignItems: "center", gap: SPACE.sm }, [
    el("div", { ...typeStyle("label"), color: p.inkMuted }, `全${pages}枚で解説`),
    el("div", { display: "flex", alignItems: "center", gap: 6, color: p.primary, fontSize: 24, fontWeight: 800 }, [
      el("div", { display: "flex" }, "スワイプ"), iconArrow(p.primary, 34),
    ]),
  ]);
}

/** ミニ情報カード(アイコン枠+見出し+補足)。howtoの「今日整えられる要素」等の視覚化 */
export function infoCard(theme: Theme, label: string, title: string, sub: string): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 6, flexBasis: 0, flexGrow: 1, backgroundColor: p.surface, border: `2px solid ${p.line}`, borderRadius: RADIUS.lg, padding: SPACE.lg },
    [
      el("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: RADIUS.md, backgroundColor: p.primarySoft, color: p.primaryDark, fontSize: 26, fontWeight: 800 }, label),
      el("div", { fontSize: 30, fontWeight: 800, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, title),
      el("div", { fontSize: 23, color: p.inkMuted, display: "flex", whiteSpace: "pre-wrap" }, sub),
    ],
  );
}

/** 抽象化した画面枠(検索結果/AI回答など)。実在サービスに見せない抽象UI */
export function screenMock(theme: Theme, caption: string, rows: { strong?: boolean; label: string }[]): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", width: "100%", borderRadius: RADIUS.lg, backgroundColor: "#fff", border: `2px solid ${p.line}`, overflow: "hidden", boxShadow: "0 10px 30px rgba(11,70,184,0.08)" },
    [
      // 検索バー風
      el("div", { display: "flex", alignItems: "center", gap: SPACE.sm, padding: SPACE.md, backgroundColor: p.surfaceDark }, [
        el("div", { width: 22, height: 22, borderRadius: 999, border: `3px solid ${p.inkMuted}`, display: "flex" }, ""),
        el("div", { flexGrow: 1, height: 22, borderRadius: 999, backgroundColor: "#fff", display: "flex" }, ""),
        el("div", { fontSize: 20, fontWeight: 700, color: p.inkMuted, display: "flex" }, caption),
      ]),
      ...rows.map((r) =>
        el("div", { display: "flex", flexDirection: "column", gap: 8, padding: `${SPACE.md}px ${SPACE.lg}px`, borderTop: `2px solid ${p.line}`, backgroundColor: r.strong ? p.primarySoft : "#fff" }, [
          el("div", { fontSize: 24, fontWeight: r.strong ? 800 : 700, color: r.strong ? p.primaryDark : p.ink, display: "flex", whiteSpace: "pre-wrap" }, r.label),
          el("div", { width: r.strong ? "90%" : "60%", height: 12, borderRadius: 999, backgroundColor: p.surfaceDark, display: "flex" }, ""),
        ]),
      ),
    ],
  );
}

/** 縦タイムラインの1ステップ(左に番号丸と縦線、右に見出し+本文) */
export function timelineStep(theme: Theme, n: number, heading: string, bodyText: string, isLast: boolean): SatoriNode {
  const p = theme.colors;
  return el("div", { display: "flex", gap: SPACE.lg, width: "100%" }, [
    el("div", { display: "flex", flexDirection: "column", alignItems: "center", width: 64 }, [
      numberBadge(theme, n, 60),
      isLast ? el("div", { display: "flex" }, "") : el("div", { width: 4, flexGrow: 1, backgroundColor: p.primarySoft, borderRadius: 999, display: "flex", marginTop: 6 }, ""),
    ]),
    el("div", { display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, paddingBottom: isLast ? 0 : SPACE.lg }, [
      el("div", { ...typeStyle("h3", { whiteSpace: "pre-wrap" }), color: p.primaryDark }, heading),
      el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink }, bodyText),
    ]),
  ]);
}

/**
 * Before→After の縦カード(矢印つき)。
 * ラベルは呼び出し側が渡す(既定は「これまで」/「導入後」)。特定トピック固定の
 * ラベルをここで決め打ちすると、HP導入以外のトピックで使う呼び出し元(例: tpl-compare)で
 * 内容と無関係な文言になるため(V7再監査で発見)。
 */
export function beforeAfterCard(theme: Theme, before: string, after: string, labels: { before: string; after: string } = { before: "これまで", after: "導入後" }): SatoriNode {
  const p = theme.colors;
  const cell = (label: string, value: string, tone: "before" | "after"): SatoriNode =>
    el("div", { display: "flex", alignItems: "center", gap: SPACE.md, flexBasis: 0, flexGrow: 1, padding: `${SPACE.md}px ${SPACE.lg}px`, borderRadius: RADIUS.md, backgroundColor: tone === "after" ? p.primarySoft : p.surfaceDark }, [
      tone === "after" ? iconCheck(p.primary, 40) : iconCross(p.inkMuted, 40),
      el("div", { display: "flex", flexDirection: "column" }, [
        el("div", { fontSize: 20, fontWeight: 700, color: p.inkMuted, display: "flex" }, label),
        el("div", { fontSize: 28, fontWeight: 700, color: tone === "after" ? p.primaryDark : p.ink, display: "flex", whiteSpace: "pre-wrap" }, value),
      ]),
    ]);
  return el("div", { display: "flex", alignItems: "center", gap: SPACE.sm, width: "100%" }, [
    cell(labels.before, before, "before"),
    iconArrow(p.primary, 40),
    cell(labels.after, after, "after"),
  ]);
}

/** ラベル付きの具体例/入力例ボックス */
export function exampleBox(theme: Theme, label: string, textVal: string): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: SPACE.xs, width: "100%", backgroundColor: p.surfaceDark, borderRadius: RADIUS.md, padding: SPACE.lg, borderLeft: `${STROKE.bold}px solid ${p.accent}` },
    [
      el("div", { fontSize: 22, fontWeight: 800, color: "#8a5a0a", display: "flex" }, label),
      el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink }, textVal),
    ],
  );
}

/** 小さなチェックリストモジュール(タイトル+項目) */
export function miniChecklist(theme: Theme, title: string, items: string[]): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: SPACE.sm, width: "100%" },
    [
      el("div", { ...typeStyle("label"), color: p.primaryDark }, title),
      ...items.map((it) =>
        el("div", { display: "flex", alignItems: "center", gap: SPACE.sm }, [iconCheck(p.primary, 34), el("div", { fontSize: 26, fontWeight: 700, color: p.ink, display: "flex", flexGrow: 1, whiteSpace: "pre-wrap" }, it)]),
      ),
    ],
  );
}

/** 横方向の変化フロー(事実→変化→影響)。3ノード+矢印 */
export function changeFlow(theme: Theme, nodes: { label: string; text: string }[]): SatoriNode {
  const p = theme.colors;
  const cells: SatoriNode[] = [];
  nodes.forEach((n, i) => {
    cells.push(
      el("div", { display: "flex", flexDirection: "column", gap: 6, flexBasis: 0, flexGrow: 1, backgroundColor: p.surface, border: `2px solid ${p.line}`, borderRadius: RADIUS.md, padding: SPACE.md }, [
        el("div", { fontSize: 21, fontWeight: 800, color: p.primary, display: "flex" }, n.label),
        el("div", { fontSize: 24, fontWeight: 700, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, n.text),
      ]),
    );
    if (i < nodes.length - 1) cells.push(el("div", { display: "flex", alignItems: "center" }, [iconArrow(p.primary, 36)]));
  });
  return el("div", { display: "flex", alignItems: "stretch", gap: SPACE.sm, width: "100%" }, cells);
}

/** 影響リスト(アイコン+見出し+本文の行) */
export function impactList(theme: Theme, rows: { heading: string; text: string }[]): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: SPACE.md, width: "100%" },
    rows.map((r) =>
      el("div", { display: "flex", gap: SPACE.md, alignItems: "flex-start", backgroundColor: p.surface, border: `2px solid ${p.line}`, borderRadius: RADIUS.md, padding: SPACE.lg }, [
        iconArrow(p.primary, 40),
        el("div", { display: "flex", flexDirection: "column", gap: 4, width: CONTENT_WIDTH - 40 - SPACE.md - SPACE.lg * 2 }, [
          el("div", { fontSize: 27, fontWeight: 800, color: p.primaryDark, display: "flex", whiteSpace: "pre-wrap" }, r.heading),
          el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink }, r.text),
        ]),
      ]),
    ),
  );
}

/** 番号付きアクションリスト(今できること) */
export function actionList(theme: Theme, items: string[]): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: SPACE.md, width: "100%" },
    items.map((it, i) =>
      el("div", { display: "flex", gap: SPACE.md, alignItems: "center", backgroundColor: p.primarySoft, borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px` }, [
        numberBadge(theme, i + 1, 52),
        el("div", { fontSize: 28, fontWeight: 700, color: p.ink, display: "flex", flexGrow: 1, whiteSpace: "pre-wrap" }, it),
      ]),
    ),
  );
}

/** 左右分割(事実 vs 見解 など、2つのラベル付きパネル) */
export function splitTwo(theme: Theme, left: { label: string; text: string; tone?: "primary" | "accent" }, right: { label: string; text: string; tone?: "primary" | "accent" }): SatoriNode {
  const p = theme.colors;
  const panel = (d: { label: string; text: string; tone?: "primary" | "accent" }): SatoriNode => {
    const accent = d.tone === "accent";
    return el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, flexBasis: 0, flexGrow: 1, backgroundColor: accent ? p.accentSoft : p.primarySoft, borderRadius: RADIUS.lg, padding: SPACE.lg }, [
      el("div", { fontSize: 24, fontWeight: 800, color: accent ? "#8a5a0a" : p.primaryDark, display: "flex" }, d.label),
      el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink }, d.text),
    ]);
  };
  return el("div", { display: "flex", gap: SPACE.md, width: "100%", alignItems: "stretch" }, [panel(left), panel(right)]);
}

/** 縦のプロセスフロー(課題→判断→設計→実装→確認)。各ノードにラベル+見出し */
export function processFlow(theme: Theme, nodes: { label: string; heading: string }[]): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 0, width: "100%" },
    nodes.map((n, i) =>
      el("div", { display: "flex", gap: SPACE.lg, width: "100%" }, [
        el("div", { display: "flex", flexDirection: "column", alignItems: "center", width: 56 }, [
          el("div", { width: 40, height: 40, borderRadius: 999, backgroundColor: p.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800 }, String(i + 1)),
          i < nodes.length - 1 ? el("div", { width: 4, flexGrow: 1, minHeight: 28, backgroundColor: p.primarySoft, display: "flex" }, "") : el("div", { display: "flex" }, ""),
        ]),
        el("div", { display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, paddingBottom: i < nodes.length - 1 ? SPACE.md : 0 }, [
          el("div", { fontSize: 20, fontWeight: 800, color: p.primary, display: "flex" }, n.label),
          el("div", { fontSize: 28, fontWeight: 700, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, n.heading),
        ]),
      ]),
    ),
  );
}

/** スコアカード(YES件数→判定) */
export function scoreCard(theme: Theme, yes: number, total: number, verdict: string): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", alignItems: "center", gap: SPACE.xl, width: "100%", backgroundColor: p.primary, borderRadius: RADIUS.lg, padding: SPACE.xl },
    [
      el("div", { display: "flex", alignItems: "flex-end", gap: 6 }, [
        el("div", { fontSize: 120, fontWeight: 900, color: "#fff", display: "flex", lineHeight: 1 }, String(yes)),
        el("div", { fontSize: 40, fontWeight: 800, color: "rgba(255,255,255,0.85)", display: "flex", paddingBottom: 16 }, `/${total}`),
      ]),
      el("div", { display: "flex", flexDirection: "column", gap: 6, flexGrow: 1 }, [
        el("div", { fontSize: 24, fontWeight: 700, color: "rgba(255,255,255,0.85)", display: "flex" }, "当てはまった数"),
        el("div", { fontSize: 34, fontWeight: 800, color: "#fff", display: "flex", whiteSpace: "pre-wrap" }, verdict),
      ]),
    ],
  );
}

/** 注釈付き端末モック(モック横に機能の吹き出し) */
export function annotatedMock(theme: Theme, title: string, lines: string[], notes: string[]): SatoriNode {
  const p = theme.colors;
  return el("div", { display: "flex", gap: SPACE.xl, alignItems: "center", width: "100%" }, [
    deviceMock(theme, title, lines),
    el("div", { display: "flex", flexDirection: "column", gap: SPACE.md, flexGrow: 1 }, notes.map((n) =>
      el("div", { display: "flex", alignItems: "flex-start", gap: SPACE.sm }, [
        el("div", { width: 14, height: 14, borderRadius: 999, backgroundColor: p.accent, marginTop: 10, display: "flex", flexShrink: 0 }, ""),
        el("div", { fontSize: 26, fontWeight: 700, color: p.ink, display: "flex", flexGrow: 1, whiteSpace: "pre-wrap" }, n),
      ]),
    )),
  ]);
}

/** 技術タグの列 */
export function techTags(theme: Theme, items: string[]): SatoriNode {
  const p = theme.colors;
  return el(
    "div",
    { display: "flex", flexWrap: "wrap", gap: SPACE.sm },
    items.map((it) =>
      el("div", { backgroundColor: p.primarySoft, color: p.primaryDark, fontSize: 26, fontWeight: 700, padding: "8px 20px", borderRadius: RADIUS.pill, display: "flex" }, it),
    ),
  );
}

export { CANVAS, SAFE, type Theme, type Palette };
