import assert from "node:assert/strict";
import test from "node:test";
import { PlaceDetailBatch } from "./place-detail-batch.ts";

test("reserves five requests synchronously and never exceeds ten attempts", () => {
  const batch = new PlaceDetailBatch(
    Array.from({ length: 20 }, (_, index) => ({ place_id: String(index) })),
  );
  assert.equal(batch.take().length, 5);
  assert.deepEqual(batch.take(), []); // A second click while work is pending.
  batch.finish(); // Failures still consumed attempts; no automatic retries.
  assert.deepEqual(
    batch.take().map((place) => place.place_id),
    ["5", "6", "7", "8", "9"],
  );
  batch.finish();
  assert.deepEqual(batch.take(), []);
  assert.equal(batch.requestedCount, 10);
});

test("deduplicates places and handles a partial final batch", () => {
  const places = Array.from({ length: 7 }, (_, index) => ({
    place_id: String(index),
  }));
  const batch = new PlaceDetailBatch([...places, ...places]);
  assert.equal(batch.take().length, 5);
  batch.finish();
  assert.equal(batch.remainingCount, 2);
  assert.equal(batch.take().length, 2);
  batch.finish();
  assert.equal(batch.remainingCount, 0);
  assert.deepEqual(batch.take(), []);
});

test("independent searches have independent request allowances", () => {
  const oldSearch = new PlaceDetailBatch([{ place_id: "same" }]);
  oldSearch.take();
  const newSearch = new PlaceDetailBatch([{ place_id: "same" }]);
  assert.equal(newSearch.take().length, 1);
  assert.equal(newSearch.isBusy, true);
  oldSearch.finish();
  assert.equal(newSearch.isBusy, true);
});
