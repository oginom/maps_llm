import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BUDGET_CAPS,
  GOOGLE_LIST_PRICE_MICROS,
  OPENAI_RESERVE_MICROS,
  openAiCostMicros,
  resolveBudgetCaps,
} from "./config.ts";
import { BudgetExceededError, LedgerUnavailableError } from "./errors.ts";
import { Ledger, monthIdFor, sessionDocId, monthDocId } from "./ledger.ts";
import { MemoryLedgerStore } from "./memory-store.ts";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN_A = "22222222-2222-4222-8222-222222222222";
const RUN_B = "33333333-3333-4333-8333-333333333333";

function caps(overrides = {}) {
  return {
    month: { ...DEFAULT_BUDGET_CAPS.month, ...overrides.month },
    session: { ...DEFAULT_BUDGET_CAPS.session, ...overrides.session },
    run: { ...DEFAULT_BUDGET_CAPS.run, ...overrides.run },
  };
}

function createLedger({
  store = new MemoryLedgerStore(),
  caps: c,
  clock,
} = {}) {
  const ledger = new Ledger({
    store,
    caps: c ?? caps(),
    now: () => new Date(clock?.value ?? "2026-09-21T10:00:00Z"),
    sleep: async () => {},
  });
  return { ledger, store };
}

test("price constants match the design", () => {
  assert.equal(openAiCostMicros(1_000_000, 0), 200_000);
  assert.equal(openAiCostMicros(0, 1_000_000), 1_200_000);
  assert.equal(OPENAI_RESERVE_MICROS["openai.analyze"], 2_800);
  assert.equal(OPENAI_RESERVE_MICROS["openai.examples"], 1_560);
  assert.equal(GOOGLE_LIST_PRICE_MICROS["places.search"], 32_000);
  assert.equal(GOOGLE_LIST_PRICE_MICROS["places.details"], 25_000);
});

test("BUDGET_CAPS_JSON overrides merge over the defaults and reject junk", () => {
  const merged = resolveBudgetCaps('{"run":{"places.details":3}}');
  assert.equal(merged.run["places.details"], 3);
  assert.equal(merged.run.openaiMicros, DEFAULT_BUDGET_CAPS.run.openaiMicros);
  assert.equal(merged.month["places.search"], 60);
  assert.throws(() => resolveBudgetCaps("{"), /valid JSON/);
  assert.throws(() => resolveBudgetCaps('{"day":{}}'), /invalid/);
  assert.throws(
    () => resolveBudgetCaps('{"run":{"openaiMicros":-1}}'),
    /invalid/,
  );
});

test("reserve then settle a Google call: units and list price", async () => {
  const { ledger, store } = createLedger();
  const reservation = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "places.search",
  );
  assert.equal(reservation.count, 1);
  assert.equal(reservation.micros, 0);
  assert.equal(reservation.monthId, "2026-09");
  let session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.reservedCounts["places.search"], 1);
  assert.equal(session.run.runId, RUN_A);
  assert.equal(Object.keys(session.pending).length, 1);
  assert.equal(session.pending[reservation.id].type, "places.search");
  assert.ok(session.expiresAt instanceof Date);
  assert.equal(
    session.expiresAt.getTime() - session.createdAt.getTime(),
    2 * 24 * 60 * 60 * 1000,
  );

  await ledger.settle(reservation, { kind: "settle" });
  session = store.get(sessionDocId(SESSION)).data;
  const month = store.get(monthDocId("2026-09")).data;
  assert.equal(session.counts["places.search"], 1);
  assert.equal(session.reservedCounts["places.search"], 0);
  assert.equal(session.run.counts["places.search"], 1);
  assert.deepEqual(session.pending, {});
  assert.equal(month.counts["places.search"], 1);
  assert.equal(month.reservedCounts["places.search"], 0);
  assert.equal(month.listPriceMicros, 32_000);
  assert.equal(month.settledMicros, 0);
});

