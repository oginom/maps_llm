// Storage abstraction for the ledger: read documents with their version and
// commit full-document writes guarded by preconditions. Implementations:
// `firestore-store.ts` (production), `file-store.ts` (development) and
// `memory-store.ts` (unit tests).

export type LedgerValue =
  | string
  | number
  | boolean
  | null
  | Date
  | { [key: string]: LedgerValue };

export type LedgerData = { [key: string]: LedgerValue };

export type LedgerDocument = {
  data: LedgerData;
  // Opaque version token; passed back as a precondition when writing.
  updateTime: string;
};

export type LedgerPrecondition = { exists: false } | { updateTime: string };

export type LedgerWrite = {
  // Document path relative to the database root, e.g. `budget_months/2026-09`.
  docId: string;
  data: LedgerData;
  precondition: LedgerPrecondition;
};

export interface LedgerStore {
  // Returns one entry per requested id; `undefined` when the document does
  // not exist.
  read(docIds: string[]): Promise<Map<string, LedgerDocument | undefined>>;
  // Applies all writes atomically. Throws `LedgerConflictError` when any
  // precondition fails and `LedgerUnavailableError` when the backend cannot
  // be reached.
  commit(writes: LedgerWrite[]): Promise<void>;
}

// Precondition for writing back a document that was just read.
export function preconditionFor(
  existing: LedgerDocument | undefined,
): LedgerPrecondition {
  return existing ? { updateTime: existing.updateTime } : { exists: false };
}
