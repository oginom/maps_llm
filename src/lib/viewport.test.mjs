import assert from "node:assert/strict";
import test from "node:test";
import { placeSearchRequestSchema } from "./api-schemas.ts";
import { CLAMPED_LONGITUDE_SPAN, viewportToRectangle } from "./viewport.ts";

const accepted = (rectangle) =>
  placeSearchRequestSchema.safeParse({ textQuery: "cafe", rectangle }).success;

test("passes an ordinary viewport through unchanged", () => {
  const rectangle = viewportToRectangle({
    north: 35.71,
    south: 35.69,
    east: 139.72,
    west: 139.68,
  });
  assert.deepEqual(rectangle, {
    low: { lat: 35.69, lng: 139.68 },
    high: { lat: 35.71, lng: 139.72 },
  });
  assert.equal(accepted(rectangle), true);
});

test("narrows a viewport of 180 degrees or more around its centre", () => {
  const half = CLAMPED_LONGITUDE_SPAN / 2;
  const world = viewportToRectangle({
    north: 85,
    south: -85,
    east: 180,
    west: -180,
  });
  assert.deepEqual(world, {
    low: { lat: -85, lng: -half },
    high: { lat: 85, lng: half },
  });
  assert.equal(accepted(world), true);

  const wide = viewportToRectangle({
    north: 60,
    south: 10,
    east: 170,
    west: -10,
  });
  const close = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  close(wide.high.lng - wide.low.lng, CLAMPED_LONGITUDE_SPAN);
  close((wide.low.lng + wide.high.lng) / 2, 80);
  assert.equal(accepted(wide), true);
});

test("clamps latitude to the poles and cuts viewports crossing the antimeridian", () => {
  assert.deepEqual(
    viewportToRectangle({ north: 95, south: -95, east: 10, west: 0 }),
    { low: { lat: -90, lng: 0 }, high: { lat: 90, lng: 10 } },
  );
  const crossing = viewportToRectangle({
    north: 40,
    south: 30,
    east: -170,
    west: 170,
  });
  assert.deepEqual(crossing, {
    low: { lat: 30, lng: 170 },
    high: { lat: 40, lng: 180 },
  });
  assert.equal(accepted(crossing), true);
});

test("the schema rejects a span of 180 degrees or more as a backstop", () => {
  const result = placeSearchRequestSchema.safeParse({
    textQuery: "cafe",
    rectangle: { low: { lat: 0, lng: -90 }, high: { lat: 1, lng: 90 } },
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /180/);
  assert.equal(
    accepted({ low: { lat: 0, lng: -89.9 }, high: { lat: 1, lng: 89.9 } }),
    true,
  );
});
