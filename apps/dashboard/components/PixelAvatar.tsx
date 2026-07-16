import type { JSX } from "react";

interface PixelAvatarProps {
  hue: number;
  ceo?: boolean;
  /** 社員ごとに髪型・髪色を固定するための安定したID */
  seed?: string;
  /** オフィス内を歩く場合は、顔クロップではなく全身SVGを描画する。 */
  fullBody?: boolean;
}

/**
 * V4.6: 代表者が確認したオフィス参照画像から切り出した顔向きの対応表。
 * 50pxの小さなクロップをそのまま拡大し、補間を切ってピクセルの輪郭を守る。
 * 未知のseedは従来の決定的SVGへフォールバックする。
 */
const PORTRAIT_BY_SEED: Record<string, string> = {
  emp_aoi: "/office-v46/faces/05_aoi_face.png",
  emp_ren: "/office-v46/faces/06_riku_face.png",
  emp_rin: "/office-v46/faces/04_minato_face.png",
  emp_sora: "/office-v46/faces/07_yuuki_face.png",
  emp_kotoha: "/office-v46/faces/13_kaoru_face.png",
  emp_tsumugi: "/office-v46/faces/14_momoka_face.png",
  emp_shion: "/office-v46/faces/09_haru_face.png",
  emp_minato: "/office-v46/faces/08_sakura_face.png",
  emp_hinata: "/office-v46/faces/12_meeting_right_face.png",
  "bloom-manager": "/office-v46/faces/03_ceo_face.png",
  "bloom-owner": "/office-v46/faces/03_ceo_face.png",
};

