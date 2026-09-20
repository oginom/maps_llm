// Shared OpenAI error mapping and usage logging for the analysis routes.
import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { isClientAbort } from "./abort";
import {
  clientAbortedResponse,
  errorResponse,
  internalErrorResponse,
  logRoute,
} from "./api-route";

export const OPENAI_QUOTA_MESSAGE =
  "OpenAI の利用上限に達しました。時間をおいて再試行してください。";

export function logCompletionUsage(
  route: string,
  completion: ChatCompletion,
  startedAt: number,
) {
  const usage = completion.usage;
  logRoute(
    route,
    200,
    startedAt,
    `model=${completion.model} prompt_tokens=${usage?.prompt_tokens ?? "?"} completion_tokens=${usage?.completion_tokens ?? "?"} reasoning_tokens=${usage?.completion_tokens_details?.reasoning_tokens ?? 0} finish=${completion.choices[0]?.finish_reason ?? "?"}`,
  );
}

export function openAiErrorResponse(
  route: string,
  error: unknown,
  startedAt: number,
  signal?: AbortSignal,
) {
  if (error instanceof OpenAI.APIUserAbortError || isClientAbort(error, signal))
    return clientAbortedResponse(route, startedAt);
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429 || error.code === "insufficient_quota") {
      logRoute(
        route,
        429,
        startedAt,
        `openai_status=${error.status} code=${error.code ?? "none"}`,
      );
      return errorResponse(429, "RESOURCE_EXHAUSTED", OPENAI_QUOTA_MESSAGE);
    }
    const status = error.status ?? "connection";
    logRoute(
      route,
      502,
      startedAt,
      `openai_status=${status} code=${error.code ?? "none"}`,
    );
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      `OpenAI API エラー (${status}): ${error.message}`,
    );
  }
  return internalErrorResponse(route, error, startedAt);
}