test("settling below the estimate returns headroom", async () => {
  const { ledger, store } = createLedger();
  const context = { sessionId: SESSION, runId: RUN_A };
  const reservation = await ledger.reserve(context, "openai.analyze");
  assert.equal(reservation.micros, 2_800);
  let month = store.get(monthDocId("2026-09")).data;
  assert.equal(month.reservedMicros, 2_800);
  await ledger.settle(reservation, { kind: "settle", micros: 1_000 });
  month = store.get(monthDocId("2026-09")).data;
  const session = store.get(sessionDocId(SESSION)).data;
  assert.equal(month.reservedMicros, 0);
  assert.equal(month.settledMicros, 1_000);
  assert.equal(month.counts["openai.analyze"], 1);
  assert.equal(session.settledMicros, 1_000);
  assert.equal(session.run.settledMicros, 1_000);
  // Google list price is not touched by OpenAI settlements.
  assert.equal(month.listPriceMicros, 0);
});

test("settling without usage charges the estimate", async () => {
  const { ledger, store } = createLedger();
  const reservation = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "openai.examples",
  );
  await ledger.settle(reservation, { kind: "settle" });
  const month = store.get(monthDocId("2026-09")).data;
  assert.equal(month.settledMicros, 1_560);
  assert.equal(month.reservedMicros, 0);
});

test("release removes the reservation without counting a call", async () => {
  const { ledger, store } = createLedger();
  const reservation = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "places.details",
  );
  await ledger.settle(reservation, { kind: "release" });
  const month = store.get(monthDocId("2026-09")).data;
  const session = store.get(sessionDocId(SESSION)).data;
  assert.equal(month.counts["places.details"] ?? 0, 0);
  assert.equal(month.reservedCounts["places.details"], 0);
  assert.equal(month.listPriceMicros, 0);
  assert.equal(session.reservedCounts["places.details"], 0);
  assert.deepEqual(session.pending, {});
  // Settling twice is a no-op.
  await ledger.settle(reservation, { kind: "settle" });
  assert.equal(
    store.get(monthDocId("2026-09")).data.counts["places.details"] ?? 0,
    0,
  );
});

test("caps are enforced per scope with the matching error code", async () => {
  const context = { sessionId: SESSION, runId: RUN_A };

  // run: 2 searches
  {
    const { ledger } = createLedger();
    await ledger.reserve(context, "places.search");
    await ledger.reserve(context, "places.search");
    await assert.rejects(
      ledger.reserve(context, "places.search"),
      (error) =>
        error instanceof BudgetExceededError &&
        error.scope === "run" &&
        error.type === "places.search" &&
        error.code === "BUDGET_RUN_EXCEEDED",
    );
  }

  // session: 3 searches across runs (run cap 2 is not the limit)
  {
    const { ledger } = createLedger({
      caps: caps({ session: { "places.search": 3 } }),
    });
    await ledger.reserve(context, "places.search");
    await ledger.reserve(context, "places.search");
    await ledger.reserve({ sessionId: SESSION, runId: RUN_B }, "places.search");
    await assert.rejects(
      ledger.reserve({ sessionId: SESSION, runId: RUN_B }, "places.search"),
      (error) =>
        error.code === "BUDGET_SESSION_EXCEEDED" && error.scope === "session",
    );
  }

  // month: reserved + settled + estimate must stay within the OpenAI cap
  {
    const { ledger } = createLedger({
      caps: caps({ month: { openaiMicros: 5_000 } }),
    });
    const first = await ledger.reserve(context, "openai.analyze"); // 2,800 reserved
    await assert.rejects(
      ledger.reserve(context, "openai.analyze"), // 5,600 > 5,000
      (error) =>
        error.code === "BUDGET_MONTH_EXCEEDED" && error.scope === "month",
    );
    await ledger.settle(first, { kind: "settle", micros: 2_000 });
    await ledger.reserve(context, "openai.analyze"); // 2,000 + 2,800 <= 5,000
  }

  // the error message is Japanese and names the type
  const error = new BudgetExceededError("month", "openai.analyze");
  assert.match(error.message, /今月/);
  assert.match(error.message, /AI 評価/);
});

