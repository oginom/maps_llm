// In-memory ledger store for unit tests. Yields to the event loop on every
// operation so concurrent reservations interleave the way they do against a
// real backend, which exercises the compare-and-set retry in the ledger.
import { LedgerConflictError } from "./errors.ts";
import type { LedgerDocument, LedgerStore, LedgerWrite } from "./store.ts";

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class MemoryLedgerStore implements LedgerStore {
  private readonly documents = new Map<string, LedgerDocument>();
  private version = 0;
  commitCount = 0;
  conflictCount = 0;

  async read(
    docIds: string[],
  ): Promise<Map<string, LedgerDocument | undefined>> {
    await yieldToEventLoop();
    const result = new Map<string, LedgerDocument | undefined>();
    for (const docId of docIds) {
      const document = this.documents.get(docId);
      result.set(docId, document ? structuredClone(document) : undefined);
    }
    return result;
  }

  async commit(writes: LedgerWrite[]): Promise<void> {
    await yieldToEventLoop();
    for (const write of writes) {
      const existing = this.documents.get(write.docId);
      if ("exists" in write.precondition) {
        if (existing) {
          this.conflictCount += 1;
          throw new LedgerConflictError(`${write.docId} already exists`);
        }
      } else if (
        !existing ||
        existing.updateTime !== write.precondition.updateTime
      ) {
        this.conflictCount += 1;
        throw new LedgerConflictError(`${write.docId} was modified`);
      }
    }
    this.version += 1;
    const updateTime = `v${this.version}`;
    for (const write of writes)
      this.documents.set(write.docId, {
        data: structuredClone(write.data),
        updateTime,
      });
    this.commitCount += 1;
  }

  // Test helper: current data of one document.
  get(docId: string): LedgerDocument | undefined {
    const document = this.documents.get(docId);
    return document ? structuredClone(document) : undefined;
  }
}
