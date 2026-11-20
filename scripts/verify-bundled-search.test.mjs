import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { frames, verify } from "./verify-bundled-search.mjs";
import { MAX_REVIEWS_TEXT_LENGTH } from "../src/lib/place-dto.ts";

const secret = "合成の非公開文字列☕";
const bytes = (text, width = 1) => {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < encoded.length; i += width)
        controller.enqueue(encoded.subarray(i, i + width));
      controller.close();
    },
  });
};
test("split UTF-8, CR/LF/CRLF, multiline data, coalesced frames", async () => {
  const stream = `: comment\rdata: {"value":\r\ndata: "${secret}"}\r\n\r\ndata: [DONE]\n\n`;
  for (const width of [1, 2, 3, 1000]) {
    assert.deepEqual(await Array.fromAsync(frames(bytes(stream, width))), [
      { value: secret },
    ]);
  }
});
test("incomplete frame, JSON, missing terminator and invalid UTF-8 redact input", async () => {
  for (const body of [
    bytes(`data: "${secret}"\n`),
    bytes(`data: ${secret}\n\n`),
    bytes(`data: "${secret}"\n\n`),
    new Response(new Uint8Array([100, 97, 116, 97, 58, 255])).body,
  ]) {
    await assert.rejects(Array.fromAsync(frames(body)), {
      message: "Invalid or incomplete chat stream",
    });
  }
});

function mockChat() {
  const place = {
    placeId: "0",
    name: secret,
    address: "",
    location: { lat: 0, lng: 0 },
    googleMapsUri: "",
    reviews: [
      {
        text: secret.repeat(5_000),
        rating: 5,
        publishTime: "",
        relativePublishTimeDescription: "",
        author: { name: secret },
      },
    ],
  };
  const places = [
    place,
    ...Array.from({ length: 22 }, (_, i) => ({
      ...place,
      placeId: String(i),
      reviews: i === 1 ? [] : place.reviews,
    })),
  ];
  const output = {
    searchId: "test",
    textQuery: "cafe",
    evaluation: "metric",
    examples: "examples",
    places,
  };
  const input = {
    type: "tool-input-start",
    toolName: "search_places",
    toolCallId: "one",
  };
  const event = { type: "tool-output-available", toolCallId: "one", output };
  return new Response(
    bytes(
      [input, event, { ...event, output: { ...output, places: [] } }]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join("") + "data: [DONE]\n\n",
      8191,
    ),
  );
}
test("mock full run mirrors page requests, deduplicates, caps, matches and counts only", async () => {
  let active = 0,
    peak = 0,
    chat = 0;
  const ids = new Set();
  const stats = await verify({
    request: async (url, options) => {
      ids.add(options.headers["X-Run-Id"] + options.headers["X-Session-Id"]);
      if (url.endsWith("/chat")) {
        chat++;
        return mockChat();
      }
      const body = JSON.parse(options.body);
      assert.deepEqual(
        [body.metric, body.examples, body.scale, body.reviews.length],
        ["metric", "examples", "5", MAX_REVIEWS_TEXT_LENGTH],
      );
      peak = Math.max(peak, ++active);
      await setImmediate();
      active--;
      return Response.json({ value: 5, related_review: secret });
    },
  });
  assert.deepEqual(
    [
      chat,
      ids.size,
      peak,
      stats.candidates,
      stats.attempts,
      stats.scores,
      stats.matchedWithAuthor,
    ],
    [1, 1, 5, 23, 19, 19, 19],
  );
  assert.ok(
    stats.candidatesMs <= stats.fifthScoreMs &&
      stats.fifthScoreMs <= stats.lastScoreMs,
  );
  assert.ok(stats.streamComplete && !JSON.stringify(stats).includes(secret));
});
test("upstream exceptions, error events and budget bodies never escape; no later budget wave", async () => {
  for (const request of [
    () => {
      throw new Error(secret);
    },
    () =>
      new Response(
        `data: ${JSON.stringify({ type: "error", errorText: secret })}\n\n`,
      ),
    () => new Response(secret, { status: 502 }),
  ]) {
    const stats = await verify({ request });
    assert.ok(stats.failure && !JSON.stringify(stats).includes(secret));
  }
  const stats = await verify({
    request: (url) =>
      url.endsWith("/chat")
        ? mockChat()
        : Response.json(
            { error: { code: "BUDGET_" + secret, message: secret } },
            { status: 429 },
          ),
  });
  assert.deepEqual(
    [stats.scoreErrors, stats.budgetStop, stats.scores],
    [4, true, 0],
  );
  assert.ok(!JSON.stringify(stats).includes(secret));
});
