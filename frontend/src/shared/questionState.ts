import { t, type MessageKey } from "./i18n";

// State of one question for one user, as the overview shows it
export type CellState = "think" | "ok" | "fail" | "skip" | "empty";

// Background and text color of each state (skipped questions are yellow).
export const STATE_STYLES: Record<CellState, { background: string; color: string }> = {
  think: { background: "#cdeaff", color: "#044b85" },
  ok: { background: "#d4edda", color: "#155724" },
  fail: { background: "#f8d7da", color: "#721c24" },
  skip: { background: "#fff3cd", color: "#c4790f" },
  empty: { background: "#e9ecef", color: "#6c757d" },
};

const STATE_LABELS: Record<CellState, MessageKey> = {
  think: "state.think",
  ok: "state.ok",
  fail: "state.fail",
  skip: "state.skip",
  empty: "state.empty",
};

export const stateLabel = (state: CellState) => t(STATE_LABELS[state]);

export function formatTime(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
