// Reserve attempts before any asynchronous work so double clicks and failures
// cannot exceed the per-search allowance.
export class PlaceDetailBatch<T extends { place_id: string }> {
  private candidates: T[];
  requestedCount = 0;
  isBusy = false;

  constructor(candidates: T[]) {
    const seen = new Set<string>();
    this.candidates = candidates
      .filter((candidate) => {
        if (seen.has(candidate.place_id)) return false;
        seen.add(candidate.place_id);
        return true;
      })
      .slice(0, 10);
  }

  get remainingCount() {
    return this.candidates.length - this.requestedCount;
  }

  take() {
    if (this.isBusy || this.remainingCount === 0) return [];
    this.isBusy = true;
    const batch = this.candidates.slice(
      this.requestedCount,
      this.requestedCount + 5,
    );
    this.requestedCount += batch.length;
    return batch;
  }

  finish() {
    this.isBusy = false;
  }
}
