// Production ledger store on Firestore (Native mode) through its REST API.
// Uses `documents:batchGet` for reads and `documents:commit` with
// `currentDocument` preconditions for atomic compare-and-set writes. No
// Firestore SDK; `fetch` and the token supplier are injected for tests.
import { LedgerConflictError, LedgerUnavailableError } from "./errors.ts";
import type {
  LedgerData,
  LedgerDocument,
  LedgerStore,
  LedgerValue,
  LedgerWrite,
} from "./store.ts";

export const FIRESTORE_ENDPOINT = "https://firestore.googleapis.com/v1";
export const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

// Firestore REST value representation (subset used by the ledger).
export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function encodeValue(value: LedgerValue): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new LedgerUnavailableError("ledger numbers must be finite");
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { mapValue: { fields: encodeFields(value) } };
}

export function encodeFields(data: LedgerData): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data))
    fields[key] = encodeValue(value);
  return fields;
}

export function decodeValue(value: FirestoreValue): LedgerValue {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) {
    const number = Number(value.integerValue);
    if (!Number.isSafeInteger(number))
      throw new LedgerUnavailableError(
        `integerValue out of range: ${value.integerValue}`,
      );
    return number;
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  throw new LedgerUnavailableError(
    `unsupported Firestore value: ${Object.keys(value).join(",")}`,
  );
}

export function decodeFields(
  fields: Record<string, FirestoreValue>,
): LedgerData {
  const data: LedgerData = {};
  for (const [key, value] of Object.entries(fields))
    data[key] = decodeValue(value);
  return data;
}

type BatchGetEntry = {
  found?: {
    name: string;
    fields?: Record<string, FirestoreValue>;
    updateTime: string;
  };
  missing?: string;
};

type FirestoreErrorBody = {
  error?: { code?: number; status?: string; message?: string };
};

export type FirestoreStoreOptions = {
  projectId: string;
  databaseId?: string;
  getToken: () => Promise<string>;
  fetchImplementation?: typeof fetch;
  // Per-request timeout; the ledger must answer quickly or fail closed.
  timeoutMs?: number;
  // Attempts for retryable failures (5xx, network errors, timeouts).
  maxAttempts?: number;
  // Injected by tests to skip the backoff.
  sleep?: (ms: number) => Promise<void>;
};

const CONFLICT_STATUSES = new Set([
  "ABORTED",
  "FAILED_PRECONDITION",
  "ALREADY_EXISTS",
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FirestoreLedgerStore implements LedgerStore {
  private readonly documentsUrl: string;
  private readonly documentPrefix: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: FirestoreStoreOptions) {
    const database = `projects/${options.projectId}/databases/${
      options.databaseId ?? "(default)"
    }`;
    this.documentsUrl = `${FIRESTORE_ENDPOINT}/${database}/documents`;
    this.documentPrefix = `${database}/documents/`;
    this.getToken = options.getToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.sleep = options.sleep ?? defaultSleep;
  }

  documentName(docId: string): string {
    return `${this.documentPrefix}${docId}`;
  }

  private docIdOf(name: string): string {
    if (!name.startsWith(this.documentPrefix))
      throw new LedgerUnavailableError(
        `unexpected document name from Firestore: ${name}`,
      );
    return name.slice(this.documentPrefix.length);
  }

  // Sends one RPC with the retry policy: 5xx, network errors and timeouts are
  // retried up to `maxAttempts` with jittered backoff; 401 / 403 fail at once
  // (fail closed); precondition failures surface as `LedgerConflictError`.
  private async call(method: string, body: unknown): Promise<unknown> {
    let token: string;
    try {
      token = await this.getToken();
    } catch (error) {
      throw new LedgerUnavailableError("could not obtain a Firestore token", {
        cause: error,
      });
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1)
        await this.sleep(50 * attempt + Math.floor(Math.random() * 100));
      let response: Response;
      try {
        response = await this.fetchImplementation(
          `${this.documentsUrl}:${method}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );
      } catch (error) {
        lastError = error;
        continue;
      }
      const text = await response.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      if (response.ok) {
        if (parsed === undefined)
          throw new LedgerUnavailableError(
            `Firestore ${method} returned a non-JSON body`,
          );
        return parsed;
      }
      const status = (parsed as FirestoreErrorBody | undefined)?.error?.status;
      const message =
        (parsed as FirestoreErrorBody | undefined)?.error?.message ??
        `HTTP ${response.status}`;
      if (response.status === 409 || (status && CONFLICT_STATUSES.has(status)))
        throw new LedgerConflictError(`Firestore ${method}: ${message}`);
      // A document deleted between read and commit (session TTL) fails its
      // updateTime precondition with NOT_FOUND; re-reading takes the
      // exists:false path. On batchGet a 404 means the database is missing.
      if (
        method === "commit" &&
        (response.status === 404 || status === "NOT_FOUND")
      )
        throw new LedgerConflictError(`Firestore ${method}: ${message}`);
      if (response.status >= 500) {
        lastError = new Error(`Firestore ${method}: ${message}`);
        continue;
      }
      // 400 (malformed request), 401 / 403 (auth), 404 (database missing):
      // retrying cannot help.
      throw new LedgerUnavailableError(
        `Firestore ${method} failed (${response.status} ${status ?? ""}): ${message}`,
      );
    }
    throw new LedgerUnavailableError(
      `Firestore ${method} failed after ${this.maxAttempts} attempts`,
      { cause: lastError },
    );
  }

  async read(
    docIds: string[],
  ): Promise<Map<string, LedgerDocument | undefined>> {
    const result = new Map<string, LedgerDocument | undefined>();
    if (docIds.length === 0) return result;
    const entries = (await this.call("batchGet", {
      documents: docIds.map((docId) => this.documentName(docId)),
    })) as BatchGetEntry[];
    if (!Array.isArray(entries))
      throw new LedgerUnavailableError("Firestore batchGet returned no array");
    for (const docId of docIds) result.set(docId, undefined);
    for (const entry of entries) {
      if (entry.found) {
        result.set(this.docIdOf(entry.found.name), {
          data: decodeFields(entry.found.fields ?? {}),
          updateTime: entry.found.updateTime,
        });
      } else if (entry.missing) {
        result.set(this.docIdOf(entry.missing), undefined);
      }
    }
    return result;
  }

  async commit(writes: LedgerWrite[]): Promise<void> {
    await this.call("commit", {
      writes: writes.map((write) => ({
        update: {
          name: this.documentName(write.docId),
          fields: encodeFields(write.data),
        },
        currentDocument:
          "exists" in write.precondition
            ? { exists: false }
            : { updateTime: write.precondition.updateTime },
      })),
    });
  }
}
