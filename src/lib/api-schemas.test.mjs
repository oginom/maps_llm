import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeReviewsRequestSchema,
  formatIssues,
  generateExamplesRequestSchema,
  placeIdSchema,
  placeSearchRequestSchema,
} from "./api-schemas.ts";

const viewport = {
  low: { lat: 35.6, lng: 139.7 },
  high: { lat: 35.7, lng: 139.8 },
};

test("place search accepts a viewport query and applies defaults", () => {
  const parsed = placeSearchRequestSchema.parse({
    textQuery: " 電源 カフェ ",
    rectangle: viewport,
  });
  assert.deepEqual(parsed, {
    textQuery: "電源 カフェ",
    rectangle: viewport,
    maxResultCount: 20,
  });
  assert.equal(
    placeSearchRequestSchema.parse({
      textQuery: "a",
      rectangle: viewport,
      openNow: false,
      maxResultCount: 5,
    }).maxResultCount,
    5,
  );
});

test("place search rejects bad text, inverted or out-of-range rectangles, counts and extras", () => {
  const rejects = (body) =>
    assert.equal(placeSearchRequestSchema.safeParse(body).success, false);
  rejects({ textQuery: "", rectangle: viewport });
  rejects({ textQuery: "   ", rectangle: viewport });
  rejects({ textQuery: "x".repeat(101), rectangle: viewport });
  rejects({ textQuery: "cafe" });
  rejects({
    textQuery: "cafe",
    rectangle: { low: viewport.high, high: viewport.low },
  });
  rejects({
    textQuery: "cafe",
    rectangle: { low: { lat: -91, lng: 0 }, high: { lat: 0, lng: 0 } },
  });
  rejects({
    textQuery: "cafe",
    rectangle: { low: { lat: 0, lng: 0 }, high: { lat: 0, lng: 181 } },
  });
  rejects({
    textQuery: "cafe",
    rectangle: { low: { lat: "35", lng: 139 }, high: viewport.high },
  });
  rejects({ textQuery: "cafe", rectangle: viewport, maxResultCount: 0 });
  rejects({ textQuery: "cafe", rectangle: viewport, maxResultCount: 21 });
  rejects({ textQuery: "cafe", rectangle: viewport, maxResultCount: 2.5 });
  rejects({ textQuery: "cafe", rectangle: viewport, openNow: "yes" });
  rejects({ textQuery: "cafe", rectangle: viewport, fieldMask: "*" });
});

test("place id accepts Google ids and rejects paths or short strings", () => {
  assert.equal(
    placeIdSchema.safeParse("ChIJN1t_tDeuEmsRUsoyG83frY4").success,
    true,
  );
  assert.equal(
    placeIdSchema.safeParse(
      "EicxMyBNYXJrZXQgU3QsIFdpbGxpYW1zYnVyZywgVkEgMjMxODUiGhIYChQKEgnRWsSXKY6yiBFiaw",
    ).success,
    true,
  );
  for (const id of [
    "",
    "short",
    "ChIJ/../x1234567",
    "ChIJ 1234567890",
    "a".repeat(513),
  ])
    assert.equal(placeIdSchema.safeParse(id).success, false, id);
});

test("analyze-reviews validates lengths and fills the scale", () => {
  const parsed = analyzeReviewsRequestSchema.parse({
    reviews: "電源あり",
    metric: "電源がある",
    examples: "1 ... なし, 5 ... 全席",
  });
  assert.equal(parsed.scale, "5");
  const rejects = (body) =>
    assert.equal(analyzeReviewsRequestSchema.safeParse(body).success, false);
  rejects({ reviews: "", metric: "m", examples: "" });
  rejects({ reviews: "x".repeat(8001), metric: "m", examples: "" });
  rejects({ reviews: "x", metric: "", examples: "" });
  rejects({ reviews: "x", metric: "m".repeat(201), examples: "" });
  rejects({ reviews: "x", metric: "m", examples: "e".repeat(1001) });
  rejects({ reviews: "x", metric: "m", examples: ["a"] });
  rejects({ reviews: "x", metric: "m", examples: "", scale: "10" });
  rejects({ reviews: "x", metric: "m", examples: "", model: "gpt" });
  assert.equal(
    analyzeReviewsRequestSchema.safeParse({
      reviews: "x".repeat(8000),
      metric: "m",
      examples: "",
      scale: "5",
    }).success,
    true,
  );
});

test("generate-examples validates both strings and reports the field", () => {
  assert.deepEqual(
    generateExamplesRequestSchema.parse({
      searchTerm: "カフェ",
      evaluation: "電源がある",
    }),
    { searchTerm: "カフェ", evaluation: "電源がある" },
  );
  const result = generateExamplesRequestSchema.safeParse({
    searchTerm: "",
    evaluation: "x".repeat(201),
  });
  assert.equal(result.success, false);
  const message = formatIssues(result.error);
  assert.match(message, /searchTerm/);
  assert.match(message, /evaluation/);
  assert.equal(
    generateExamplesRequestSchema.safeParse({ searchTerm: "a" }).success,
    false,
  );
});
