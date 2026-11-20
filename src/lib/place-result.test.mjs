import assert from "node:assert/strict";
import test from "node:test";
import { createSearchResults, resultState } from "./place-result.ts";

const place = (placeId, name = placeId) => ({
  reviews: [{ text: `review:${placeId}`, author: { name: "投稿者" } }],
  placeId,
  name,
  address: "東京",
  location: { lat: 35.6, lng: 139.7 },
  googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
});

test("createSearchResults keeps order, drops duplicates and attaches the criteria", () => {
  const results = createSearchResults(
    [place("a"), place("b"), place("a", "again"), place("c")],
    { evaluation: "電源がある", examples: "1 ... ない, 5 ... 全席" },
  );
  assert.deepEqual(Object.keys(results), ["a", "b", "c"]);
  assert.equal(results.a.name, "a");
  assert.equal(results.a.evaluation, "電源がある");
  assert.equal(results.a.examples, "1 ... ない, 5 ... 全席");
  assert.deepEqual(results.a.reviews, place("a").reviews);
  assert.equal(resultState(results.a), "unevaluated");
  assert.equal(resultState({ ...results.a, reviews: [] }), "no-reviews");
  assert.deepEqual(
    createSearchResults([], { evaluation: "x", examples: "y" }),
    {},
  );
});