/** seedに対応する顔クロップのパス(なければnull)。歩行キャラの頭に使う */
export function portraitSrc(seed: string): string | null {
  return PORTRAIT_BY_SEED[seed] ?? null;
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
export function PixelAvatar({ hue, ceo = false, seed = String(hue), fullBody = false }: PixelAvatarProps): JSX.Element {
  const portrait = fullBody ? undefined : PORTRAIT_BY_SEED[seed];
  if (portrait) {
    return (
      <span className="sprite sprite--employee sprite--portrait" aria-hidden="true" data-avatar-seed={seed}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={portrait} alt="" width="50" height="50" draggable={false} />
      </span>
    );
  }

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

/**
 * V4.6.2: ポケモン ダイヤモンド・パール風の「オーバーワールド・ドット絵キャラ」。
 * 上から見た3/4視点の小さなピクセル人物。社員ごとに髪色・髪型・アクセントを固定し、
 * 歩行時は2フレームの足パカでピクセルらしく動く(親の data-moving を利用)。
 * 外部画像に依存せず、seed から決定的に同じ見た目を再現する。
 */
export function OverworldSprite({ seed, hue, ceo = false }: { seed: string; hue: number; ceo?: boolean }): JSX.Element {
  const hash = hashSeed(seed);
  const hair = ceo ? HAIR_PALETTES[0] : (HAIR_PALETTES[hash % HAIR_PALETTES.length] ?? HAIR_PALETTES[0]);
  const skin = SKIN_PALETTES[(hash >>> 3) % SKIN_PALETTES.length] ?? SKIN_PALETTES[0];
  const hairStyle = ceo ? 4 : (hash >>> 5) % 5;
  const accent = ceo ? "#e0b64a" : `hsl(${hue} 60% 52%)`;
  const jacket = ceo ? "#12233d" : "#1a3a63";
  const jacketDark = ceo ? "#0a1526" : "#102a49";
  // 髪の形(前髪の落ち方)を髪型で少し変える
  const bangs =
    hairStyle === 1 ? "M4 3H12V6H10V5H6V6H4Z" :
    hairStyle === 2 ? "M4 3H12V7H11V5H5V7H4Z" :
    hairStyle === 3 ? "M4 3H12V6H9V5H7V6H4Z" :
    hairStyle === 4 ? "M4 3H12V5H4Z" :
    "M4 3H12V6H10V5H8V6H6V5H4Z";
  return (
    <svg className="sprite sprite--pixel" viewBox="0 0 16 26" role="img" aria-hidden="true" focusable="false" shapeRendering="crispEdges" data-avatar-seed={seed}>
      {/* 足元の影 */}
      <ellipse cx="8" cy="24.4" rx="5" ry="1.5" fill="rgba(20,34,60,.28)" />
      {/* 髪(後ろ) */}
      <path d="M3 4H13V12H11V10H5V12H3Z" fill={hair.dark} />
      {/* 顔 */}
      <path d="M4 5H12V11H11V12H5V11H4Z" fill={skin.base} />
      <path d="M5 6H11V8H5Z" fill={skin.light} opacity=".6" />
      {/* 前髪(色) */}
      <path d={bangs} fill={hair.base} />
      <path d="M4 3H12V4H4Z" fill={hair.light} opacity=".7" />
      {/* 目 */}
      <rect x="6" y="8" width="1.4" height="2" fill="#16233a" />
      <rect x="9" y="8" width="1.4" height="2" fill="#16233a" />
      {/* ジャケット(体) */}
      <path d="M4 12H12V20H4Z" fill={jacket} />
      <path d="M4 12H8V20H4Z" fill={jacketDark} opacity=".55" />
      {/* シャツ+アクセントの襟 */}
      <path d="M7 12H9V18H7Z" fill="#f4f8fc" />
      <path d="M7 12H9V14H7Z" fill={accent} />
      {/* 腕(袖+手) */}
      <rect x="2.6" y="13" width="1.8" height="5" fill={jacket} />
      <rect x="11.6" y="13" width="1.8" height="5" fill={jacket} />
      <rect x="2.6" y="18" width="1.8" height="1.4" fill={skin.base} />
      <rect x="11.6" y="18" width="1.8" height="1.4" fill={skin.base} />
      {/* 脚(2フレームの足パカ) */}
      <g className="pw-legs pw-legs--a">
        <rect x="5" y="20" width="2.2" height="4" fill="#132238" />
        <rect x="8.8" y="21" width="2.2" height="3" fill="#0f1c2f" />
      </g>
      <g className="pw-legs pw-legs--b">
        <rect x="5" y="21" width="2.2" height="3" fill="#0f1c2f" />
        <rect x="8.8" y="20" width="2.2" height="4" fill="#132238" />
      </g>
    </svg>
  );
}

/**
 * V4.6+: オフィスを歩く「キャラクター」(顔クロップ版。旧V4.6デザイン)。
 * DP風ドット絵に切り替えたため現在は未使用だが、参照用に残す。
 */
export function WalkingCharacter({ seed, hue }: { seed: string; hue: number }): JSX.Element {
  const face = portraitSrc(seed);
  if (!face) {
    return <PixelAvatar hue={hue} seed={seed} fullBody />;
  }
  const accent = `hsl(${hue} 55% 46%)`;
  // 外側に .sprite を付け、既存の状態別モーション(歩行・待機・作業・会議など)をそのまま受ける。
  return (
    <span className="sprite sprite--character" aria-hidden="true" data-char-seed={seed}>
      <span className="office-char">
        <span className="office-char__head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={face} alt="" width={50} height={50} draggable={false} />
        </span>
        {/* 統一された小さな体(全社員共通のBloom-Lジャケット。アクセントだけ社員色) */}
        <svg className="office-char__body" viewBox="0 0 24 22" role="img" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
          <path d="M4 4H9L12 7L15 4H20L22 8V21H2V8Z" fill="#16335c" />
          <path d="M4 4H8L12 7L9 11L6 8V21H2V8Z" fill="#274b78" />
          <path d="M10 4H14L13 21H11Z" fill="#f5f8fc" />
          <path d="M11 5H13L12 9H12Z" fill={accent} />
          <rect x="10" y="10" width="4" height="2" fill={accent} />
          <rect x="2" y="17" width="3" height="4" fill="#e7b48f" />
          <rect x="19" y="17" width="3" height="4" fill="#e7b48f" />
        </svg>
      </span>
    </span>
  );
}
