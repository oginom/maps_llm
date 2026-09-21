import assert from "node:assert/strict";
import test from "node:test";
import { LedgerConflictError, LedgerUnavailableError } from "./errors.ts";
import {
  FirestoreLedgerStore,
  decodeFields,
  encodeFields,
  encodeValue,
} from "./firestore-store.ts";
import { Ledger, monthDocId, sessionDocId } from "./ledger.ts";
import { DEFAULT_BUDGET_CAPS } from "./config.ts";

const PROJECT = "demo-project";
const PREFIX = `projects/${PROJECT}/databases/(default)/documents`;

// A fake Firestore: scripted responses per call, plus a record of requests.
function fakeFetch(responses) {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("no scripted response left");
    if (next.throw) throw next.throw;
    return new Response(
      next.body === undefined ? "" : JSON.stringify(next.body),
      { status: next.status ?? 200 },
    );
  };
  return { calls, fetchImplementation };
}

function createStore(responses, overrides = {}) {
  const fake = fakeFetch(responses);
  const tokens = [];
  const store = new FirestoreLedgerStore({
    projectId: PROJECT,
    fetchImplementation: fake.fetchImplementation,
    getToken: async () => {
      tokens.push("token-1");
      return "token-1";
    },
    sleep: async () => {},
    ...overrides,
  });
  return { store, calls: fake.calls, tokens };
}

test("value encoding round trip", () => {
  const at = new Date("2026-09-21T10:00:00.000Z");
  const data = {
    counts: { "places.search": 2, "openai.analyze": 0 },
    settledMicros: 12345,
    ratio: 1.5,
    runId: "abc",
    flag: true,
    nothing: null,
    at,
    nested: { deeper: { value: 7 } },
  };
  const fields = encodeFields(data);
  assert.deepEqual(fields.counts, {
    mapValue: {
      fields: {
        "places.search": { integerValue: "2" },
        "openai.analyze": { integerValue: "0" },
      },
    },
  });
  assert.deepEqual(fields.settledMicros, { integerValue: "12345" });
  assert.deepEqual(fields.ratio, { doubleValue: 1.5 });
  assert.deepEqual(fields.runId, { stringValue: "abc" });
  assert.deepEqual(fields.flag, { booleanValue: true });
  assert.deepEqual(fields.nothing, { nullValue: null });
  assert.deepEqual(fields.at, { timestampValue: "2026-09-21T10:00:00.000Z" });
  const decoded = decodeFields(JSON.parse(JSON.stringify(fields)));
  assert.deepEqual(decoded, data);
  assert.ok(decoded.at instanceof Date);
  assert.throws(() => encodeValue(Number.NaN), /finite/);
  assert.throws(() => decodeFields({ x: { arrayValue: {} } }), /unsupported/);
});

test("read: batchGet body, missing documents and updateTime", async () => {
  const { store, calls, tokens } = createStore([
    {
      body: [
        { missing: `${PREFIX}/budget_sessions/s1`, readTime: "t" },
        {
          found: {
            name: `${PREFIX}/budget_months/2026-09`,
            fields: { settledMicros: { integerValue: "42" } },
            updateTime: "2026-09-21T10:00:00.123456Z",
          },
          readTime: "t",
        },
      ],
    },
  ]);
  const result = await store.read([
    "budget_sessions/s1",
    "budget_months/2026-09",
  ]);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://firestore.googleapis.com/v1/${PREFIX}:batchGet`,
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer token-1");
  assert.deepEqual(calls[0].body, {
    documents: [
      `${PREFIX}/budget_sessions/s1`,
      `${PREFIX}/budget_months/2026-09`,
    ],
  });
  assert.equal(result.get("budget_sessions/s1"), undefined);
  assert.deepEqual(result.get("budget_months/2026-09"), {
    data: { settledMicros: 42 },
    updateTime: "2026-09-21T10:00:00.123456Z",
  });
  assert.deepEqual(tokens, ["token-1"]);
});

