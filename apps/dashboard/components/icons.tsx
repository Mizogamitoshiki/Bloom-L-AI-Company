/** 一貫したSVGアイコンセット(絵文字を操作アイコンにしない・確定§13)。自作・ライセンス問題なし */
import type { JSX } from "react";

interface IconProps {
  size?: number;
}

function Svg({ children, size = 12 }: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);
export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2" />
    <circle cx="17.5" cy="9" r="2.5" />
    <path d="M19 14.5a4.5 4.5 0 0 1 3 4.5v2" />
  </Svg>
);
export const IconPen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
);
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const IconStamp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21h14" />
    <path d="M6 17h12v-3H6Z" />
    <path d="M12 14V9a3 3 0 1 1 3-3" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 2.5 20h19Z" />
    <line x1="12" y1="9" x2="12" y2="14" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <line x1="10" y1="9" x2="10" y2="15" />
    <line x1="14" y1="9" x2="14" y2="15" />
  </Svg>
);
export const IconQuestion = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" />
    <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconCoffee = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" />
    <path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2" />
  </Svg>
);
