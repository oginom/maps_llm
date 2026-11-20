import assert from "node:assert/strict";
import test from "node:test";
import { createAgentUIStream } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { DEFAULT_BUDGET_CAPS } from "./budget/config.ts";
import { Ledger, monthDocId, sessionDocId } from "./budget/ledger.ts";
import { MemoryLedgerStore } from "./budget/memory-store.ts";
import { createChatAgent, createSearchPlacesTool } from "./chat-agent.ts";
import { searchPlacesResultSchema } from "./chat-contract.ts";
import { MapChatTransport } from "./chat-transport.ts";
import {
  chatStreamErrorBody as chatStreamErrorBodyForTest,
  chatStreamErrorText,
} from "./chat-stream-error.ts";
import { PlacesApiError } from "./places-new.ts";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const budgetContext = { sessionId: SESSION, runId: RUN };
const rectangle = {
  low: { lat: 35.6, lng: 139.7 },
  high: { lat: 35.7, lng: 139.8 },
};

function createLedger(overrides = {}) {
  const store = new MemoryLedgerStore();
  const ledger = new Ledger({
    store,
    caps: {
      month: { ...DEFAULT_BUDGET_CAPS.month, ...overrides.month },
      session: { ...DEFAULT_BUDGET_CAPS.session, ...overrides.session },
      run: { ...DEFAULT_BUDGET_CAPS.run, ...overrides.run },
    },
    now: () => new Date("2026-09-21T10:00:00Z"),
    sleep: async () => {},
  });
  return {
    store,
    ledger: {
      reserve: (ctx, type) => ledger.reserve(ctx, type),
      settle: (reservation, outcome) => ledger.settle(reservation, outcome),
    },
    session: () => store.get(sessionDocId(SESSION)).data,
    month: () => store.get(monthDocId("2026-09")).data,
  };
}

const usage = (inputTokens, outputTokens) => ({
  inputTokens: {
    total: inputTokens,
    noCache: inputTokens,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
});

const toolInput = {
  textQuery: "カフェ 渋谷",
  evaluation: "電源がある",
  examples: "1 ... 電源は一切ない, 5 ... 全席に電源完備",
};

function toolCallStep(input = toolInput) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "call_1", toolName: "search_places" },
        {
          type: "tool-input-delta",
          id: "call_1",
          delta: JSON.stringify(input),
        },
        { type: "tool-input-end", id: "call_1" },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "search_places",
          input: JSON.stringify(input),
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: usage(1500, 80),
        },
      ],
    }),
  };
}

function answerStep(text) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: text },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: usage(2000, 60),
        },
      ],
    }),
  };
}

const places = [
  {
    placeId: "ChIJ-shibuya-1",
    name: "カフェ A",
    address: "渋谷区",
    location: { lat: 35.66, lng: 139.7 },
    googleMapsUri: "https://maps.google.com/?cid=1",
    reviews: [
      {
        text: "review-visible-only-to-scoring-and-browser",
        rating: 4,
        author: {
          name: "attributed-reviewer",
          uri: "https://maps.example/author",
        },
        publishTime: "2026-09-21",
        relativePublishTimeDescription: "昨日",
        googleMapsUri: "https://maps.example/review",
      },
    ],
  },
  {
    placeId: "ChIJ-shibuya-2",
    name: "カフェ B",
    address: "渋谷区",
    location: { lat: 35.661, lng: 139.701 },
    googleMapsUri: "https://maps.google.com/?cid=2",
    reviews: [],
  },
];

