import assert from "node:assert/strict";
import test from "node:test";
import { prepareReviewTexts, parseReviewAnalysis } from "./review-evidence.ts";

test("preparation retains the original numbering, including duplicate reviews", () => {
  const reviews = ["one", "two", "two", "four", "five", "six"].map((text) => ({
    text,
  }));
  assert.deepEqual(prepareReviewTexts(reviews), [
    "one",
    "two",
    "two",
    "four",
    "five",
  ]);
  assert.throws(() =>
    prepareReviewTexts([{ text: "one" }, { text: " " }, { text: "three" }]),
  );
  assert.deepEqual(prepareReviewTexts([]), []);
});

test("the shared text budget truncates only the last review, without splitting emoji", () => {
  const first = "x".repeat(7999);
  assert.deepEqual(
    prepareReviewTexts([{ text: first }, { text: "ab" }, { text: "c" }]),
    [first, "a"],
  );
  assert.deepEqual(
    prepareReviewTexts([{ text: first }, { text: "😀" }, { text: "c" }]),
    [first],
  );
});

test("validated analysis preserves relevance order or explicitly returns unknown", () => {
  for (const analysis of [
    { value: null, reviewNumbers: [] },
    { value: 1, reviewNumbers: [5] },
    { value: 3, reviewNumbers: [2, 1] },
    { value: 5, reviewNumbers: [4, 1, 3] },
  ])
    assert.deepEqual(parseReviewAnalysis(analysis, 5, 5), analysis);
});

test("analysis rejects unsupported scores, identifiers, counts, pairings and extra output", () => {
  for (const analysis of [
    null,
    [],
    {},
    { value: 2, reviewNumber: 1 },
    { value: 2, reviewNumbers: [1], text: "private" },
    ...[0, 5, 1.5, "3"].map((value) => ({ value, reviewNumbers: [1] })),
    ...[
      null,
      1,
      [],
      [1, 1],
      [1, 2, 3, 4],
      [0],
      [-1],
      [5],
      [1.5],
      ["2"],
      [null],
    ].map((reviewNumbers) => ({ value: 3, reviewNumbers })),
    { value: null, reviewNumbers: [2] },
  ])
    assert.throws(
      () => parseReviewAnalysis(analysis, 4, 4),
      /Invalid review analysis/,
    );
});
