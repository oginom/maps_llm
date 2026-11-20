// The same five bins are used for the map, candidate list and distribution.
export const SCORE_COLORS = [
  "#707070",
  "#836d61",
  "#956544",
  "#aa5a29",
  "#bc4d00",
] as const;
export const UNSCORED_COLOR = "#45494c";

export function scoreColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 1 || value > 5)
    return UNSCORED_COLOR;
  return SCORE_COLORS[Math.min(4, Math.floor(value) - 1)];
}
