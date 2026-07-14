import type { JSX } from "react";
import { DISPLAY_LABEL, type DisplayState } from "@core/domain";
import {
  IconSearch,
  IconUsers,
  IconPen,
  IconShield,
  IconStamp,
  IconCheck,
  IconAlert,
  IconPause,
  IconQuestion,
  IconCoffee,
} from "./icons";

const ICONS: Record<DisplayState, (p: { size?: number }) => JSX.Element> = {
  idle: IconCoffee,
  researching: IconSearch,
  meeting: IconUsers,
  creating: IconPen,
  qa: IconShield,
  awaiting_approval: IconStamp,
  done_today: IconCheck,
  error: IconAlert,
  budget_paused: IconPause,
  stale: IconQuestion,
};

export function StatusBadge({ state, suffix, solid }: { state: DisplayState; suffix?: string; solid?: boolean }): JSX.Element {
  const Icon = ICONS[state];
  return (
    <span className={`status-badge${solid ? " status-badge--solid" : ""}`} data-state={state}>
      <Icon size={12} />
      {DISPLAY_LABEL[state]}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}
