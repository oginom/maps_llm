import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LedgerConflictError } from "./errors.ts";
import { FileLedgerStore } from "./file-store.ts";

async function withTemporaryFile(run) {
  const directory = await mkdtemp(join(tmpdir(), "ledger-"));
  try {
    await run(join(directory, "nested", "ledger.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("documents persist across store instances, dates included", () =>
  withTemporaryFile(async (filePath) => {
    const at = new Date("2026-09-21T10:00:00.000Z");
    const first = new FileLedgerStore(filePath);
    await first.commit([
      {
        docId: "budget_sessions/s1",
        data: { settledMicros: 5, run: { runId: "r" }, at },
        precondition: { exists: false },
      },
    ]);
    const second = new FileLedgerStore(filePath);
    const result = await second.read([
      "budget_sessions/s1",
      "budget_sessions/none",
    ]);
    const document = result.get("budget_sessions/s1");
    assert.deepEqual(document.data, {
      settledMicros: 5,
      run: { runId: "r" },
      at,
    });
    assert.ok(document.data.at instanceof Date);
    assert.equal(typeof document.updateTime, "string");
    assert.equal(result.get("budget_sessions/none"), undefined);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(raw.documents["budget_sessions/s1"].data.at, {
      $date: "2026-09-21T10:00:00.000Z",
    });
  }));

test("preconditions: exists:false and stale updateTime conflict", () =>
  withTemporaryFile(async (filePath) => {
    const store = new FileLedgerStore(filePath);
    const write = (precondition, value) => ({
      docId: "budget_months/2026-09",
      data: { settledMicros: value },
      precondition,
    });
    await store.commit([write({ exists: false }, 1)]);
    await assert.rejects(
      store.commit([write({ exists: false }, 2)]),
      LedgerConflictError,
    );
    const { updateTime } = (await store.read(["budget_months/2026-09"])).get(
      "budget_months/2026-09",
    );
    await store.commit([write({ updateTime }, 3)]);
    await assert.rejects(
      store.commit([write({ updateTime }, 4)]),
      LedgerConflictError,
    );
    await assert.rejects(
      store.commit([
        {
          docId: "budget_months/missing",
          data: {},
          precondition: { updateTime },
        },
      ]),
      LedgerConflictError,
    );
    const final = (await store.read(["budget_months/2026-09"])).get(
      "budget_months/2026-09",
    );
    assert.equal(final.data.settledMicros, 3);
  }));

test("a failed commit writes nothing and concurrent commits are serialised", () =>
  withTemporaryFile(async (filePath) => {
    const store = new FileLedgerStore(filePath);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        store.commit([
          {
            docId: "budget_months/m",
            data: { index },
            precondition: { exists: false },
          },
        ]),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      4,
    );
    const document = (await store.read(["budget_months/m"])).get(
      "budget_months/m",
    );
    assert.equal(typeof document.data.index, "number");
  }));

test("refuses to run in production", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => new FileLedgerStore("/tmp/never.json"),
      /not allowed in production/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
