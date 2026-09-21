// Budget ledger: reserve before a paid upstream call, settle after it.
//
// Documents (see docs/budget-ledger.md):
//   budget_months/{YYYY-MM}   month counters (UTC calendar month)
//   budget_sessions/{id}      session counters, the current run's counters
//                             and the pending reservations of the session
//
// Every operation reads the documents it touches, computes the new state and
// commits all writes with preconditions; on a precondition conflict it
// re-reads and retries. Nothing is counted in process memory.
import {
  BUDGET_TYPES,
  PENDING_SWEEP_AFTER_MS,
  SESSION_TTL_MS,
  GOOGLE_LIST_PRICE_MICROS,
  getBudgetCaps,
  isGoogleType,
  isOpenAiType,
  reserveAmount,
  type BudgetCaps,
  type BudgetScope,
  type BudgetType,
} from "./config.ts";
import {
  BudgetExceededError,
  LedgerConflictError,
  LedgerUnavailableError,
} from "./errors.ts";
import { preconditionFor } from "./store.ts";
import type {
  LedgerData,
  LedgerDocument,
  LedgerStore,
  LedgerValue,
  LedgerWrite,
} from "./store.ts";

export type BudgetRequestContext = { sessionId: string; runId: string };

export type Reservation = {
  id: string;
  type: BudgetType;
  sessionId: string;
  runId: string;
  monthId: string;
  count: number;
  // Estimated micro-USD (0 for Google types).
  micros: number;
};

// `release`: the upstream request was never sent (nothing is charged).
// `settle`: the request was sent; `micros` is the actual OpenAI cost when
// known, otherwise the estimate is charged.
export type SettleOutcome =
  | { kind: "release" }
  | { kind: "settle"; micros?: number };

type Counters = {
  counts: Partial<Record<BudgetType, number>>;
  reservedCounts: Partial<Record<BudgetType, number>>;
  settledMicros: number;
  reservedMicros: number;
};

type MonthState = Counters & { listPriceMicros: number; updatedAt: Date };
type RunState = Counters & { runId: string };
type PendingEntry = {
  type: BudgetType;
  count: number;
  micros: number;
  month: string;
  runId: string;
  at: Date;
};
type SessionState = Counters & {
  createdAt: Date;
  expiresAt: Date;
  run: RunState;
  // The run before `run`. A request of that run arriving after the switch
  // (in flight while the browser started a new search) must not reset the
  // run counters again; it is counted against session and month only.
  previousRunId: string;
  pending: Record<string, PendingEntry>;
};

export function monthIdFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function monthDocId(monthId: string): string {
  return `budget_months/${monthId}`;
}

export function sessionDocId(sessionId: string): string {
  return `budget_sessions/${sessionId}`;
}

// ---------------------------------------------------------------------------
// Document <-> state conversion. Reading is lenient (missing fields are 0)
// so a document written by an older revision never blocks reservations.

function numberOf(value: LedgerValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateOf(value: LedgerValue | undefined, fallback: Date): Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : fallback;
}

function mapOf(value: LedgerValue | undefined): LedgerData {
  return typeof value === "object" && value !== null && !(value instanceof Date)
    ? value
    : {};
}

function isBudgetType(value: unknown): value is BudgetType {
  return (
    typeof value === "string" && BUDGET_TYPES.includes(value as BudgetType)
  );
}

function countsOf(
  value: LedgerValue | undefined,
): Partial<Record<BudgetType, number>> {
  const counts: Partial<Record<BudgetType, number>> = {};
  for (const [key, entry] of Object.entries(mapOf(value)))
    if (isBudgetType(key)) counts[key] = numberOf(entry);
  return counts;
}

function emptyCounters(): Counters {
  return {
    counts: {},
    reservedCounts: {},
    settledMicros: 0,
    reservedMicros: 0,
  };
}

