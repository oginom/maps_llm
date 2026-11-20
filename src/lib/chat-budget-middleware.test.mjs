import assert from "node:assert/strict";
import test from "node:test";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { DEFAULT_BUDGET_CAPS, OPENAI_RESERVE_MICROS } from "./budget/config.ts";
import { BudgetExceededError } from "./budget/errors.ts";
import { Ledger, monthDocId, sessionDocId } from "./budget/ledger.ts";
import { MemoryLedgerStore } from "./budget/memory-store.ts";
import {
  createChatBudgetMiddleware,
  usageCostMicros,
} from "./chat-budget-middleware.ts";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const context = { sessionId: SESSION, runId: RUN };
const CHAT_ESTIMATE = OPENAI_RESERVE_MICROS["openai.chat"];

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

const finishReason = { unified: "stop", raw: "stop" };

function generateResult(tokens = usage(1000, 100)) {
  return {
    content: [{ type: "text", text: "ok" }],
    finishReason,
    usage: tokens,
    warnings: [],
  };
}

function streamResult(tokens = usage(1000, 100)) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "ok" },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason, usage: tokens },
      ],
    }),
  };
}

const callOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

async function drain(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

test("usageCostMicros prices input and output tokens, undefined without usage", () => {
  assert.deepEqual(usageCostMicros(usage(1000, 100)), {
    inputTokens: 1000,
    outputTokens: 100,
    micros: 320,
  });
  assert.deepEqual(usageCostMicros(undefined), {});
  assert.deepEqual(
    usageCostMicros({
      inputTokens: { total: undefined },
      outputTokens: { total: undefined },
    }),
    {},
  );
  assert.equal(usageCostMicros(usage(20_000, 2_000)).micros, CHAT_ESTIMATE);
  assert.equal(CHAT_ESTIMATE, 6_400);
});

test("generate: reserves openai.chat before the call and settles the usage cost", async () => {
  const { ledger, session, month } = createLedger();
  const calls = [];
  const budget = createChatBudgetMiddleware({
    context,
    ledger,
    onCall: (event) => calls.push(event),
  });
  let reservedDuringCall;
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => {
        reservedDuringCall = session().reservedMicros;
        return generateResult(usage(1000, 100));
      },
    }),
    middleware: budget.middleware,
  });
  const result = await model.doGenerate(callOptions);
  assert.equal(result.content[0].text, "ok");
  assert.equal(reservedDuringCall, CHAT_ESTIMATE);
  const doc = session();
  assert.equal(doc.counts["openai.chat"], 1);
  assert.equal(doc.reservedCounts["openai.chat"], 0);
  assert.equal(doc.settledMicros, 320);
  assert.equal(doc.reservedMicros, 0);
  assert.equal(doc.run.counts["openai.chat"], 1);
  assert.deepEqual(doc.pending, {});
  assert.equal(month().counts["openai.chat"], 1);
  assert.deepEqual(calls, [
    { inputTokens: 1000, outputTokens: 100, micros: 320, released: false },
  ]);
});

test("stream: settles from the finish part when the stream ends", async () => {
  const { ledger, session } = createLedger();
  const calls = [];
  const budget = createChatBudgetMiddleware({
    context,
    ledger,
    onCall: (event) => calls.push(event),
  });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doStream: async () => streamResult(usage(2000, 50)),
    }),
    middleware: budget.middleware,
  });
  const result = await model.doStream(callOptions);
  // Still reserved while the stream is open.
  assert.equal(session().reservedMicros, CHAT_ESTIMATE);
  assert.equal(calls.length, 0);
  const parts = await drain(result.stream);
  assert.deepEqual(
    parts.map((part) => part.type),
    ["stream-start", "text-start", "text-delta", "text-end", "finish"],
  );
  const doc = session();
  assert.equal(doc.counts["openai.chat"], 1);
  assert.equal(doc.settledMicros, 460);
  assert.equal(doc.reservedMicros, 0);
  assert.deepEqual(calls, [
    { inputTokens: 2000, outputTokens: 50, micros: 460, released: false },
  ]);
});

test("stream: a cancelled stream without usage settles at the estimate", async () => {
  const { ledger, session } = createLedger();
  const budget = createChatBudgetMiddleware({ context, ledger });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doStream: async () => streamResult(),
    }),
    middleware: budget.middleware,
  });
  const result = await model.doStream(callOptions);
  const reader = result.stream.getReader();
  await reader.read(); // stream-start
  await reader.cancel("client aborted");
  const doc = session();
  assert.equal(doc.counts["openai.chat"], 1);
  assert.equal(doc.settledMicros, CHAT_ESTIMATE);
  assert.equal(doc.reservedMicros, 0);
});

test("stream: a failing provider call settles at the estimate and rethrows", async () => {
  const { ledger, session } = createLedger();
  const budget = createChatBudgetMiddleware({ context, ledger });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("upstream down");
      },
    }),
    middleware: budget.middleware,
  });
  await assert.rejects(model.doStream(callOptions), /upstream down/);
  const doc = session();
  assert.equal(doc.counts["openai.chat"], 1);
  assert.equal(doc.settledMicros, CHAT_ESTIMATE);
  assert.equal(doc.reservedMicros, 0);
});