test("commit: body carries fields and preconditions", async () => {
  const { store, calls } = createStore([{ body: { writeResults: [] } }]);
  await store.commit([
    {
      docId: "budget_sessions/s1",
      data: { settledMicros: 1 },
      precondition: { exists: false },
    },
    {
      docId: "budget_months/2026-09",
      data: { settledMicros: 2 },
      precondition: { updateTime: "2026-09-21T10:00:00.123456Z" },
    },
  ]);
  assert.equal(
    calls[0].url,
    `https://firestore.googleapis.com/v1/${PREFIX}:commit`,
  );
  assert.deepEqual(calls[0].body, {
    writes: [
      {
        update: {
          name: `${PREFIX}/budget_sessions/s1`,
          fields: { settledMicros: { integerValue: "1" } },
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `${PREFIX}/budget_months/2026-09`,
          fields: { settledMicros: { integerValue: "2" } },
        },
        currentDocument: { updateTime: "2026-09-21T10:00:00.123456Z" },
      },
    ],
  });
});

test("commit: precondition failures are conflicts, not outages", async () => {
  for (const response of [
    {
      status: 409,
      body: { error: { code: 409, status: "ABORTED", message: "contention" } },
    },
    {
      status: 400,
      body: {
        error: { code: 400, status: "FAILED_PRECONDITION", message: "stale" },
      },
    },
    {
      status: 409,
      body: { error: { status: "ALREADY_EXISTS", message: "exists" } },
    },
  ]) {
    const { store, calls } = createStore([response]);
    await assert.rejects(
      store.commit([
        { docId: "budget_months/m", data: {}, precondition: { exists: false } },
      ]),
      LedgerConflictError,
    );
    assert.equal(
      calls.length,
      1,
      "conflicts are not retried at the store level",
    );
  }
});

test("NOT_FOUND on commit is a conflict; 404 on batchGet is an outage", async () => {
  const commit = createStore([
    {
      status: 404,
      body: {
        error: {
          code: 404,
          status: "NOT_FOUND",
          message: "No document to update",
        },
      },
    },
  ]);
  await assert.rejects(
    commit.store.commit([
      {
        docId: "budget_sessions/s1",
        data: {},
        precondition: { updateTime: "t" },
      },
    ]),
    LedgerConflictError,
  );
  assert.equal(commit.calls.length, 1);

  const read = createStore([
    {
      status: 404,
      body: {
        error: { code: 404, status: "NOT_FOUND", message: "database missing" },
      },
    },
  ]);
  await assert.rejects(
    read.store.read(["budget_sessions/s1"]),
    (error) =>
      error instanceof LedgerUnavailableError &&
      /NOT_FOUND/.test(error.message),
  );
  assert.equal(read.calls.length, 1);
});

test("ledger over the Firestore store: TTL-deleted session -> NOT_FOUND -> re-read -> create", async () => {
  const SESSION = "11111111-1111-4111-8111-111111111111";
  const RUN = "22222222-2222-4222-8222-222222222222";
  const sessionName = `${PREFIX}/${sessionDocId(SESSION)}`;
  const monthName = `${PREFIX}/${monthDocId("2026-09")}`;
  const { store, calls } = createStore([
    {
      body: [
        {
          found: {
            name: sessionName,
            fields: {
              createdAt: { timestampValue: "2026-09-19T00:00:00.000Z" },
            },
            updateTime: "2026-09-19T00:00:00.000000Z",
          },
        },
        { missing: monthName },
      ],
    },
    {
      status: 404,
      body: {
        error: { status: "NOT_FOUND", message: "No document to update" },
      },
    },
    { body: [{ missing: sessionName }, { missing: monthName }] },
    { body: { writeResults: [] } },
  ]);
  const ledger = new Ledger({
    store,
    caps: DEFAULT_BUDGET_CAPS,
    now: () => new Date("2026-09-21T10:00:00Z"),
    sleep: async () => {},
  });
  await ledger.reserve({ sessionId: SESSION, runId: RUN }, "places.search");
  assert.equal(calls.length, 4);
  const sessionWrite = calls[3].body.writes.find(
    (write) => write.update.name === sessionName,
  );
  assert.deepEqual(sessionWrite.currentDocument, { exists: false });
});

test("decode failures map to LedgerUnavailableError (503), not a generic error", async () => {
  const { store } = createStore([
    {
      body: [
        {
          found: {
            name: `${PREFIX}/budget_months/m`,
            fields: { odd: { arrayValue: { values: [] } } },
            updateTime: "t",
          },
        },
      ],
    },
  ]);
  await assert.rejects(store.read(["budget_months/m"]), LedgerUnavailableError);
  assert.throws(() => encodeValue(Number.NaN), LedgerUnavailableError);
});

