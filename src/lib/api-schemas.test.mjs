import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeReviewsRequestSchema,
  formatIssues,
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
    pageSize: 20,
  });
  assert.equal(
    placeSearchRequestSchema.parse({
      textQuery: "a",
      rectangle: viewport,
      openNow: false,
      pageSize: 5,
    }).pageSize,
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
  rejects({ textQuery: "cafe", rectangle: viewport, pageSize: 0 });
  rejects({ textQuery: "cafe", rectangle: viewport, pageSize: 21 });
  rejects({ textQuery: "cafe", rectangle: viewport, pageSize: 2.5 });
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
    reviews: ["電源あり"],
    metric: "電源がある",
    examples: "1 ... なし, 5 ... 全席",
  });
  assert.equal(parsed.scale, "5");
  const rejects = (body) =>
    assert.equal(analyzeReviewsRequestSchema.safeParse(body).success, false);
  for (const reviews of [
    "x",
    [],
    ["x", ""],
    [" "],
    [123],
    Array(6).fill("x"),
    ["x".repeat(8000), "y"],
  ]) {
    rejects({ reviews, metric: "m", examples: "" });
  }
  rejects({ reviews: ["x"], metric: "", examples: "" });
  rejects({ reviews: ["x"], metric: "m".repeat(201), examples: "" });
  rejects({ reviews: ["x"], metric: "m", examples: "e".repeat(1001) });
  rejects({ reviews: ["x"], metric: "m", examples: ["a"] });
  rejects({ reviews: ["x"], metric: "m", examples: "", scale: "10" });
  rejects({ reviews: ["x"], metric: "m", examples: "", model: "gpt" });
  assert.equal(
    analyzeReviewsRequestSchema.safeParse({
      reviews: Array(5).fill("x".repeat(1600)),
      metric: "m",
      examples: "",
      scale: "5",
    }).success,
    true,
  );
});

test("invalid analysis input reports each affected field", () => {
  const result = analyzeReviewsRequestSchema.safeParse({
    reviews: [],
    metric: "",
    examples: "",
  });
  assert.equal(result.success, false);
  const message = formatIssues(result.error);
  assert.match(message, /reviews/);
  assert.match(message, /metric/);
});

test("chat request accepts UI messages with a viewport and applies limits", async () => {
  const { chatRequestSchema, MAX_CHAT_MESSAGES, MAX_CHAT_TEXT_LENGTH } =
    await import("./api-schemas.ts");
  const viewportBounds = { north: 35.7, south: 35.6, east: 139.8, west: 139.7 };
  const user = (id, text) => ({
    id,
    role: "user",
    parts: [{ type: "text", text }],
  });
  const body = {
    messages: [
      user("u1", "渋谷で電源があるカフェ"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-search_places",
            toolCallId: "call_1",
            state: "output-available",
            input: { textQuery: "カフェ 渋谷" },
            output: { searchId: "s", places: [] },
          },
          { type: "text", text: "候補が見つかりました。" },
        ],
      },
      user("u2", "もう少し静かな店"),
    ],
    viewport: viewportBounds,
    selectedPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  };
  const parsed = chatRequestSchema.parse(body);
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.selectedPlaceId, body.selectedPlaceId);
  assert.deepEqual(parsed.viewport, viewportBounds);
  assert.equal(
    chatRequestSchema.parse({
      messages: [user("u1", "x")],
      viewport: viewportBounds,
    }).selectedPlaceId,
    undefined,
  );

  const rejects = (value, label) =>
    assert.equal(chatRequestSchema.safeParse(value).success, false, label);
  rejects({ messages: [], viewport: viewportBounds }, "empty");
  rejects({ messages: [user("u1", "x")] }, "no viewport");
  rejects(
    { messages: [user("u1", "x")], viewport: { ...viewportBounds, north: 91 } },
    "bad viewport",
  );
  rejects(
    {
      messages: [
        user("u1", "x"),
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "y" }] },
      ],
      viewport: viewportBounds,
    },
    "last message not user",
  );
  rejects(
    {
      messages: [
        { id: "s1", role: "system", parts: [{ type: "text", text: "x" }] },
      ],
      viewport: viewportBounds,
    },
    "system role",
  );
  rejects(
    {
      messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, (_, index) =>
        user(`u${index}`, "x"),
      ),
      viewport: viewportBounds,
    },
    "too many messages",
  );
  rejects(
    {
      messages: [user("u1", "x".repeat(MAX_CHAT_TEXT_LENGTH)), user("u2", "y")],
      viewport: viewportBounds,
    },
    "too much text",
  );
  assert.equal(
    chatRequestSchema.safeParse({
      messages: [user("u1", "x".repeat(MAX_CHAT_TEXT_LENGTH))],
      viewport: viewportBounds,
    }).success,
    true,
    "text at the limit",
  );
  rejects(
    {
      messages: [user("u1", "x")],
      viewport: viewportBounds,
      selectedPlaceId: "!",
    },
    "bad place id",
  );
  rejects(
    { messages: [user("u1", "x")], viewport: viewportBounds, id: "chat" },
    "extra key",
  );
  rejects(
    {
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text" }], extra: 1 },
      ],
      viewport: viewportBounds,
    },
    "extra message key",
  );
});
