import type { JSX } from "react";

/**
 * ピクセルアートアバター(自作SVG・プレースホルダー。docs/10 D-06)。
 * 8x10グリッドのドット絵。hueで服の色を変える(状態表現には使わない)。
 */
export function PixelAvatar({ hue, ceo = false }: { hue: number; ceo?: boolean }): JSX.Element {
  const skin = "#f2cfa5";
  const hair = ceo ? "#3a2e22" : `hsl(${(hue + 140) % 360} 25% 25%)`;
  const shirt = ceo ? "#37474f" : `hsl(${hue} 45% 45%)`;
  const shirtDark = ceo ? "#263238" : `hsl(${hue} 45% 32%)`;
  const p: [number, number, string][] = [];
  const put = (x: number, y: number, c: string) => p.push([x, y, c]);

  // 髪(y0-1)・顔(y2-3)
  for (let x = 2; x <= 5; x++) put(x, 0, hair);
  put(1, 1, hair); put(6, 1, hair);
  for (let x = 2; x <= 5; x++) put(x, 1, x === 2 || x === 5 ? hair : skin);
  for (let x = 2; x <= 5; x++) put(x, 2, skin);
  put(2, 2, "#22281f"); put(5, 2, "#22281f"); // 目
  for (let x = 2; x <= 5; x++) put(x, 3, skin);
  // 体(y4-7)
  for (let y = 4; y <= 7; y++) {
    for (let x = 1; x <= 6; x++) {
      if (x === 1 || x === 6) put(x, y, skin); // 腕
      else put(x, y, y >= 6 ? shirtDark : shirt);
    }
  }
  if (ceo) { put(3, 4, "#e8a13a"); put(4, 5, "#e8a13a"); } // ネクタイ
  // 脚(y8-9)
  put(2, 8, "#41474e"); put(3, 8, "#41474e"); put(4, 8, "#41474e"); put(5, 8, "#41474e");
  put(2, 9, "#2b2f34"); put(5, 9, "#2b2f34");

  return (
    <svg className="sprite" viewBox="0 0 8 10" role="img" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      {p.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill={c} />
      ))}
    </svg>
  );
}
