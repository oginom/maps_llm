import { MAX_EVIDENCE_REVIEWS } from "./review-evidence.ts";

// Request contract: questions use JavaScript string length (UTF-16 units).
// The caller sends only the last three completed exchanges for this place.
export const MAX_PLACE_QUESTION_LENGTH = 300;
export const MAX_PLACE_QUESTION_HISTORY = 3;
export const MAX_PLACE_ANSWER_LENGTH = 1000;
export const PLACE_QUESTION_UNKNOWN_ANSWER =
  "この店舗の口コミからは分かりません。";

export type PlaceAnswer = { answer: string; reviewNumbers: number[] };

export function parsePlaceAnswer(
  value: unknown,
  reviewCount: number,
): PlaceAnswer {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "answer") ||
    !Object.hasOwn(value, "reviewNumbers")
  )
    throw new Error("Invalid place answer");
  const { answer, reviewNumbers } = value as Record<string, unknown>;
  if (
    typeof answer !== "string" ||
    !answer.trim() ||
    answer.length > MAX_PLACE_ANSWER_LENGTH ||
    !Array.isArray(reviewNumbers) ||
    reviewNumbers.length > MAX_EVIDENCE_REVIEWS ||
    !Array.from(reviewNumbers).every(
      (n) => Number.isInteger(n) && n >= 1 && n <= reviewCount,
    ) ||
    new Set(reviewNumbers).size !== reviewNumbers.length
  )
    throw new Error("Invalid place answer");
  if (!reviewNumbers.length)
    return { answer: PLACE_QUESTION_UNKNOWN_ANSWER, reviewNumbers: [] };
  if (answer.trim() === PLACE_QUESTION_UNKNOWN_ANSWER)
    throw new Error("Unexpected evidence for unknown answer");
  return { answer: answer.trim(), reviewNumbers };
}
