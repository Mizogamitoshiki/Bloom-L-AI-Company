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

// --- V3 UI Polish: ナビ/シェル用アイコン ---
export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v9h5v-6h4v6h5v-9" />
  </Svg>
);
export const IconKanban = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v9M16 4v6" />
  </Svg>
);
export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </Svg>
);
export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </Svg>
);
export const IconReport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h9l4 4v14a0 0 0 0 1 0 0H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);
export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V6M4 20h16" />
    <path d="M8 16v-4M12 16V8M16 16v-6M20 16v-9" />
  </Svg>
);
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2l-.3-2.5H8.7l-.3 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 4 12l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.3 2.4h4.6l.3-2.4a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
  </Svg>
);
export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
);
export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);
export const IconBuilding = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="1.5" />
    <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
  </Svg>
);
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    <path d="m6 6 3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />
  </Svg>
);

export const IconExport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
  </Svg>
);
export const IconMeeting = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="7" r="3" />
    <path d="M5 21v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
    <path d="M2 12h3M19 12h3" />
  </Svg>
);
export const IconTemplate = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="18" rx="1" />
    <rect x="14" y="3" width="7" height="8" rx="1" />
    <rect x="14" y="15" width="7" height="6" rx="1" />
  </Svg>
);
/** V10.2: サイトサンプル(ブラウザ枠+ヒーロー+2カラム) */
export const IconLayout = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 9v11" />
    <path d="M13 14h5" />
  </Svg>
);
