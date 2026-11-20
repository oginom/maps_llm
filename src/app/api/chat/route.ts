import { createAgentUIStreamResponse, TypeValidationError } from "ai";
import { chatRequestSchema } from "@/lib/api-schemas";
import { isClientAbort } from "@/lib/abort";
import {
  budgetErrorResponse,
  clientAbortedResponse,
  errorResponse,
  internalErrorResponse,
  logRoute,
  parseJsonBody,
  requireBudgetContext,
} from "@/lib/api-route";
import {
  reserveBudget,
  settleReservation,
  type Reservation,
} from "@/lib/budget/ledger";
import { createChatAgent } from "@/lib/chat-agent";
import { chatStreamErrorText } from "@/lib/chat-stream-error";
import { viewportToRectangle } from "@/lib/viewport";

const ROUTE = "chat";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const budget = requireBudgetContext(request, ROUTE, startedAt);
  if (!budget.ok) return budget.response;
  const parsed = await parseJsonBody(request, chatRequestSchema);
  if (!parsed.ok) {
    logRoute(ROUTE, 400, startedAt, "invalid input");
    return parsed.response;
  }
  if (request.signal.aborted) return clientAbortedResponse(ROUTE, startedAt);

  // The first model step is reserved before streaming so a budget refusal or
  // a ledger outage is a normal 429 / 503 response, not an error chunk.
  let firstReservation: Reservation;
  try {
    firstReservation = await reserveBudget(budget.context, "openai.chat");
  } catch (error) {
    return (
      budgetErrorResponse(ROUTE, error, startedAt) ??
      internalErrorResponse(ROUTE, error, startedAt)
    );
  }

  const stats = {
    steps: 0,
    toolCalls: 0,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    micros: 0,
  };
  const { agent, releaseUnusedReservation } = createChatAgent({
    rectangle: viewportToRectangle(parsed.data.viewport),
    budgetContext: budget.context,
    ledger: { reserve: reserveBudget, settle: settleReservation },
    firstReservation,
    onModelCall: (event) => {
      if (event.released) return;
      stats.modelCalls += 1;
      stats.inputTokens += event.inputTokens ?? 0;
      stats.outputTokens += event.outputTokens ?? 0;
      stats.micros += event.micros ?? 0;
    },
  });

  try {
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: parsed.data.messages,
      abortSignal: request.signal,
      onStepEnd: (step) => {
        stats.steps += 1;
        stats.toolCalls += step.toolCalls.length;
      },
      onError: (error) => chatStreamErrorText(error, request.signal),
      onEnd: async ({ isAborted, finishReason }) => {
        await releaseUnusedReservation();
        logRoute(
          ROUTE,
          isAborted ? 499 : 200,
          startedAt,
          `messages=${parsed.data.messages.length} steps=${stats.steps} tool_calls=${stats.toolCalls} model_calls=${stats.modelCalls} input_tokens=${stats.inputTokens} output_tokens=${stats.outputTokens} micros=${stats.micros} finish=${finishReason ?? "?"}${isAborted ? " aborted" : ""}`,
        );
      },
    });
  } catch (error) {
    // Only message validation runs before the response exists; the model is
    // not called, so the pre-reserved step is released.
    await releaseUnusedReservation();
    if (isClientAbort(error, request.signal))
      return clientAbortedResponse(ROUTE, startedAt);
    // The validation error's message embeds the messages, so neither the
    // log line nor the response repeats it.
    if (TypeValidationError.isInstance(error)) {
      logRoute(ROUTE, 400, startedAt, "invalid messages");
      return errorResponse(
        400,
        "INVALID_ARGUMENT",
        "入力が不正です: messages の形式が AI SDK の UI メッセージと一致しません。",
      );
    }
    return internalErrorResponse(ROUTE, error, startedAt);
  }
}