test("10 concurrent reserves against cap 5 (in-process mutex): exactly 5 succeed without conflicts", async () => {
  const store = new MemoryLedgerStore();
  const ledger = new Ledger({
    store,
    caps: caps({ run: { "places.details": 5 } }),
    now: () => new Date("2026-09-21T10:00:00Z"),
    sleep: async () => {},
  });
  const context = { sessionId: SESSION, runId: RUN_A };
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => ledger.reserve(context, "places.details")),
  );
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 5);
  assert.equal(rejected.length, 5);
  for (const result of rejected)
    assert.ok(
      result.reason instanceof BudgetExceededError,
      String(result.reason),
    );
  assert.equal(store.conflictCount, 0, "the mutex removes conflicts");
  assert.equal(store.commitCount, 5);
  const session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.reservedCounts["places.details"], 5);
  assert.equal(Object.keys(session.pending).length, 5);
  assert.equal(
    store.get(monthDocId("2026-09")).data.reservedCounts["places.details"],
    5,
  );
});

test("10 concurrent reserves against cap 5 (mutex bypassed): exactly 5 succeed via CAS retry", async () => {
  const store = new MemoryLedgerStore();
  const ledger = new Ledger({
    store,
    caps: caps({ run: { "places.details": 5 } }),
    now: () => new Date("2026-09-21T10:00:00Z"),
    maxAttempts: 20,
    sleep: async () => {},
    serializeInProcess: false,
  });
  const context = { sessionId: SESSION, runId: RUN_A };
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => ledger.reserve(context, "places.details")),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    5,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    5,
  );
  assert.ok(store.conflictCount > 0, "expected precondition conflicts");
  const session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.reservedCounts["places.details"], 5);
  assert.equal(Object.keys(session.pending).length, 5);
});

test("concurrent reserve and settle interleave safely", async () => {
  const store = new MemoryLedgerStore();
  const ledger = new Ledger({
    store,
    caps: caps(),
    now: () => new Date("2026-09-21T10:00:00Z"),
    sleep: async () => {},
  });
  const context = { sessionId: SESSION, runId: RUN_A };
  const details = await Promise.all(
    Array.from({ length: 5 }, () => ledger.reserve(context, "places.details")),
  );
  // Five settles and five analyze reservations at once, as the app does.
  await Promise.all([
    ...details.map((reservation) =>
      ledger.settle(reservation, { kind: "settle" }),
    ),
    ...Array.from({ length: 5 }, () =>
      ledger.reserve(context, "openai.analyze"),
    ),
  ]);
  const session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.counts["places.details"], 5);
  assert.equal(session.reservedCounts["places.details"], 0);
  assert.equal(session.reservedCounts["openai.analyze"], 5);
  assert.equal(session.reservedMicros, 5 * 2_800);
  assert.equal(Object.keys(session.pending).length, 5);
  assert.equal(
    store.get(monthDocId("2026-09")).data.listPriceMicros,
    5 * 25_000,
  );
});

test("contention beyond maxAttempts surfaces as LedgerUnavailableError", async () => {
  const store = new MemoryLedgerStore();
  const original = store.commit.bind(store);
  // Every commit is preceded by a competing write to the month document.
  store.commit = async (writes) => {
    const monthWrite = writes.find((write) =>
      write.docId.startsWith("budget_months/"),
    );
    if (monthWrite) {
      const current = store.get(monthWrite.docId);
      await original([
        {
          docId: monthWrite.docId,
          data: { ...(current?.data ?? {}), noise: Math.random() },
          precondition: current
            ? { updateTime: current.updateTime }
            : { exists: false },
        },
      ]);
    }
    return original(writes);
  };
  const ledger = new Ledger({
    store,
    caps: caps(),
    now: () => new Date("2026-09-21T10:00:00Z"),
    maxAttempts: 3,
    sleep: async () => {},
  });
  await assert.rejects(
    ledger.reserve({ sessionId: SESSION, runId: RUN_A }, "places.search"),
    (error) =>
      error instanceof LedgerUnavailableError &&
      /concurrent/.test(error.message),
  );
});

