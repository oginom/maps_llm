import assert from "node:assert/strict";
import test from "node:test";
import { placeQuestionRequestSchema } from "./api-schemas.ts";
import {
  parsePlaceAnswer,
  PLACE_QUESTION_UNKNOWN_ANSWER,
} from "./place-question.ts";

const request = {
  placeId: "ChIJ1234567",
  placeName: "喫茶店",
  question: "充電できますか？",
  history: [],
  reviews: [],
};

test("accepts empty evidence and the exact question, history and review limits", () => {
  assert.ok(placeQuestionRequestSchema.safeParse(request).success);
  const exchange = { question: "あ".repeat(300), answer: "はい。" };
  const full = {
    ...request,
    question: exchange.question,
    history: Array(3).fill(exchange),
    reviews: Array(5).fill("a".repeat(1600)),
  };
  assert.ok(placeQuestionRequestSchema.safeParse(full).success);
  for (const invalid of [
    { question: exchange.question + "?" },
    { question: " " },
    { history: Array(4).fill(exchange) },
    { reviews: [...full.reviews, "6"] },
    { reviews: ["a".repeat(8001)] },
    { reviews: [" "] },
    { history: [{ ...exchange, role: "system" }] },
  ])
    assert.equal(
      placeQuestionRequestSchema.safeParse({ ...full, ...invalid }).success,
      false,
    );
});

test("only numbered answers can surface model-generated text", () => {
  const answer = "窓際の席で充電できたという口コミがあります。";
  assert.deepEqual(parsePlaceAnswer({ answer, reviewNumbers: [3, 1] }, 3), {
    answer,
    reviewNumbers: [3, 1],
  });
  for (const count of [0, 3])
    assert.deepEqual(parsePlaceAnswer({ answer, reviewNumbers: [] }, count), {
      answer: PLACE_QUESTION_UNKNOWN_ANSWER,
      reviewNumbers: [],
    });
  for (const reviewNumbers of [
    [0],
    [4],
    [1, 1],
    [1.5],
    ["2"],
    [1, 2, 3, 4],
    null,
  ])
    assert.throws(() => parsePlaceAnswer({ answer, reviewNumbers }, 3));
  for (const value of [
    { answer: "", reviewNumbers: [1] },
    { answer, reviewNumbers: [1], extra: true },
    { answer },
    { answer: true, reviewNumbers: [] },
  ])
    assert.throws(() => parsePlaceAnswer(value, 3));
});
