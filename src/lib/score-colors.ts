// The same five bins are used for the map, candidate list and distribution.
export const SCORE_COLORS = [
  "#9b503e",
  "#896444",
  "#767044",
  "#4c7968",
  "#246b5b",
] as const;
export const UNSCORED_COLOR = "#68756e";

export function scoreColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 1 || value > 5)
    return UNSCORED_COLOR;
  return SCORE_COLORS[Math.min(4, Math.floor(value) - 1)];
}