test("pending reservations are swept into settled after 5 minutes", async () => {
  const clock = { value: "2026-09-21T10:00:00Z" };
  const { ledger, store } = createLedger({ clock });
  const context = { sessionId: SESSION, runId: RUN_A };
  const crashed = await ledger.reserve(context, "openai.analyze");
  const google = await ledger.reserve(context, "places.details");

  // 4 minutes later: nothing is swept yet.
  clock.value = "2026-09-21T10:04:00Z";
  await ledger.reserve(context, "places.search");
  let session = store.get(sessionDocId(SESSION)).data;
  assert.equal(Object.keys(session.pending).length, 3);

  // 5 minutes after the first two: they are settled at their estimate.
  clock.value = "2026-09-21T10:05:00Z";
  await ledger.reserve(context, "places.search");
  session = store.get(sessionDocId(SESSION)).data;
  const month = store.get(monthDocId("2026-09")).data;
  assert.equal(Object.keys(session.pending).length, 2);
  assert.equal(session.pending[crashed.id], undefined);
  assert.equal(session.pending[google.id], undefined);
  assert.equal(session.settledMicros, 2_800);
  assert.equal(session.reservedMicros, 0);
  assert.equal(session.counts["openai.analyze"], 1);
  assert.equal(session.counts["places.details"], 1);
  assert.equal(session.reservedCounts["places.details"], 0);
  assert.equal(session.run.counts["places.details"], 1);
  assert.equal(month.settledMicros, 2_800);
  assert.equal(month.listPriceMicros, 25_000);
  assert.equal(month.counts["places.details"], 1);
  assert.equal(month.reservedCounts["places.search"], 2);

  // A late settle of a swept reservation is ignored.
  await ledger.settle(crashed, { kind: "settle", micros: 100 });
  assert.equal(store.get(monthDocId("2026-09")).data.settledMicros, 2_800);
});

test("a stale reservation from a previous month settles into that month", async () => {
  const clock = { value: "2026-09-30T23:58:00Z" };
  const { ledger, store } = createLedger({ clock });
  const context = { sessionId: SESSION, runId: RUN_A };
  await ledger.reserve(context, "places.search");
  clock.value = "2026-10-01T00:10:00Z";
  assert.equal(monthIdFor(new Date(clock.value)), "2026-10");
  await ledger.reserve(context, "places.search");
  const september = store.get(monthDocId("2026-09")).data;
  const october = store.get(monthDocId("2026-10")).data;
  assert.equal(september.counts["places.search"], 1);
  assert.equal(september.reservedCounts["places.search"], 0);
  assert.equal(october.reservedCounts["places.search"], 1);
  assert.equal(october.counts["places.search"] ?? 0, 0);
});

test("month rollover uses the UTC calendar month", async () => {
  const clock = { value: "2026-09-30T23:00:00Z" };
  const { ledger, store } = createLedger({ clock });
  const context = { sessionId: SESSION, runId: RUN_A };
  const first = await ledger.reserve(context, "places.search");
  assert.equal(first.monthId, "2026-09");
  await ledger.settle(first, { kind: "settle" });
  clock.value = "2026-10-01T00:30:00Z";
  const second = await ledger.reserve(context, "places.search");
  assert.equal(second.monthId, "2026-10");
  assert.equal(
    store.get(monthDocId("2026-09")).data.counts["places.search"],
    1,
  );
  assert.equal(
    store.get(monthDocId("2026-10")).data.reservedCounts["places.search"],
    1,
  );
  assert.equal(monthIdFor(new Date("2026-01-01T00:00:00Z")), "2026-01");
  assert.equal(monthIdFor(new Date("2026-12-31T23:59:59Z")), "2026-12");
});

test("a new run id resets the run counters but not the session", async () => {
  const { ledger, store } = createLedger();
  const first = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "places.search",
  );
  await ledger.reserve({ sessionId: SESSION, runId: RUN_A }, "places.search");
  await ledger.settle(first, { kind: "settle" });
  let session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.run.runId, RUN_A);
  assert.equal(session.run.counts["places.search"], 1);
  assert.equal(session.run.reservedCounts["places.search"], 1);

  // The run cap (2 searches) is full for RUN_A but a new run starts clean.
  const third = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_B },
    "places.search",
  );
  session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.run.runId, RUN_B);
  assert.equal(session.run.counts["places.search"] ?? 0, 0);
  assert.equal(session.run.reservedCounts["places.search"], 1);
  assert.equal(session.counts["places.search"], 1);
  assert.equal(session.reservedCounts["places.search"], 2);
  assert.equal(Object.keys(session.pending).length, 2);

  // Settling RUN_A's leftover reservation updates session and month but not RUN_B.
  const leftoverId = Object.keys(session.pending).find((id) => id !== third.id);
  await ledger.settle({ ...first, id: leftoverId }, { kind: "settle" });
  session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.counts["places.search"], 2);
  assert.equal(session.reservedCounts["places.search"], 1);
  assert.equal(session.run.counts["places.search"] ?? 0, 0);
  assert.equal(session.run.reservedCounts["places.search"], 1);
});