const userMessage = (text) => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test("agent: a category-only query reaches Places with the supplied viewport; ledger counts both steps", async () => {
  const { ledger, session, month } = createLedger();
  const searchCalls = [];
  const modelCalls = [];
  const firstReservation = await ledger.reserve(budgetContext, "openai.chat");
  const { agent } = createChatAgent({
    rectangle,
    budgetContext,
    ledger,
    firstReservation,
    onModelCall: (event) => modelCalls.push(event),
    newSearchId: () => "search-1",
    searchPlaces: async (input, options) => {
      searchCalls.push(input);
      options.onRequestSent?.();
      return places;
    },
    model: new MockLanguageModelV4({
      doStream: [
        toolCallStep({ ...toolInput, textQuery: "カフェ" }),
        answerStep(
          "『電源がある』を条件に、カフェの候補が 2 件見つかりました。",
        ),
      ],
    }),
  });

  const stream = await createAgentUIStream({
    agent,
    uiMessages: [userMessage("電源があるカフェ")],
  });
  const chunks = await collect(stream);
  const types = chunks.map((chunk) => chunk.type);
  const collapsed = types.filter((type, index) => types[index - 1] !== type);
  assert.deepEqual(collapsed, [
    "start",
    "start-step",
    "tool-input-start",
    "tool-input-delta",
    "tool-input-available",
    "tool-output-available",
    "finish-step",
    "start-step",
    "text-start",
    "text-delta",
    "text-end",
    "finish-step",
    "finish",
  ]);

  const inputChunk = chunks.find((c) => c.type === "tool-input-available");
  assert.equal(inputChunk.toolName, "search_places");
  assert.deepEqual(inputChunk.input, { ...toolInput, textQuery: "カフェ" });
  const outputChunk = chunks.find((c) => c.type === "tool-output-available");
  assert.equal(outputChunk.toolCallId, inputChunk.toolCallId);
  assert.deepEqual(outputChunk.output, {
    searchId: "search-1",
    textQuery: "カフェ",
    evaluation: "電源がある",
    examples: "1 ... 電源は一切ない, 5 ... 全席に電源完備",
    places,
  });
  assert.deepEqual(searchCalls, [
    {
      textQuery: "カフェ",
      rectangle,
      openNow: undefined,
      pageSize: 20,
    },
  ]);
  assert.equal(
    chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join(""),
    "『電源がある』を条件に、カフェの候補が 2 件見つかりました。",
  );

  // Two model steps (the first consumed the pre-reservation), one search.
  const doc = session();
  assert.equal(doc.counts["openai.chat"], 2);
  assert.equal(doc.counts["places.search"], 1);
  assert.equal(doc.reservedMicros, 0);
  assert.deepEqual(doc.reservedCounts, {
    "openai.chat": 0,
    "places.search": 0,
  });
  assert.equal(doc.settledMicros, 300 + 96 + 400 + 72);
  assert.deepEqual(doc.pending, {});
  assert.equal(month().listPriceMicros, 40_000);
  assert.equal(modelCalls.length, 2);
  assert.deepEqual(modelCalls[0], {
    inputTokens: 1500,
    outputTokens: 80,
    micros: 396,
    released: false,
  });
});

test("review attribution reaches the browser, but reviews never enter follow-up steps, POSTs or replayed prompts", async (t) => {
  const model = new MockLanguageModelV4({
    doStream: [
      toolCallStep(),
      answerStep("2 件です。"),
      answerStep("はい。"),
      answerStep("はい。"),
    ],
  });
  const createAgent = () =>
    createChatAgent({
      rectangle,
      budgetContext,
      ledger: createLedger().ledger,
      searchPlaces: async () => places,
      model,
    }).agent;
  const first = userMessage("渋谷でカフェ");
  const chunks = await collect(
    await createAgentUIStream({ agent: createAgent(), uiMessages: [first] }),
  );
  const output = searchPlacesResultSchema.parse(
    chunks.find((chunk) => chunk.type === "tool-output-available").output,
  );
  assert.deepEqual(output.places[0].reviews, places[0].reviews);
  const history = [
    first,
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-search_places",
          state: "output-available",
          toolCallId: "call_1",
          input: toolInput,
          output,
        },
        { type: "text", text: "2 件です。" },
      ],
    },
    { ...userMessage("件数は？"), id: "u2" },
  ];
  let posted;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/chat");
    assert.equal(options.method, "POST");
    posted = JSON.parse(options.body).messages;
    return new Response("data: [DONE]\n\n");
  });
  const transport = new MapChatTransport();
  transport.setRequestContext({
    runId: RUN,
    viewport: { north: 35.7, south: 35.6, east: 139.8, west: 139.7 },
    selectedPlaceId: null,
  });
  await collect(
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test",
      messages: history,
    }),
  );
  const assertCompact = (value) => {
    const json = JSON.stringify(value);
    assert.match(json, /候補 2 件/);
    assert.doesNotMatch(
      json,
      /review-visible-only|attributed-reviewer|maps\.example|ChIJ-shibuya/,
    );
  };
  assertCompact(posted);
  // Exercise both the compact transport payload and SDK conversion of a
  // full UI history received directly by the server.
  for (const uiMessages of [posted, history])
    await collect(
      await createAgentUIStream({ agent: createAgent(), uiMessages }),
    );
  assert.equal(model.doStreamCalls.length, 4);
  for (const call of model.doStreamCalls.slice(1)) assertCompact(call.prompt);
});

test("search_places forwards an explicitly requested smaller count", async () => {
  const { ledger } = createLedger();
  const searchCalls = [];
  const tool = createSearchPlacesTool({
    rectangle,
    budgetContext,
    ledger,
    searchPlaces: async (input, options) => {
      searchCalls.push(input.pageSize);
      options.onRequestSent?.();
      return places;
    },
  });
  await tool.execute(
    { ...toolInput, maxResultCount: 3 },
    { toolCallId: "call_1", messages: [] },
  );
  assert.deepEqual(searchCalls, [3]);
});

