// Points may be decimals with at most 2 places. Round to kill binary
// float noise from repeated adding of values like 0.1 (mirrors
// normalize_points() on the server).
export function roundPoints(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatPoints(value: unknown): string {
  return String(roundPoints(value));
}