test("a stale request of the previous run does not reset the current run", async () => {
  const { ledger, store } = createLedger();
  const first = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "places.search",
  );
  // The browser starts RUN_B; RUN_A's request is still in flight.
  await ledger.reserve({ sessionId: SESSION, runId: RUN_B }, "places.search");
  await ledger.reserve({ sessionId: SESSION, runId: RUN_B }, "places.search");
  let session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.run.runId, RUN_B);
  assert.equal(session.previousRunId, RUN_A);
  assert.equal(session.run.reservedCounts["places.search"], 2);

  // Late RUN_A reservation: run cap of RUN_B (2) is full, but the stale
  // request is not checked against it and does not touch RUN_B's counters.
  const stale = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "places.details",
  );
  session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.run.runId, RUN_B);
  assert.equal(session.run.reservedCounts["places.search"], 2);
  assert.equal(session.run.reservedCounts["places.details"] ?? 0, 0);
  assert.equal(session.reservedCounts["places.details"], 1);
  assert.equal(session.pending[stale.id].runId, RUN_A);
  assert.equal(
    store.get(monthDocId("2026-09")).data.reservedCounts["places.details"],
    1,
  );

  // Settling RUN_A's reservations updates session and month only.
  await ledger.settle(first, { kind: "settle" });
  await ledger.settle(stale, { kind: "settle" });
  session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.counts["places.search"], 1);
  assert.equal(session.counts["places.details"], 1);
  assert.equal(session.run.counts["places.search"] ?? 0, 0);
  assert.equal(session.run.counts["places.details"] ?? 0, 0);

  // A third run: RUN_B becomes the previous run and RUN_A is no longer stale
  // but a fresh run (its counters start from zero).
  const RUN_C = "44444444-4444-4444-8444-444444444444";
  await ledger.reserve({ sessionId: SESSION, runId: RUN_C }, "places.search");
  session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.run.runId, RUN_C);
  assert.equal(session.previousRunId, RUN_B);
});

test("expiresAt is pushed out on every session write", async () => {
  const clock = { value: "2026-09-21T10:00:00Z" };
  const { ledger, store } = createLedger({ clock });
  const context = { sessionId: SESSION, runId: RUN_A };
  const reservation = await ledger.reserve(context, "places.search");
  const day = 24 * 60 * 60 * 1000;
  let session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.expiresAt.getTime(), Date.parse(clock.value) + 2 * day);
  clock.value = "2026-09-22T10:00:00Z";
  await ledger.settle(reservation, { kind: "settle" });
  session = store.get(sessionDocId(SESSION)).data;
  assert.equal(session.createdAt.getTime(), Date.parse("2026-09-21T10:00:00Z"));
  assert.equal(session.expiresAt.getTime(), Date.parse(clock.value) + 2 * day);
});

test("documents written by an older revision (missing fields) still work", async () => {
  const store = new MemoryLedgerStore();
  await store.commit([
    {
      docId: sessionDocId(SESSION),
      data: { createdAt: new Date("2026-09-21T09:00:00Z") },
      precondition: { exists: false },
    },
    {
      docId: monthDocId("2026-09"),
      data: { settledMicros: 10 },
      precondition: { exists: false },
    },
  ]);
  const { ledger } = createLedger({ store });
  const reservation = await ledger.reserve(
    { sessionId: SESSION, runId: RUN_A },
    "openai.analyze",
  );
  await ledger.settle(reservation, { kind: "settle", micros: 5 });
  const month = store.get(monthDocId("2026-09")).data;
  assert.equal(month.settledMicros, 15);
  assert.equal(month.counts["openai.analyze"], 1);
});
