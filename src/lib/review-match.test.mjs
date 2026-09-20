import assert from "node:assert/strict";
import test from "node:test";
import { matchReview } from "./review-match.ts";
const review = {
  text: "窓際の席には電源があり、長時間の作業でも快適に過ごせました。店内は静かでした。",
  author: { name: "A" },
};
const other = {
  text: "駅に近くて便利です。ランチがおいしい。",
  author: { name: "B" },
};
test("attributes an exact excerpt to its unique source", () => {
  assert.equal(
    matchReview("長時間の作業でも快適に過ごせました。", [review, other]),
    review,
  );
});
test("ignores added ellipses, quotes, Japanese and ASCII punctuation", () => {
  assert.equal(
    matchReview(
      "「窓際の席には電源があり…長時間の作業でも快適に過ごせました」",
      [review, other],
    ),
    review,
  );
  assert.equal(
    matchReview('『（電源）・あり‥』"!', [{ text: "電源あり" }])?.text,
    "電源あり",
  );
});
test("attributes a unique long common substring despite a dropped particle", () => {
  assert.equal(
    matchReview("窓際の席には電源あり、長時間の作業でも快適に過ごせました。", [
      review,
      other,
    ]),
    review,
  );
});
test("accepts a unique 60 percent match with at least eight characters", () => {
  const source = { text: "静かな店内で仕事がはかどるカフェです" };
  assert.equal(
    matchReview("静かな店内で仕事がはかどる場所", [source, other]),
    source,
  );
});
test("returns no author for unrelated, empty or short generic fragments", () => {
  for (const text of [
    "駐車場が広く、週末のドライブにおすすめです",
    "…「」",
    "ありそう",
  ])
    assert.equal(matchReview(text, [review, other]), undefined);
});
test("does not attribute exact or fuzzy excerpts shared by two reviews", () => {
  assert.equal(
    matchReview("長時間の作業でも快適に過ごせました", [
      review,
      { ...review, author: { name: "C" } },
    ]),
    undefined,
  );
  assert.equal(
    matchReview("窓際の席には電源あり、長時間の作業でも快適に過ごせました。", [
      review,
      { ...review, author: { name: "C" } },
    ]),
    undefined,
  );
});