function countersOf(data: LedgerData): Counters {
  return {
    counts: countsOf(data.counts),
    reservedCounts: countsOf(data.reservedCounts),
    settledMicros: numberOf(data.settledMicros),
    reservedMicros: numberOf(data.reservedMicros),
  };
}

function countersToData(counters: Counters): LedgerData {
  return {
    counts: { ...counters.counts } as LedgerData,
    reservedCounts: { ...counters.reservedCounts } as LedgerData,
    settledMicros: counters.settledMicros,
    reservedMicros: counters.reservedMicros,
  };
}

function monthStateOf(
  document: LedgerDocument | undefined,
  now: Date,
): MonthState {
  const data = document?.data ?? {};
  return {
    ...countersOf(data),
    listPriceMicros: numberOf(data.listPriceMicros),
    updatedAt: now,
  };
}

function monthStateToData(state: MonthState): LedgerData {
  return {
    ...countersToData(state),
    listPriceMicros: state.listPriceMicros,
    updatedAt: state.updatedAt,
  };
}

function newRun(runId: string): RunState {
  return { ...emptyCounters(), runId };
}

function sessionStateOf(
  document: LedgerDocument | undefined,
  runId: string,
  now: Date,
): SessionState {
  if (!document)
    return {
      ...emptyCounters(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      run: newRun(runId),
      previousRunId: "",
      pending: {},
    };
  const data = document.data;
  const runData = mapOf(data.run);
  const pending: Record<string, PendingEntry> = {};
  for (const [id, raw] of Object.entries(mapOf(data.pending))) {
    const entry = mapOf(raw);
    if (!isBudgetType(entry.type) || typeof entry.month !== "string") continue;
    pending[id] = {
      type: entry.type,
      count: numberOf(entry.count),
      micros: numberOf(entry.micros),
      month: entry.month,
      runId: typeof entry.runId === "string" ? entry.runId : "",
      at: dateOf(entry.at, now),
    };
  }
  return {
    ...countersOf(data),
    createdAt: dateOf(data.createdAt, now),
    expiresAt: dateOf(data.expiresAt, new Date(now.getTime() + SESSION_TTL_MS)),
    run: {
      ...countersOf(runData),
      runId: typeof runData.runId === "string" ? runData.runId : "",
    },
    previousRunId:
      typeof data.previousRunId === "string" ? data.previousRunId : "",
    pending,
  };
}

function sessionStateToData(state: SessionState): LedgerData {
  const pending: LedgerData = {};
  for (const [id, entry] of Object.entries(state.pending))
    pending[id] = {
      type: entry.type,
      count: entry.count,
      micros: entry.micros,
      month: entry.month,
      runId: entry.runId,
      at: entry.at,
    };
  return {
    ...countersToData(state),
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    run: { ...countersToData(state.run), runId: state.run.runId },
    previousRunId: state.previousRunId,
    pending,
  };
}

// Every session write pushes the TTL out so a long-lived tab is not deleted
// mid-use.
function touchSession(session: SessionState, now: Date) {
  session.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
}

// ---------------------------------------------------------------------------
// Counter arithmetic.

type Amount = { count: number; micros: number };

function addCount(
  counts: Partial<Record<BudgetType, number>>,
  type: BudgetType,
  delta: number,
) {
  counts[type] = Math.max(0, (counts[type] ?? 0) + delta);
}

function applyReserve(counters: Counters, type: BudgetType, amount: Amount) {
  addCount(counters.reservedCounts, type, amount.count);
  counters.reservedMicros += amount.micros;
}

function applyRelease(counters: Counters, type: BudgetType, amount: Amount) {
  addCount(counters.reservedCounts, type, -amount.count);
  counters.reservedMicros = Math.max(
    0,
    counters.reservedMicros - amount.micros,
  );
}

function applySettle(
  counters: Counters,
  type: BudgetType,
  amount: Amount,
  actualMicros: number,
) {
  applyRelease(counters, type, amount);
  addCount(counters.counts, type, amount.count);
  counters.settledMicros += actualMicros;
}

function used(counters: Counters, type: BudgetType): number {
  if (isOpenAiType(type))
    return counters.settledMicros + counters.reservedMicros;
  return (counters.counts[type] ?? 0) + (counters.reservedCounts[type] ?? 0);
}

function capFor(
  caps: BudgetCaps,
  scope: BudgetScope,
  type: BudgetType,
): number {
  return isOpenAiType(type) ? caps[scope].openaiMicros : caps[scope][type];
}

function increment(type: BudgetType, amount: Amount): number {
  return isOpenAiType(type) ? amount.micros : amount.count;
}

// ---------------------------------------------------------------------------

export type LedgerOptions = {
  store: LedgerStore;
  caps?: BudgetCaps;
  now?: () => Date;
  // Attempts of the read-compute-commit loop on precondition conflicts.
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
  // Serialise reserve / settle inside this process (default true). Cloud Run
  // runs one instance, so this removes almost all precondition conflicts;
  // the CAS loop remains the safety net across instances. Tests set it to
  // false to exercise the conflict path.
  serializeInProcess?: boolean;
};

export class Ledger {
  private readonly store: LedgerStore;
  private readonly caps: BudgetCaps;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newId: () => string;
  private readonly serializeInProcess: boolean;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: LedgerOptions) {
    this.store = options.store;
    this.caps = options.caps ?? getBudgetCaps();
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? 15;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.serializeInProcess = options.serializeInProcess ?? true;
  }

  // In-process mutex: one read-compute-commit at a time per process.
  private withMutex<T>(task: () => Promise<T>): Promise<T> {
    if (!this.serializeInProcess) return task();
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private withRetry<T>(
    operation: string,
    attempt: () => Promise<T>,
  ): Promise<T> {
    return this.withMutex(async () => {
      let lastError: unknown;
      for (let index = 1; index <= this.maxAttempts; index += 1) {
        if (index > 1)
          await this.sleep(10 * index + Math.floor(Math.random() * 150));
        try {
          return await attempt();
        } catch (error) {
          if (!(error instanceof LedgerConflictError)) throw error;
          lastError = error;
        }
      }
      throw new LedgerUnavailableError(
        `ledger ${operation} failed after ${this.maxAttempts} attempts because of concurrent updates`,
        { cause: lastError },
      );
    });
  }

  // Reserves one call of `type` for the session / run in `context`, or throws
  // `BudgetExceededError` (cap) / `LedgerUnavailableError` (backend).
  reserve(
    context: BudgetRequestContext,
    type: BudgetType,
  ): Promise<Reservation> {
    return this.withRetry("reserve", async () => {
      const now = this.now();
      const monthId = monthIdFor(now);
      const sessionId = sessionDocId(context.sessionId);
      const documents = await this.store.read([sessionId, monthDocId(monthId)]);
      const session = sessionStateOf(
        documents.get(sessionId),
        context.runId,
        now,
      );

      // Crash recovery: pending reservations older than the sweep window are
      // settled at their estimate. Their months may differ from the current
      // month, so read those documents too before computing.
      const staleIds = Object.keys(session.pending).filter(
        (id) =>
          now.getTime() - session.pending[id].at.getTime() >=
          PENDING_SWEEP_AFTER_MS,
      );
      const extraMonths = [
        ...new Set(
          staleIds
            .map((id) => session.pending[id].month)
            .filter((month) => month !== monthId),
        ),
      ];
      if (extraMonths.length > 0) {
        const extra = await this.store.read(extraMonths.map(monthDocId));
        for (const [docId, document] of extra) documents.set(docId, document);
      }
      const months = new Map<string, MonthState>();
      const monthState = (id: string) => {
        let state = months.get(id);
        if (!state) {
          state = monthStateOf(documents.get(monthDocId(id)), now);
          months.set(id, state);
        }
        return state;
      };
      for (const id of staleIds) {
        const entry = session.pending[id];
        const amount = { count: entry.count, micros: entry.micros };
        const listPrice = isGoogleType(entry.type)
          ? GOOGLE_LIST_PRICE_MICROS[entry.type] * entry.count
          : 0;
        applySettle(session, entry.type, amount, entry.micros);
        // The run that made the reservation may already be gone.
        if (session.run.runId === entry.runId)
          applySettle(session.run, entry.type, amount, entry.micros);
        const month = monthState(entry.month);
        applySettle(month, entry.type, amount, entry.micros);
        month.listPriceMicros += listPrice;
        delete session.pending[id];
        console.warn(
          `[budget] swept stale reservation ${id} type=${entry.type} session=${context.sessionId}`,
        );
      }

      // A request of the previous run that arrives after the browser started
      // a new run is stale: it is counted against session and month only and
      // must not reset the current run's counters.
      const isStaleRun =
        context.runId !== session.run.runId &&
        context.runId === session.previousRunId;
      if (context.runId !== session.run.runId && !isStaleRun) {
        session.previousRunId = session.run.runId;
        session.run = newRun(context.runId);
      }
      if (isStaleRun)
        console.warn(
          `[budget] reserve for the previous run ${context.runId} after run ${session.run.runId} started; counted against session and month only`,
        );

      const amount = reserveAmount(type);
      const currentMonth = monthState(monthId);
      const scopes: Array<[BudgetScope, Counters]> = [
        ["month", currentMonth],
        ["session", session],
      ];
      if (!isStaleRun) scopes.push(["run", session.run]);
      for (const [scope, counters] of scopes)
        if (
          used(counters, type) + increment(type, amount) >
          capFor(this.caps, scope, type)
        )
          throw new BudgetExceededError(scope, type);

      const id = this.newId();
      for (const [, counters] of scopes) applyReserve(counters, type, amount);
      session.pending[id] = {
        type,
        ...amount,
        month: monthId,
        runId: context.runId,
        at: now,
      };

      touchSession(session, now);
      const writes: LedgerWrite[] = [
        {
          docId: sessionId,
          data: sessionStateToData(session),
          precondition: preconditionFor(documents.get(sessionId)),
        },
      ];
      for (const [id, state] of months)
        writes.push({
          docId: monthDocId(id),
          data: monthStateToData(state),
          precondition: preconditionFor(documents.get(monthDocId(id))),
        });
      await this.store.commit(writes);
      return {
        id,
        type,
        sessionId: context.sessionId,
        runId: context.runId,
        monthId,
        ...amount,
      };
    });
  }

  // Moves a reservation from reserved to settled (or releases it). A
  // reservation that is no longer pending (already settled or swept) is a
  // no-op.
  settle(reservation: Reservation, outcome: SettleOutcome): Promise<void> {
    return this.withRetry("settle", async () => {
      const now = this.now();
      const sessionId = sessionDocId(reservation.sessionId);
      const monthDoc = monthDocId(reservation.monthId);
      const documents = await this.store.read([sessionId, monthDoc]);
      const sessionDocument = documents.get(sessionId);
      if (!sessionDocument) {
        console.warn(
          `[budget] settle: session ${reservation.sessionId} not found; reservation ${reservation.id} dropped`,
        );
        return;
      }
      const session = sessionStateOf(sessionDocument, reservation.runId, now);
      if (!session.pending[reservation.id]) {
        console.warn(
          `[budget] settle: reservation ${reservation.id} is no longer pending`,
        );
        return;
      }
      const month = monthStateOf(documents.get(monthDoc), now);
      const amount = { count: reservation.count, micros: reservation.micros };
      const runMatches = session.run.runId === reservation.runId;
      if (outcome.kind === "release") {
        applyRelease(session, reservation.type, amount);
        if (runMatches) applyRelease(session.run, reservation.type, amount);
        applyRelease(month, reservation.type, amount);
      } else {
        const actualMicros = isOpenAiType(reservation.type)
          ? (outcome.micros ?? reservation.micros)
          : 0;
        applySettle(session, reservation.type, amount, actualMicros);
        if (runMatches)
          applySettle(session.run, reservation.type, amount, actualMicros);
        applySettle(month, reservation.type, amount, actualMicros);
        if (isGoogleType(reservation.type))
          month.listPriceMicros +=
            GOOGLE_LIST_PRICE_MICROS[reservation.type] * reservation.count;
      }
      delete session.pending[reservation.id];
      touchSession(session, now);
      await this.store.commit([
        {
          docId: sessionId,
          data: sessionStateToData(session),
          precondition: preconditionFor(sessionDocument),
        },
        {
          docId: monthDoc,
          data: monthStateToData(month),
          precondition: preconditionFor(documents.get(monthDoc)),
        },
      ]);
    });
  }
}

// ---------------------------------------------------------------------------
// Backend selection for the route handlers (`LEDGER_BACKEND`).

let ledgerPromise: Promise<Ledger> | undefined;

async function createConfiguredLedger(): Promise<Ledger> {
  const backend = process.env.LEDGER_BACKEND;
  const isProduction = process.env.NODE_ENV === "production";
  if (backend === "firestore") {
    const projectId = process.env.LEDGER_PROJECT_ID;
    if (!projectId)
      throw new LedgerUnavailableError(
        "LEDGER_BACKEND=firestore requires LEDGER_PROJECT_ID.",
      );
    const [{ GoogleAuth }, { FirestoreLedgerStore, FIRESTORE_SCOPE }] =
      await Promise.all([
        import("google-auth-library"),
        import("./firestore-store.ts"),
      ]);
    const auth = new GoogleAuth({ scopes: [FIRESTORE_SCOPE] });
    const store = new FirestoreLedgerStore({
      projectId,
      getToken: async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new Error("GoogleAuth returned no access token");
        return token;
      },
    });
    console.log(`[budget] ledger backend: firestore (project ${projectId})`);
    return new Ledger({ store });
  }
  if (backend === "file" || (backend === undefined && !isProduction)) {
    const { FileLedgerStore, DEFAULT_LEDGER_FILE } = await import(
      "./file-store.ts"
    );
    const filePath = process.env.LEDGER_FILE || DEFAULT_LEDGER_FILE;
    const store = new FileLedgerStore(filePath);
    console.log(
      `[budget] ledger backend: file (${filePath})${
        backend === undefined
          ? " because LEDGER_BACKEND is unset in development"
          : ""
      }`,
    );
    return new Ledger({ store });
  }
  if (backend === undefined)
    throw new LedgerUnavailableError(
      "LEDGER_BACKEND is not set. Set LEDGER_BACKEND=firestore and LEDGER_PROJECT_ID in production.",
    );
  throw new LedgerUnavailableError(
    `LEDGER_BACKEND=${backend} is not supported (use firestore or file).`,
  );
}

// Configuration failures are logged and not cached so the log line repeats
// for every refused call.
export function getLedger(): Promise<Ledger> {
  if (!ledgerPromise)
    ledgerPromise = createConfiguredLedger().catch((error) => {
      ledgerPromise = undefined;
      console.error(
        `[budget] ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    });
  return ledgerPromise;
}

export async function reserveBudget(
  context: BudgetRequestContext,
  type: BudgetType,
): Promise<Reservation> {
  const ledger = await getLedger();
  return ledger.reserve(context, type);
}

// Settle failures are logged only: the pending sweep recovers the amount at
// its estimate on the session's next reservation.
export async function settleReservation(
  reservation: Reservation,
  outcome: SettleOutcome,
): Promise<void> {
  try {
    const ledger = await getLedger();
    await ledger.settle(reservation, outcome);
  } catch (error) {
    console.error(
      `[budget] settle failed for reservation ${reservation.id} type=${reservation.type}`,
      error,
    );
  }
}
