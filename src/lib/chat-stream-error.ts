// Maps errors raised after the chat stream started (a later model step
// refused by the ledger, an OpenAI failure, an invalid tool input from the
// model) to the `errorText` of the stream's `error` / `tool-input-error`
// chunk. The text carries the same `{ error: { code, message } }` body as
// the HTTP error responses so the browser handles both the same way.
import { APICallError, InvalidToolInputError, NoSuchToolError } from "ai";
import { isClientAbort } from "./abort.ts";
import {
  CLIENT_ABORTED_MESSAGE,
  INTERNAL_ERROR_MESSAGE,
  OPENAI_QUOTA_MESSAGE,
} from "./api-messages.ts";
import {
  BudgetExceededError,
  LEDGER_UNAVAILABLE_MESSAGE,
  LedgerUnavailableError,
} from "./budget/errors.ts";
import type { ChatStreamErrorBody } from "./chat-contract.ts";

export const INVALID_TOOL_INPUT_MESSAGE =
  "AI が生成した検索条件の形式が不正でした。もう一度送信してください。";

export function chatStreamErrorBody(
  error: unknown,
  signal?: AbortSignal,
  log: (line: string, detail?: unknown) => void = (line, detail) =>
    console.error(line, detail ?? ""),
): ChatStreamErrorBody {
  if (isClientAbort(error, signal))
    return {
      error: { code: "CLIENT_ABORTED", message: CLIENT_ABORTED_MESSAGE },
    };
  if (error instanceof BudgetExceededError)
    return { error: { code: error.code, message: error.message } };
  if (error instanceof LedgerUnavailableError) {
    log(`[api/chat] ledger unavailable: ${error.message}`);
    return {
      error: {
        code: "BUDGET_UNAVAILABLE",
        message: LEDGER_UNAVAILABLE_MESSAGE,
      },
    };
  }
  if (
    InvalidToolInputError.isInstance(error) ||
    NoSuchToolError.isInstance(error)
  ) {
    // The message embeds the generated input; log the tool name only.
    log(
      `[api/chat] invalid tool call tool=${error.toolName} error=${error.name}`,
    );
    return {
      error: {
        code: "INVALID_TOOL_INPUT",
        message: INVALID_TOOL_INPUT_MESSAGE,
      },
    };
  }
  // The `tool-output-error` chunk of an invalid tool call carries the error
  // as its message string, prefixed with the error name (ai 7.0.107,
  // `getErrorMessage(toolCall.error)`).
  if (typeof error === "string") {
    if (
      error.startsWith("AI_InvalidToolInputError") ||
      error.startsWith("AI_NoSuchToolError")
    ) {
      log("[api/chat] invalid tool call reported as tool output error");
      return {
        error: {
          code: "INVALID_TOOL_INPUT",
          message: INVALID_TOOL_INPUT_MESSAGE,
        },
      };
    }
    log(`[api/chat] tool error: ${error}`);
    return { error: { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE } };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? "connection";
    log(`[api/chat] OpenAI API error status=${status}`);
    if (error.statusCode === 429)
      return {
        error: { code: "RESOURCE_EXHAUSTED", message: OPENAI_QUOTA_MESSAGE },
      };
    return {
      error: {
        code: "UPSTREAM_ERROR",
        message: `OpenAI API エラー (${status}): ${error.message}`,
      },
    };
  }
  log("[api/chat] stream error", error);
  return { error: { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE } };
}

export function chatStreamErrorText(error: unknown, signal?: AbortSignal) {
  return JSON.stringify(chatStreamErrorBody(error, signal));
}
