export const EVALUATION_BATCH_SIZE = 5;
export const MAX_EVALUATIONS_PER_SEARCH = 20;

// Check cancellation and budget refusals before starting the next wave.
export async function evaluatePlaceBatches<T extends { placeId: string }>(
  candidates: T[],
  shouldContinue: () => boolean,
  evaluate: (candidate: T) => Promise<void>,
) {
  const seen = new Set<string>();
  const batch: T[] = [];
  for (const candidate of candidates) {
    if (!shouldContinue() || seen.size === MAX_EVALUATIONS_PER_SEARCH) break;
    if (seen.has(candidate.placeId)) continue;
    seen.add(candidate.placeId);
    batch.push(candidate);
    if (batch.length === EVALUATION_BATCH_SIZE) {
      await Promise.all(batch.map(evaluate));
      batch.length = 0;
    }
  }
  if (shouldContinue()) await Promise.all(batch.map(evaluate));
}
