import type { JSX } from "react";

interface PixelAvatarProps {
  hue: number;
  ceo?: boolean;
  /** 社員ごとに髪型・髪色を固定するための安定したID */
  seed?: string;
}

const HAIR_PALETTES = [
  { base: "#172239", dark: "#0d1526", light: "#2e4668" },
  { base: "#3a271f", dark: "#241711", light: "#6b4633" },
  { base: "#1d3448", dark: "#102331", light: "#315d75" },
  { base: "#49303f", dark: "#2d1c29", light: "#754f69" },
  { base: "#5a3924", dark: "#352014", light: "#8d613e" },
  { base: "#26302c", dark: "#151c19", light: "#405148" },
] as const;

const SKIN_PALETTES = [
  { base: "#f1c7a2", light: "#ffdfbf", shade: "#d89d79", blush: "#dc8e86" },
  { base: "#e8b88f", light: "#fbd3ad", shade: "#c98c68", blush: "#cf7f78" },
  { base: "#f4ccb0", light: "#ffe1c8", shade: "#dda485", blush: "#e28f8b" },
] as const;

function hashSeed(value: string): number {
  let hash = 17;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

function Hair({ style, colors }: { style: number; colors: (typeof HAIR_PALETTES)[number] }): JSX.Element {
  const { base, dark, light } = colors;

  if (style === 1) {
    return (
      <g>
        <path d="M6 10V6H8V3H11V1H15V3H19V1H22V4H25V7H27V14H24V10H22V8H10V10H8V15H5V10Z" fill={dark} />
        <path d="M9 5H23V9H19V11H16V8H13V12H9Z" fill={base} />
        <path d="M11 4H18V6H11ZM21 5H24V8H21Z" fill={light} />
      </g>
    );
  }

  if (style === 2) {
    return (
      <g>
        <path d="M6 8H8V4H11V2H22V4H25V8H27V22H23V13H9V22H5V8Z" fill={dark} />
        <path d="M8 6H24V11H20V14H17V10H14V14H9V10H8Z" fill={base} />
        <path d="M11 4H20V6H11ZM22 7H24V15H22Z" fill={light} />
        <rect x="6" y="16" width="3" height="8" fill={base} />
        <rect x="23" y="15" width="3" height="9" fill={base} />
      </g>
    );
  }

  if (style === 3) {
    return (
      <g>
        <path d="M7 10V6H10V3H22V5H25V9H27V17H24V12H9V18H5V10Z" fill={dark} />
        <path d="M9 5H22V8H20V10H17V12H9Z" fill={base} />
        <path d="M12 4H20V6H12ZM21 7H24V9H21Z" fill={light} />
        <path d="M25 9H29V12H31V19H28V21H25V17H27V13H25Z" fill={dark} />
        <rect x="26" y="11" width="3" height="6" fill={base} />
      </g>
    );
  }

  if (style === 4) {
    return (
      <g>
        <path d="M6 11V7H8V4H12V2H24V5H27V12H24V10H10V16H6Z" fill={dark} />
        <path d="M9 5H24V8H20V10H15V12H9Z" fill={base} />
        <path d="M13 4H23V6H16V8H13Z" fill={light} />
        <rect x="23" y="9" width="3" height="8" fill={base} />
      </g>
    );
  }

  return (
    <g>
      <path d="M6 11V7H8V4H12V2H21V4H25V7H27V16H24V11H9V17H5V11Z" fill={dark} />
      <path d="M9 5H23V8H21V10H18V12H15V9H12V13H9Z" fill={base} />
      <path d="M12 4H20V6H12ZM21 6H24V9H21Z" fill={light} />
      <rect x="6" y="13" width="3" height="7" fill={base} />
    </g>
  );
}

/**
 * 社員用の32×40オリジナルSVGピクセルアバター。
 * 外部画像に依存せず、seedから同じ人物デザインを決定的に再現する。
 */
export function PixelAvatar({ hue, ceo = false, seed = String(hue) }: PixelAvatarProps): JSX.Element {
  const hash = hashSeed(seed);
  const hair = ceo ? HAIR_PALETTES[0] : (HAIR_PALETTES[hash % HAIR_PALETTES.length] ?? HAIR_PALETTES[0]);
  const skin = SKIN_PALETTES[(hash >>> 3) % SKIN_PALETTES.length] ?? SKIN_PALETTES[0];
  const hairStyle = ceo ? 4 : (hash >>> 5) % 5;
  const accent = ceo ? "#d99a32" : `hsl(${hue} 52% 48%)`;
  const jacket = ceo ? "#142946" : "#19375e";
  const jacketLight = ceo ? "#274b75" : "#2b5486";
  const jacketDark = ceo ? "#0b1b31" : "#102641";

  return (
    <svg
      className="sprite sprite--employee"
      viewBox="0 0 32 40"
      role="img"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      data-avatar-style={hairStyle}
    >
      {/* 足元のピクセル影 */}
      <path d="M6 37H26V39H23V40H9V39H6Z" fill="#6f7c8f" opacity=".35" />

      {/* 髪の後ろ側 */}
      <path d="M7 8H25V18H23V23H9V19H7Z" fill={hair.dark} />

      {/* 耳・顔。顎を2段階で絞り、旧版の四角い輪郭を解消 */}
      <rect x="7" y="12" width="3" height="7" fill={skin.shade} />
      <rect x="22" y="12" width="3" height="7" fill={skin.shade} />
      <path d="M9 8H23V18H21V21H19V23H13V21H11V18H9Z" fill={skin.base} />
      <path d="M10 9H22V12H10Z" fill={skin.light} opacity=".72" />
      <rect x="20" y="12" width="2" height="7" fill={skin.shade} opacity=".45" />

      <Hair style={hairStyle} colors={hair} />

      {/* 眉・目・ハイライト */}
      <rect x="11" y="12" width="4" height="1" fill={hair.dark} />
      <rect x="18" y="12" width="4" height="1" fill={hair.dark} />
      <rect x="11" y="14" width="4" height="3" fill="#f8fbff" />
      <rect x="18" y="14" width="4" height="3" fill="#f8fbff" />
      <rect x="12" y="14" width="2" height="3" fill="#17243a" />
      <rect x="19" y="14" width="2" height="3" fill="#17243a" />
      <rect x="12" y="14" width="1" height="1" fill="#8fc8ff" />
      <rect x="19" y="14" width="1" height="1" fill="#8fc8ff" />

      {/* 鼻・頬・口 */}
      <rect x="16" y="17" width="1" height="2" fill={skin.shade} />
      <rect x="10" y="18" width="2" height="1" fill={skin.blush} opacity=".72" />
      <rect x="21" y="18" width="2" height="1" fill={skin.blush} opacity=".72" />
      <path d="M14 20H19V21H18V22H15V21H14Z" fill="#9b4e57" />

      {/* 首 */}
      <rect x="14" y="22" width="5" height="4" fill={skin.shade} />
      <rect x="15" y="22" width="4" height="3" fill={skin.base} />

      {/* ビジネスジャケット。全員を同じ会社のチームとして統一 */}
      <path d="M10 24H13L16 27L19 24H22L27 28V36H5V28Z" fill={jacketDark} />
      <path d="M10 24H14L16 27L13 31L10 28V36H5V28Z" fill={jacketLight} />
      <path d="M18 24H22L27 28V36H22V28L19 31L16 27Z" fill={jacket} />
      <path d="M14 24H19L18 32H14Z" fill="#f5f8fc" />
      <path d="M15 25H18L17 28H16Z" fill={accent} />
      <path d="M16 28H17L18 33H15Z" fill={accent} />
      <rect x="7" y="30" width="2" height="4" fill={jacketLight} />
      <rect x="23" y="30" width="2" height="4" fill={jacket} />
      <rect x="4" y="34" width="4" height="2" fill={skin.base} />
      <rect x="24" y="34" width="4" height="2" fill={skin.base} />

      {/* パンツと靴 */}
      <path d="M10 36H22V39H19V40H17V37H15V40H12V39H10Z" fill="#111d30" />
      <rect x="8" y="39" width="7" height="1" fill="#080d17" />
      <rect x="17" y="39" width="7" height="1" fill="#080d17" />
    </svg>
  );
}
