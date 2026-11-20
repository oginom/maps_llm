import { MAX_REVIEW_COUNT, MAX_REVIEWS_TEXT_LENGTH } from "./place-dto.ts";

// Only send a prefix: reviewNumber - 1 must still index the original reviews.
export function prepareReviewTexts(
  reviews: readonly { text: string }[],
): string[] {
  const texts: string[] = [];
  let remaining = MAX_REVIEWS_TEXT_LENGTH;
  for (const { text } of reviews.slice(0, MAX_REVIEW_COUNT)) {
    if (!remaining) break;
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Missing review text");
    let prefix = trimmed.slice(0, remaining);
    if (prefix.length < trimmed.length && /[\uD800-\uDBFF]$/.test(prefix))
      prefix = prefix.slice(0, -1);
    if (prefix) texts.push(prefix);
    if (prefix.length < trimmed.length) break;
    remaining -= prefix.length;
  }
  return texts;
}

export type ReviewAnalysis =
  | { value: number; reviewNumbers: number[] }
  | { value: null; reviewNumbers: [] };

export const MAX_EVIDENCE_REVIEWS = 3;

function inRange(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= maximum
  );
}

export function parseReviewAnalysis(
  value: unknown,
  reviewCount: number,
  scale: number,
): ReviewAnalysis {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, "value") &&
    Object.hasOwn(value, "reviewNumbers")
  ) {
    const { value: score, reviewNumbers } = value as Record<string, unknown>;
    if (Array.isArray(reviewNumbers)) {
      if (score === null && reviewNumbers.length === 0)
        return { value: null, reviewNumbers: [] };
      if (
        inRange(score, scale) &&
        reviewNumbers.length >= 1 &&
        reviewNumbers.length <= Math.min(MAX_EVIDENCE_REVIEWS, reviewCount) &&
        Array.from(reviewNumbers).every((number) =>
          inRange(number, reviewCount),
        ) &&
        new Set(reviewNumbers).size === reviewNumbers.length
      )
        return { value: score, reviewNumbers };
    }
  }
  throw new Error("Invalid review analysis");
}
