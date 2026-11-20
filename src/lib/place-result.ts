import type { PlaceDetail } from "./place-dto";

export type SearchResult = PlaceDetail & {
  value?: number | null;
  reviewNumbers?: number[];
  analysis?: string;
  isAnalyzing: boolean;
  examples: string;
  evaluation: string;
  analysisError?: boolean;
};

// Candidates from the chat tool include reviews and attribution, keyed by
// place id with duplicates dropped, ordered as Places returned them.
export function createSearchResults(
  places: PlaceDetail[],
  criteria: { evaluation: string; examples: string },
): Record<string, SearchResult> {
  const results: Record<string, SearchResult> = {};
  for (const place of places) {
    if (results[place.placeId]) continue;
    results[place.placeId] = {
      ...place,
      isAnalyzing: false,
      examples: criteria.examples,
      evaluation: criteria.evaluation,
    };
  }
  return results;
}

export const getRatingColor = (
  rating: number = 3,
  isValue: boolean = false,
) => {
  // Normalize rating between 0 and 1
  const normalizedRating = Math.min(Math.max(rating, 0), 5) / 5;

  // For value, invert the color scale (5 should be blue, 1 should be red)
  const value = isValue ? 1 - normalizedRating : normalizedRating;

  // RGB values for blue (low rating/high value) and red (high rating/low value)
  const startColor = { r: 66, g: 133, b: 244 }; // #4285F4 (blue)
  const endColor = { r: 219, g: 68, b: 55 }; // #DB4437 (red)

  // Interpolate between the colors
  const r = Math.round(startColor.r + (endColor.r - startColor.r) * value);
  const g = Math.round(startColor.g + (endColor.g - startColor.g) * value);
  const b = Math.round(startColor.b + (endColor.b - startColor.b) * value);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

export function resultState(result: SearchResult) {
  if (result.analysisError) return "failed";
  if (result.isAnalyzing) return "analyzing";
  if (result.reviewNumbers?.length === 0) return "unknown";
  if (result.value) return "evaluated";
  return result.reviews.length ? "unevaluated" : "no-reviews";
}
export const stateLabels = {
  unevaluated: "未評価",
  analyzing: "評価中",
  evaluated: "評価済み",
  unknown: "口コミからは判断できません",
  failed: "評価失敗",
  "no-reviews": "口コミなし・未評価",
};
