import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlaceBatches } from "./place-detail-batch.ts";

const places = Array.from({ length: 25 }, (_, i) => ({ placeId: String(i) }));

test("automatically evaluates the first twenty distinct places with at most five in flight", async () => {
  const started = [];
  let active = 0,
    peak = 0;
  await evaluatePlaceBatches(
    places.flatMap((place) => [place, place]),
    () => true,
    async (place) => {
      started.push(place);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
    },
  );
  assert.deepEqual(started, places.slice(0, 20));
  assert.equal(peak, 5);
});

test("stopping during a wave prevents queued work from starting", async () => {
  const controller = new AbortController();
  const started = [];
  await evaluatePlaceBatches(
    places,
    () => !controller.signal.aborted,
    async (place) => {
      started.push(place);
      await Promise.resolve();
      controller.abort();
    },
  );
  assert.deepEqual(started, places.slice(0, 5));
});
