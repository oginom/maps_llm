import assert from "node:assert/strict";
import test from "node:test";
import { trackSearchViewport } from "./search-viewport.ts";

function setup() {
  const area = { north: 40, south: 39, east: 142, west: 141 };
  const events = new Map();
  const tracker = trackSearchViewport({
    getBounds: () => ({ toJSON: () => area }),
    addListener(name, callback) {
      events.set(name, callback);
      return { remove: () => events.delete(name) };
    },
  });
  return { tracker, area, events, signal: new AbortController().signal };
}

test("stable send copies the actual bounds immediately, without a camera event", async () => {
  const { tracker, area, signal } = setup();
  const expected = { ...area };
  const sent = tracker.snapshot(signal);
  area.west -= 0.1;
  assert.deepEqual(await sent, expected);
  assert.deepEqual(await tracker.snapshot(signal), area);
});

for (const event of ["bounds_changed", "idle"]) {
  test(`an in-flight camera change is captured at ${event}, before later movement`, async () => {
    const { tracker, area, events, signal } = setup();
    events.get("zoom_changed")();
    const sent = tracker.snapshot(signal);
    area.north -= 0.1;
    const expected = { ...area };
    events.get(event)();
    area.north -= 0.1;
    assert.deepEqual(await sent, expected);
  });
}

test("aborting a send while bounds are stale never yields a snapshot", async () => {
  const { tracker, events } = setup();
  events.get("center_changed")();
  const controller = new AbortController();
  const snapshot = tracker.snapshot(controller.signal);
  controller.abort();
  events.get("bounds_changed")();
  await assert.rejects(snapshot, { name: "AbortError" });
  tracker.dispose();
  assert.equal(events.size, 0);
});

test("missing Maps confirmation reports failure rather than sending old bounds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tracker, events, signal } = setup();
  events.get("center_changed")();
  const snapshot = tracker.snapshot(signal);
  t.mock.timers.runAll();
  await assert.rejects(snapshot, /地図の表示範囲/);
});