test("agent: a budget refusal of the search is returned as a tool error value", async () => {
  const { ledger, session } = createLedger({ run: { "places.search": 0 } });
  let searched = false;
  const { agent } = createChatAgent({
    rectangle,
    budgetContext,
    ledger,
    searchPlaces: async () => {
      searched = true;
      return places;
    },
    model: new MockLanguageModelV4({
      doStream: [
        toolCallStep(),
        answerStep("この検索の利用上限に達しました。"),
      ],
    }),
  });
  const chunks = await collect(
    await createAgentUIStream({
      agent,
      uiMessages: [userMessage("渋谷で電源があるカフェ")],
    }),
  );
  const outputChunk = chunks.find((c) => c.type === "tool-output-available");
  assert.equal(outputChunk.output.error.code, "BUDGET_RUN_EXCEEDED");
  assert.match(outputChunk.output.error.message, /場所の検索/);
  assert.equal(searched, false);
  assert.equal(
    chunks.some((c) => c.type === "error"),
    false,
  );
  assert.equal(session().counts["openai.chat"], 2);
  assert.equal(session().counts["places.search"] ?? 0, 0);
});

test("search_places tool: Google errors become values, the unit is settled once sent", async () => {
  const { ledger, session, month } = createLedger();
  const tool = createSearchPlacesTool({
    rectangle,
    budgetContext,
    ledger,
    searchPlaces: async (_input, options) => {
      options.onRequestSent?.();
      throw new PlacesApiError({
        httpStatus: 429,
        googleStatus: "RESOURCE_EXHAUSTED",
        message: "Google Places の検索上限に達しました。",
      });
    },
  });
  const result = await tool.execute(toolInput, {
    toolCallId: "call_1",
    messages: [],
  });
  assert.deepEqual(result, {
    error: {
      code: "RESOURCE_EXHAUSTED",
      message: "Google Places の検索上限に達しました。",
    },
  });
  assert.equal(session().counts["places.search"], 1);
  assert.equal(month().listPriceMicros, 40_000);

  // A failure before the request is sent releases the unit instead.
  const before = createSearchPlacesTool({
    rectangle,
    budgetContext,
    ledger,
    searchPlaces: async () => {
      throw new PlacesApiError({
        httpStatus: 500,
        googleStatus: "MISSING_API_KEY",
        message: "キー未設定",
      });
    },
  });
  const released = await before.execute(toolInput, {
    toolCallId: "call_2",
    messages: [],
  });
  assert.equal(released.error.code, "MISSING_API_KEY");
  assert.equal(session().counts["places.search"], 1);
  assert.equal(session().reservedCounts["places.search"], 0);

  // Unexpected exceptions are not converted.
  const bug = createSearchPlacesTool({
    rectangle,
    budgetContext,
    ledger,
    searchPlaces: async () => {
      throw new TypeError("bug");
    },
  });
  await assert.rejects(
    bug.execute(toolInput, { toolCallId: "call_3", messages: [] }),
    TypeError,
  );
  assert.equal(session().reservedCounts["places.search"], 0);
});

test("agent: an examples string in the wrong format is rejected before the tool runs", async () => {
  const { ledger } = createLedger();
  let searched = false;
  const badInput = { ...toolInput, examples: "低い, 高い" };
  const { agent } = createChatAgent({
    rectangle,
    budgetContext,
    ledger,
    searchPlaces: async () => {
      searched = true;
      return places;
    },
    model: new MockLanguageModelV4({
      doStream: [
        toolCallStep(badInput),
        answerStep("形式を直して再試行します。"),
        answerStep("終了"),
      ],
    }),
  });
  const logged = [];
  const chunks = await collect(
    await createAgentUIStream({
      agent,
      uiMessages: [userMessage("渋谷で電源があるカフェ")],
      onError: (error) =>
        JSON.stringify(
          chatStreamErrorBodyForTest(error, undefined, (line) =>
            logged.push(line),
          ),
        ),
    }),
  );
  assert.equal(searched, false);
  // The invalid call is reported twice: as the input error and as the tool
  // output error the model sees; both carry the same body.
  const errorChunks = chunks.filter(
    (c) => c.type === "tool-input-error" || c.type === "tool-output-error",
  );
  assert.deepEqual(
    errorChunks.map((c) => c.type),
    ["tool-input-error", "tool-output-error"],
    JSON.stringify(chunks.map((c) => c.type)),
  );
  for (const chunk of errorChunks)
    assert.deepEqual(JSON.parse(chunk.errorText), {
      error: {
        code: "INVALID_TOOL_INPUT",
        message:
          "AI が生成した検索条件の形式が不正でした。もう一度送信してください。",
      },
    });
  // The log lines name the tool, never the generated input.
  assert.equal(logged.length, 2);
  assert.match(logged[0], /tool=search_places/);
  for (const line of logged) assert.doesNotMatch(line, /低い/);
  assert.equal(
    chunks.some((c) => c.type === "tool-output-available"),
    false,
  );
  assert.equal(
    chunks.some((c) => c.type === "error"),
    false,
  );
  // The default text of the route helper has the same shape.
  assert.equal(
    typeof JSON.parse(chatStreamErrorText(new Error("x"))).error.message,
    "string",
  );
});
