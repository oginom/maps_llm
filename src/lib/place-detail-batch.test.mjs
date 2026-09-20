import assert from "node:assert/strict";
import test from "node:test";
import { PlaceDetailBatch } from "./place-detail-batch.ts";

test("reserves five requests synchronously and never exceeds twenty attempts", () => {
  const batch = new PlaceDetailBatch(
    Array.from({ length: 25 }, (_, index) => ({ placeId: String(index) })),
  );
  assert.equal(batch.take().length, 5);
  assert.deepEqual(batch.take(), []); // A second click while work is pending.
  batch.finish(); // Failures still consumed attempts; no automatic retries.
  assert.deepEqual(
    batch.take().map((place) => place.placeId),
    ["5", "6", "7", "8", "9"],
  );
  batch.finish();
  assert.equal(batch.take().length, 5);
  batch.finish();
  assert.deepEqual(
    batch.take().map((place) => place.placeId),
    ["15", "16", "17", "18", "19"],
  );
  batch.finish();
  assert.deepEqual(batch.take(), []);
  assert.equal(batch.requestedCount, 20);
});

test("deduplicates places and handles a partial final batch", () => {
  const places = Array.from({ length: 7 }, (_, index) => ({
    placeId: String(index),
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
  const oldSearch = new PlaceDetailBatch([{ placeId: "same" }]);
  oldSearch.take();
  const newSearch = new PlaceDetailBatch([{ placeId: "same" }]);
  assert.equal(newSearch.take().length, 1);
  assert.equal(newSearch.isBusy, true);
  oldSearch.finish();
  assert.equal(newSearch.isBusy, true);
});