test("5xx is retried with the same body, then succeeds", async () => {
  const { store, calls } = createStore([
    {
      status: 503,
      body: { error: { status: "UNAVAILABLE", message: "try later" } },
    },
    { throw: new Error("socket hang up") },
    { body: { writeResults: [] } },
  ]);
  await store.commit([
    {
      docId: "budget_months/m",
      data: { a: 1 },
      precondition: { exists: false },
    },
  ]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].body, calls[2].body);
});

test("retries exhausted -> LedgerUnavailableError", async () => {
  const { store, calls } = createStore(
    Array.from({ length: 5 }, () => ({
      status: 500,
      body: { error: { message: "boom" } },
    })),
  );
  await assert.rejects(
    store.read(["budget_months/m"]),
    (error) =>
      error instanceof LedgerUnavailableError &&
      /after 5 attempts/.test(error.message),
  );
  assert.equal(calls.length, 5);
});

test("auth failures and token errors fail closed without retry", async () => {
  const { store, calls } = createStore([
    {
      status: 403,
      body: {
        error: { status: "PERMISSION_DENIED", message: "no datastore.user" },
      },
    },
  ]);
  await assert.rejects(
    store.read(["budget_months/m"]),
    (error) =>
      error instanceof LedgerUnavailableError &&
      /PERMISSION_DENIED/.test(error.message),
  );
  assert.equal(calls.length, 1);

  const failing = createStore([], {
    getToken: async () => {
      throw new Error("metadata server unreachable");
    },
  });
  await assert.rejects(
    failing.store.read(["budget_months/m"]),
    (error) =>
      error instanceof LedgerUnavailableError && /token/.test(error.message),
  );
  assert.equal(failing.calls.length, 0);
});

test("timeouts are retried and reported as unavailable", async () => {
  const { store } = createStore([], {
    timeoutMs: 5,
    maxAttempts: 2,
    fetchImplementation: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
  });
  await assert.rejects(
    store.read(["budget_months/m"]),
    (error) =>
      error instanceof LedgerUnavailableError &&
      /after 2 attempts/.test(error.message),
  );
});

test("ledger over the Firestore store: 409 on commit, re-read, then success", async () => {
  const SESSION = "11111111-1111-4111-8111-111111111111";
  const RUN = "22222222-2222-4222-8222-222222222222";
  const emptyRead = {
    body: [
      { missing: `${PREFIX}/${sessionDocId(SESSION)}` },
      { missing: `${PREFIX}/${monthDocId("2026-09")}` },
    ],
  };
  const { store, calls } = createStore([
    emptyRead,
    {
      status: 409,
      body: { error: { status: "ABORTED", message: "contention" } },
    },
    // Second attempt sees a month document created by the competing writer.
    {
      body: [
        { missing: `${PREFIX}/${sessionDocId(SESSION)}` },
        {
          found: {
            name: `${PREFIX}/${monthDocId("2026-09")}`,
            fields: {
              counts: {
                mapValue: {
                  fields: { "places.search": { integerValue: "1" } },
                },
              },
            },
            updateTime: "2026-09-21T10:00:00.000001Z",
          },
        },
      ],
    },
    { body: { writeResults: [] } },
  ]);
  const ledger = new Ledger({
    store,
    caps: DEFAULT_BUDGET_CAPS,
    now: () => new Date("2026-09-21T10:00:00Z"),
    sleep: async () => {},
  });
  const reservation = await ledger.reserve(
    { sessionId: SESSION, runId: RUN },
    "places.search",
  );
  assert.equal(reservation.type, "places.search");
  assert.equal(calls.length, 4);
  const finalCommit = calls[3].body.writes;
  const monthWrite = finalCommit.find((write) =>
    write.update.name.endsWith("/2026-09"),
  );
  assert.deepEqual(monthWrite.currentDocument, {
    updateTime: "2026-09-21T10:00:00.000001Z",
  });
  assert.deepEqual(
    monthWrite.update.fields.counts.mapValue.fields["places.search"],
    {
      integerValue: "1",
    },
  );
  assert.deepEqual(
    monthWrite.update.fields.reservedCounts.mapValue.fields["places.search"],
    {
      integerValue: "1",
    },
  );
  const sessionWrite = finalCommit.find((write) =>
    write.update.name.includes("budget_sessions"),
  );
  assert.deepEqual(sessionWrite.currentDocument, { exists: false });
  assert.ok("timestampValue" in sessionWrite.update.fields.expiresAt);
});
