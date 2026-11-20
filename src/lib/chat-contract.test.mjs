import assert from "node:assert/strict";
import test from "node:test";
import {
  EXAMPLES_PATTERN,
  isSearchPlacesFailure,
  parseChatErrorText,
  searchPlacesInputSchema,
  searchPlacesResultSchema,
} from "./chat-contract.ts";

const validInput = {
  textQuery: "カフェ 渋谷",
  evaluation: "電源がある",
  examples: "1 ... 電源は一切ない, 5 ... 全席に電源完備",
};

test("search_places input accepts the scoring examples format and optional flags", () => {
  assert.deepEqual(searchPlacesInputSchema.parse(validInput), validInput);
  const withFlags = searchPlacesInputSchema.parse({
    ...validInput,
    textQuery: "  喫茶店  ",
    openNow: true,
    maxResultCount: 5,
  });
  assert.equal(withFlags.textQuery, "喫茶店");
  assert.equal(withFlags.openNow, true);
  assert.equal(withFlags.maxResultCount, 5);
});

test("search_places input rejects a wrong examples format", () => {
  const rejects = (examples) =>
    assert.equal(
      searchPlacesInputSchema.safeParse({ ...validInput, examples }).success,
      false,
      examples,
    );
  rejects("電源は一切ない, 全席に電源完備");
  rejects("1: 電源は一切ない, 5: 全席に電源完備");
  rejects("1 ... 電源は一切ない");
  rejects("5 ... 全席に電源完備, 1 ... 電源は一切ない");
  rejects("1 ... , 5 ... 全席に電源完備");
  rejects("");
  assert.match("1 ... 騒がしい, 5 ... とても静か", EXAMPLES_PATTERN);
  assert.match(
    "1 ... 電源は一切ない, 3 ... 一部の席, 5 ... 全席に電源完備",
    EXAMPLES_PATTERN,
  );
});

test("search_places input rejects bad lengths, counts and extra keys", () => {
  const rejects = (body) =>
    assert.equal(searchPlacesInputSchema.safeParse(body).success, false);
  rejects({ ...validInput, textQuery: "" });
  rejects({ ...validInput, textQuery: "x".repeat(101) });
  rejects({ ...validInput, evaluation: "" });
  rejects({ ...validInput, evaluation: "x".repeat(201) });
  rejects({ ...validInput, maxResultCount: 0 });
  rejects({ ...validInput, maxResultCount: 21 });
  rejects({ ...validInput, maxResultCount: 2.5 });
  rejects({ ...validInput, rectangle: {} });
});

test("search_places result schema accepts success and failure shapes only", () => {
  const success = {
    searchId: "s1",
    textQuery: "カフェ",
    evaluation: "電源がある",
    examples: validInput.examples,
    places: [
      {
        placeId: "ChIJabc",
        name: "店",
        address: "東京",
        location: { lat: 35.6, lng: 139.7 },
        googleMapsUri: "https://maps.google.com/?cid=1",
        reviews: [],
      },
    ],
  };
  assert.deepEqual(searchPlacesResultSchema.parse(success), success);
  assert.equal(isSearchPlacesFailure(success), false);
  const failure = { error: { code: "BUDGET_RUN_EXCEEDED", message: "上限" } };
  assert.deepEqual(searchPlacesResultSchema.parse(failure), failure);
  assert.equal(isSearchPlacesFailure(failure), true);
  const rejects = (value) =>
    assert.equal(searchPlacesResultSchema.safeParse(value).success, false);
  rejects({ ...success, places: [{ placeId: "x" }] });
  rejects({ ...success, searchId: "" });
  rejects({ places: [] });
  rejects({ error: { code: "X" } });
  rejects({ ...success, extra: 1 });
});

test("parseChatErrorText reads the JSON error body and falls back to plain text", () => {
  assert.deepEqual(
    parseChatErrorText(
      JSON.stringify({
        error: { code: "BUDGET_MONTH_EXCEEDED", message: "m" },
      }),
    ),
    { code: "BUDGET_MONTH_EXCEEDED", message: "m" },
  );
  assert.deepEqual(parseChatErrorText("Failed to fetch"), {
    code: undefined,
    message: "Failed to fetch",
  });
  assert.deepEqual(parseChatErrorText('{"error":{"code":"X","message":""}}'), {
    code: undefined,
    message: '{"error":{"code":"X","message":""}}',
  });
});
