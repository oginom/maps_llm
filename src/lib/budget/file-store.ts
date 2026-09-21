// Development ledger store: one JSON file, serialised through an in-process
// mutex, written as temp file + rename. Preconditions are emulated with a
// per-commit `updateTime` token. Not for production: Cloud Run instances
// have no shared durable filesystem, so the constructor refuses to run there.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LedgerConflictError, LedgerUnavailableError } from "./errors.ts";
import type {
  LedgerData,
  LedgerDocument,
  LedgerStore,
  LedgerValue,
  LedgerWrite,
} from "./store.ts";

export const DEFAULT_LEDGER_FILE = join(".ledger", "ledger.json");

type FileContents = { documents: Record<string, LedgerDocument> };

const DATE_TAG = "$date";

// Dates survive the JSON round trip as `{ "$date": "<ISO string>" }`.
function serialise(value: LedgerValue): unknown {
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      result[key] = serialise(entry);
    return result;
  }
  return value;
}

function deserialise(value: unknown): LedgerValue {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record[DATE_TAG] === "string") return new Date(record[DATE_TAG]);
    const result: LedgerData = {};
    for (const [key, entry] of Object.entries(record))
      result[key] = deserialise(entry);
    return result;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  throw new Error(`unsupported ledger value in file: ${typeof value}`);
}

export class FileLedgerStore implements LedgerStore {
  readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private commitSequence = 0;

  constructor(filePath: string = DEFAULT_LEDGER_FILE) {
    if (process.env.NODE_ENV === "production")
      throw new LedgerUnavailableError(
        "LEDGER_BACKEND=file is not allowed in production; set LEDGER_BACKEND=firestore and LEDGER_PROJECT_ID.",
      );
    this.filePath = filePath;
  }

  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<FileContents> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT")
        return { documents: {} };
      throw new LedgerUnavailableError(
        `cannot read ledger file ${this.filePath}`,
        { cause: error },
      );
    }
    let parsed: {
      documents?: Record<string, { data: unknown; updateTime: string }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new LedgerUnavailableError(
        `ledger file ${this.filePath} is not valid JSON`,
        { cause: error },
      );
    }
    const documents: Record<string, LedgerDocument> = {};
    for (const [docId, document] of Object.entries(parsed.documents ?? {}))
      documents[docId] = {
        data: deserialise(document.data) as LedgerData,
        updateTime: document.updateTime,
      };
    return { documents };
  }

  private async save(contents: FileContents): Promise<void> {
    const documents: Record<string, unknown> = {};
    for (const [docId, document] of Object.entries(contents.documents))
      documents[docId] = {
        data: serialise(document.data),
        updateTime: document.updateTime,
      };
    const text = JSON.stringify({ documents }, null, 2);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporaryPath, text, "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      throw new LedgerUnavailableError(
        `cannot write ledger file ${this.filePath}`,
        { cause: error },
      );
    }
  }

  read(docIds: string[]): Promise<Map<string, LedgerDocument | undefined>> {
    return this.withLock(async () => {
      const contents = await this.load();
      const result = new Map<string, LedgerDocument | undefined>();
      for (const docId of docIds) result.set(docId, contents.documents[docId]);
      return result;
    });
  }

  commit(writes: LedgerWrite[]): Promise<void> {
    return this.withLock(async () => {
      const contents = await this.load();
      for (const write of writes) {
        const existing = contents.documents[write.docId];
        if ("exists" in write.precondition) {
          if (existing)
            throw new LedgerConflictError(`${write.docId} already exists`);
        } else if (
          !existing ||
          existing.updateTime !== write.precondition.updateTime
        )
          throw new LedgerConflictError(`${write.docId} was modified`);
      }
      this.commitSequence += 1;
      const updateTime = `${new Date().toISOString()}#${process.pid}#${this.commitSequence}`;
      for (const write of writes)
        contents.documents[write.docId] = { data: write.data, updateTime };
      await this.save(contents);
    });
  }
}
