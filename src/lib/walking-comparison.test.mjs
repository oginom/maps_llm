import assert from "node:assert/strict";
import test from "node:test";
import {
  compareWithWalkingBudget,
  computeWalkingComparison,
  walkingComparisonSchema,
} from "./walking-comparison.ts";
import { LedgerUnavailableError } from "./budget/errors.ts";

const input = { origin: { lat: 35, lng: 139 }, placeIds: ["first", "second"] };
const good = {
  originIndex: 0,
  destinationIndex: 1,
  condition: "ROUTE_EXISTS",
  duration: "41.5s",
  status: {},
};
const unreachable = { condition: "ROUTE_NOT_FOUND", status: {} };

test("missing key and unavailable ledger never reach the paid service", async () => {
  const events = [];
  const unavailable = new LedgerUnavailableError("offline");
  const dependencies = {
    reserve: async () => {
      events.push("reserve");
      throw unavailable;
    },
    settle: async () => events.push("settle"),
    fetcher: async () => events.push("fetch"),
  };
  const signal = new AbortController().signal;
  await assert.rejects(
    compareWithWalkingBudget(input, {}, signal, undefined, dependencies),
    { code: "ROUTES_UNAVAILABLE", status: 503 },
  );
  assert.deepEqual(events, []);
  await assert.rejects(
    compareWithWalkingBudget(input, {}, signal, "fake", dependencies),
    unavailable,
  );
  assert.deepEqual(events, ["reserve"]);
});

test("release on cancellation during reservation; settle on upstream failure", async () => {
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const events = [];
    const reservation = { id: "test-reservation", count: 2 };
    await assert.rejects(
      compareWithWalkingBudget(input, {}, controller.signal, "fake", {
        reserve: async (_, type) => {
          assert.equal(type, "routes.matrixElement");
          events.push("reserve");
          if (cancel) controller.abort();
          return reservation;
        },
        settle: async (actual, outcome) => {
          assert.equal(actual, reservation);
          events.push(outcome.kind);
        },
        fetcher: async () => {
          events.push("fetch");
          throw new Error("offline");
        },
      }),
      cancel ? { name: "AbortError" } : { code: "ROUTES_UPSTREAM_ERROR" },
    );
    assert.deepEqual(
      events,
      cancel ? ["reserve", "release"] : ["reserve", "fetch", "settle"],
    );
  }
});

test("requires exactly two distinct Place IDs and bounded numeric coordinates", () => {
  assert.ok(walkingComparisonSchema.safeParse(input).success);
  for (const placeIds of [
    [],
    ["a"],
    ["a", "b", "c"],
    ["same", "same"],
    ["", "b"],
    ["a", " a"],
  ])
    assert.equal(
      walkingComparisonSchema.safeParse({ ...input, placeIds }).success,
      false,
    );
  for (const origin of [
    { lat: 91, lng: 0 },
    { lat: 0, lng: -181 },
    { lat: "0", lng: 0 },
  ])
    assert.equal(
      walkingComparisonSchema.safeParse({ ...input, origin }).success,
      false,
    );
});

function call(body, httpStatus = 200) {
  let sent = false;
  let fetched = false;
  const signal = new AbortController().signal;
  return computeWalkingComparison(input, {
    signal,
    apiKey: "fake",
    onRequestSent: () => {
      assert.equal(sent, false);
      sent = true;
    },
    fetcher: async (url, options) => {
      assert.ok(sent);
      assert.equal(fetched, false);
      fetched = true;
      assert.equal(options.signal, signal);
      assert.equal(
        url,
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      );
      assert.equal(options.headers["X-Goog-Api-Key"], "fake");
      assert.ok(options.headers["X-Goog-FieldMask"].includes("status"));
      assert.deepEqual(JSON.parse(options.body), {
        origins: [
          {
            waypoint: {
              location: { latLng: { latitude: 35, longitude: 139 } },
            },
          },
        ],
        destinations: [
          { waypoint: { placeId: "first" } },
          { waypoint: { placeId: "second" } },
        ],
        travelMode: "WALK",
      });
      return Response.json(body, { status: httpStatus });
    },
  });
}

test("preserves order and marks only the unavailable route null", async () => {
  assert.deepEqual(await call([good, unreachable]), {
    routes: [
      { placeId: "first", durationSeconds: null },
      { placeId: "second", durationSeconds: 41.5 },
    ],
  });
  assert.equal(
    (await call([good, { ...good, destinationIndex: 0, duration: "0s" }]))
      .routes[0].durationSeconds,
    0,
  );
});

test("rejects truncated, duplicate, malformed or ambiguous results", async () => {
  for (const body of [
    [good],
    [good, good],
    {},
    ...[
      { duration: undefined },
      { duration: "-4s" },
      { duration: "30 min" },
      { condition: undefined },
      { originIndex: 1 },
      { destinationIndex: 2 },
      { status: undefined },
    ].map((changes) => [{ ...good, ...changes }, unreachable]),
  ])
    await assert.rejects(call(body), { code: "ROUTES_INVALID_RESPONSE" });
});

test("maps upstream failures without retries", async () => {
  for (const [httpStatus, code] of [
    [429, "RESOURCE_EXHAUSTED"],
    [403, "ROUTES_PERMISSION_DENIED"],
    [500, "ROUTES_UPSTREAM_ERROR"],
  ])
    await assert.rejects(call({}, httpStatus), { code });
  for (const [grpcCode, code] of [
    [8, "RESOURCE_EXHAUSTED"],
    [7, "ROUTES_PERMISSION_DENIED"],
    [13, "ROUTES_UPSTREAM_ERROR"],
  ])
    await assert.rejects(
      call([{ ...good, status: { code: grpcCode } }, unreachable]),
      { code },
    );
});