test("stream: an errored provider stream still settles once", async () => {
  const { ledger, session } = createLedger();
  const calls = [];
  const budget = createChatBudgetMiddleware({
    context,
    ledger,
    onCall: (event) => calls.push(event),
  });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.error(new Error("socket closed"));
          },
        }),
      }),
    }),
    middleware: budget.middleware,
  });
  const result = await model.doStream(callOptions);
  await assert.rejects(drain(result.stream), /socket closed/);
  assert.equal(calls.length, 1);
  assert.equal(session().settledMicros, CHAT_ESTIMATE);
  assert.equal(session().reservedMicros, 0);
});

test("an already-aborted call is not sent and its reservation is released", async () => {
  const { ledger, session } = createLedger();
  const calls = [];
  const budget = createChatBudgetMiddleware({
    context,
    ledger,
    onCall: (event) => calls.push(event),
  });
  let sent = false;
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => {
        sent = true;
        return generateResult();
      },
    }),
    middleware: budget.middleware,
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    model.doGenerate({ ...callOptions, abortSignal: controller.signal }),
  );
  assert.equal(sent, false);
  const doc = session();
  assert.equal(doc.counts["openai.chat"] ?? 0, 0);
  assert.equal(doc.reservedMicros, 0);
  assert.equal(doc.settledMicros, 0);
  assert.deepEqual(calls, [{ released: true }]);
});

test("the pre-reserved first step is consumed by the first call only", async () => {
  const { ledger, session } = createLedger();
  const first = await ledger.reserve(context, "openai.chat");
  const budget = createChatBudgetMiddleware({
    context,
    ledger,
    firstReservation: first,
  });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => generateResult(usage(100, 10)),
    }),
    middleware: budget.middleware,
  });
  assert.equal(session().reservedCounts["openai.chat"], 1);
  await model.doGenerate(callOptions);
  assert.equal(session().counts["openai.chat"], 1);
  assert.equal(session().reservedCounts["openai.chat"], 0);
  assert.equal(Object.keys(session().pending).length, 0);
  await model.doGenerate(callOptions);
  assert.equal(session().counts["openai.chat"], 2);
  assert.equal(session().settledMicros, 64);
  // Nothing left to release.
  await budget.releaseUnusedReservation();
  assert.equal(session().counts["openai.chat"], 2);
});

test("releaseUnusedReservation frees a first reservation no call consumed", async () => {
  const { ledger, session } = createLedger();
  const first = await ledger.reserve(context, "openai.chat");
  const budget = createChatBudgetMiddleware({
    context,
    ledger,
    firstReservation: first,
  });
  assert.equal(session().reservedMicros, CHAT_ESTIMATE);
  await budget.releaseUnusedReservation();
  assert.equal(session().reservedMicros, 0);
  assert.equal(session().counts["openai.chat"] ?? 0, 0);
  assert.deepEqual(session().pending, {});
});

test("the per-run chat step count refuses the fifth model call of a run", async () => {
  const { ledger } = createLedger();
  const budget = createChatBudgetMiddleware({ context, ledger });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => generateResult(usage(10, 1)),
    }),
    middleware: budget.middleware,
  });
  for (
    let index = 0;
    index < DEFAULT_BUDGET_CAPS.run["openai.chat"];
    index += 1
  )
    await model.doGenerate(callOptions);
  await assert.rejects(model.doGenerate(callOptions), (error) => {
    assert.ok(error instanceof BudgetExceededError);
    assert.equal(error.code, "BUDGET_RUN_EXCEEDED");
    assert.equal(error.type, "openai.chat");
    assert.match(error.message, /チャットの応答/);
    return true;
  });
  // A new run starts from zero; the session count carries on.
  const other = {
    sessionId: SESSION,
    runId: "33333333-3333-4333-8333-333333333333",
  };
  const budget2 = createChatBudgetMiddleware({ context: other, ledger });
  const model2 = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => generateResult(usage(10, 1)),
    }),
    middleware: budget2.middleware,
  });
  await model2.doGenerate(callOptions);
});

test("the micro-USD cap still applies to chat steps", async () => {
  const { ledger } = createLedger({
    run: { openaiMicros: CHAT_ESTIMATE + 100 },
  });
  const budget = createChatBudgetMiddleware({ context, ledger });
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      // Settles at 320 micros, leaving room for a second reservation? No:
      // 320 + 6,400 > 6,500.
      doGenerate: async () => generateResult(usage(1000, 100)),
    }),
    middleware: budget.middleware,
  });
  await model.doGenerate(callOptions);
  await assert.rejects(model.doGenerate(callOptions), (error) => {
    assert.ok(error instanceof BudgetExceededError);
    assert.equal(error.scope, "run");
    return true;
  });
});
