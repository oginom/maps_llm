export type SearchResult = {
  place_id: string;
  name: string;
  address: string;
  rating?: number;
  value?: number;
  reviews?: google.maps.places.PlaceReview[];
  analysis?: string;
  detailsStatus: "pending" | "loading" | "loaded" | "error";
  location: google.maps.LatLng;
  analysisStatus: {
    isAnalyzing: boolean;
    isQueued: boolean;
  };
  examples: string;
  evaluation: string;
  analysisError?: boolean;
  url?: string;
};

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
  if (result.detailsStatus === "error" || result.analysisError) return "failed";
  if (result.detailsStatus === "pending") return "unfetched";
  if (
    result.detailsStatus === "loading" ||
    result.analysisStatus.isAnalyzing ||
    result.analysisStatus.isQueued
  )
    return "fetching";
  return result.value ? "evaluated" : "no-reviews";
}
export const stateLabels = {
  unfetched: "未取得",
  fetching: "取得・評価中",
  evaluated: "評価済み",
  failed: "取得・評価失敗",
  "no-reviews": "口コミなし・未評価",
};
