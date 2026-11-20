import assert from "node:assert/strict";
import test from "node:test";
import {
  isWalkingComparisonRequest,
  rankedWalkingRoutes,
  walkingDestinationIds,
} from "./map-conversation.ts";

test("recognizes explicit candidate walking rankings, comparisons and time lists", () => {
  for (const text of [
    "この中で徒歩が近い順に",
    "徒歩時間を比べて",
    "歩いて近い順",
    "全部の店までの徒歩時間",
    "今の候補を徒歩時間が短い順に並べてください。",
    "各店舗への徒歩時間を教えて？",
    "地図の中心から各店舗までの徒歩時間を比較して",
    "候補を徒歩時間順に並べて",
    "候補を徒歩時間で並べ替えてください",
  ])
    assert.equal(isWalkingComparisonRequest(text), true, text);
});

test("walking conditions, review criteria, search and single-store questions are not comparisons", () => {
  for (const text of [
    "徒歩10分以内のカフェを探して",
    "徒歩で行ける店を静かな順に",
    "周辺で歩いて近い順にカフェを検索",
    "徒歩時間を比べないで",
    "この店までの徒歩時間は？",
    "駅から桜カフェまでの徒歩時間を教えて",
    "徒歩時間と営業時間を比べて",
    "徒歩時間を重視して再評価",
    "徒歩時間は？",
    "近い順に",
  ])
    assert.equal(isWalkingComparisonRequest(text), false, text);
});

test("takes unique destinations in pin order, up to twenty", () => {
  const ids = Array.from({ length: 21 }, (_, index) => `p${index}`);
  assert.deepEqual(
    walkingDestinationIds([ids[0], ...ids].map((placeId) => ({ placeId }))),
    ids.slice(0, 20),
  );
});

test("sorts unordered routes by duration then pin order, placing unknowns last", () => {
  const routes = [
    { placeId: "c", durationSeconds: null },
    { placeId: "d", durationSeconds: 90 },
    { placeId: "b", durationSeconds: 0 },
    { placeId: "a", durationSeconds: 90 },
  ];
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(
    rankedWalkingRoutes({ routes }, ids).map((r) => r.placeId),
    ["b", "a", "d", "c"],
  );
  for (const invalid of [
    null,
    {},
    { routes: routes.slice(1) },
    { routes: [...routes, routes[0]] },
    {
      routes: [{ placeId: "unknown", durationSeconds: 0 }, ...routes.slice(1)],
    },
    ...[-1, Infinity, "60", undefined].map((durationSeconds) => ({
      routes: [{ placeId: "c", durationSeconds }, ...routes.slice(1)],
    })),
  ])
    assert.throws(() => rankedWalkingRoutes(invalid, ids), /応答形式/);
});
