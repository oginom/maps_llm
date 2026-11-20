// Language model middleware that counts every chat model step on the budget
// ledger: reserve `openai.chat` before the provider call, settle it from the
// returned usage (input / output tokens) in `finally`. The agent's step limit
// (`stopWhen`) is not a budget mechanism; the ledger is.
//
// Kept free of Next.js imports so `node --test` can load it with a memory
// ledger and a mock model.
import type { LanguageModelMiddleware } from "ai";
import { openAiCostMicros, type BudgetType } from "./budget/config.ts";
import type {
  BudgetRequestContext,
  Reservation,
  SettleOutcome,
} from "./budget/ledger.ts";

type WrapGenerateOptions = Parameters<
  NonNullable<LanguageModelMiddleware["wrapGenerate"]>
>[0];
type WrapStreamOptions = Parameters<
  NonNullable<LanguageModelMiddleware["wrapStream"]>
>[0];
type GenerateResult = Awaited<ReturnType<WrapGenerateOptions["doGenerate"]>>;
type StreamResult = Awaited<ReturnType<WrapStreamOptions["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer PART> ? PART : never;
type ModelUsage = GenerateResult["usage"];

export type ChatBudgetLedger = {
  reserve: (
    context: BudgetRequestContext,
    type: BudgetType,
  ) => Promise<Reservation>;
  settle: (reservation: Reservation, outcome: SettleOutcome) => Promise<void>;
};

export type ChatModelCallEvent = {
  // Undefined when the provider returned no usage (the estimate was charged).
  inputTokens?: number;
  outputTokens?: number;
  micros?: number;
  // The call was never sent (aborted before the request).
  released: boolean;
};

export type ChatBudgetMiddlewareOptions = {
  context: BudgetRequestContext;
  ledger: ChatBudgetLedger;
  // Reserved by the route before the stream starts so a budget refusal is
  // answered with HTTP 429 instead of an error chunk. The first model call
  // consumes it; later calls reserve on their own.
  firstReservation?: Reservation;
  onCall?: (event: ChatModelCallEvent) => void;
};

export type ChatBudgetMiddleware = {
  middleware: LanguageModelMiddleware;
  // Releases `firstReservation` when no model call consumed it (validation
  // failed after the reservation, or the stream never started).
  releaseUnusedReservation: () => Promise<void>;
};

// Actual cost from the provider usage; `undefined` when neither token count
// is known, in which case the reservation is settled at its estimate.
export function usageCostMicros(usage: ModelUsage | undefined): {
  inputTokens?: number;
  outputTokens?: number;
  micros?: number;
} {
  const inputTokens = usage?.inputTokens?.total;
  const outputTokens = usage?.outputTokens?.total;
  if (inputTokens === undefined && outputTokens === undefined) return {};
  return {
    inputTokens,
    outputTokens,
    micros: openAiCostMicros(inputTokens ?? 0, outputTokens ?? 0),
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("aborted", "AbortError");
}

export function createChatBudgetMiddleware(
  options: ChatBudgetMiddlewareOptions,
): ChatBudgetMiddleware {
  const { context, ledger, onCall } = options;
  let pendingFirst = options.firstReservation;

  const takeReservation = async (): Promise<Reservation> => {
    if (pendingFirst) {
      const reservation = pendingFirst;
      pendingFirst = undefined;
      return reservation;
    }
    return ledger.reserve(context, "openai.chat");
  };

  // One call's accounting: settle exactly once, whatever path ends it.
  const startCall = async (signal: AbortSignal | undefined) => {
    const reservation = await takeReservation();
    let settled = false;
    let outcome: SettleOutcome = { kind: "release" };
    let usage: ModelUsage | undefined;
    const finish = async () => {
      if (settled) return;
      settled = true;
      if (outcome.kind === "settle") {
        const cost = usageCostMicros(usage);
        outcome = { kind: "settle", micros: cost.micros };
        onCall?.({ ...cost, released: false });
      } else onCall?.({ released: true });
      await ledger.settle(reservation, outcome);
    };
    if (signal?.aborted) {
      await finish();
      throw abortReason(signal);
    }
    // From here on the request is sent: the reservation is settled at the
    // actual usage, or at the estimate when the call fails without usage.
    outcome = { kind: "settle" };
    return {
      finish,
      recordUsage: (value: ModelUsage | undefined) => {
        usage = value;
      },
    };
  };

  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      const call = await startCall(params.abortSignal);
      try {
        const result = await doGenerate();
        call.recordUsage(result.usage);
        return result;
      } finally {
        await call.finish();
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const call = await startCall(params.abortSignal);
      let result: StreamResult;
      try {
        result = await doStream();
      } catch (error) {
        await call.finish();
        throw error;
      }
      // Watch the provider stream for the `finish` part (usage) and settle
      // when the stream ends, errors or is cancelled by the consumer.
      const reader = result.stream.getReader();
      const stream = new ReadableStream<StreamPart>({
        async pull(controller) {
          let chunk: ReadableStreamReadResult<StreamPart>;
          try {
            chunk = await reader.read();
          } catch (error) {
            await call.finish();
            controller.error(error);
            return;
          }
          if (chunk.done) {
            await call.finish();
            controller.close();
            return;
          }
          if (chunk.value.type === "finish")
            call.recordUsage(chunk.value.usage);
          controller.enqueue(chunk.value);
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            await call.finish();
          }
        },
      });
      return { ...result, stream };
    },
  };

  return {
    middleware,
    releaseUnusedReservation: async () => {
      if (!pendingFirst) return;
      const reservation = pendingFirst;
      pendingFirst = undefined;
      await ledger.settle(reservation, { kind: "release" });
    },
  };
}
