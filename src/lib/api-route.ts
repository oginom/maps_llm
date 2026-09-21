// Shared helpers for the route handlers: JSON body validation, the error
// body shape `{ error: { code, message } }`, and one log line per call.
import { NextResponse } from "next/server";
import type { z } from "zod";
import { isClientAbort } from "./abort";
import { formatIssues } from "./api-schemas";
import {
  BudgetExceededError,
  LEDGER_UNAVAILABLE_MESSAGE,
  LedgerUnavailableError,
} from "./budget/errors";
import type { BudgetRequestContext } from "./budget/ledger";
import { parseBudgetContext } from "./budget/request-context";
import { PlacesApiError } from "./places-new";

export const CLIENT_ABORTED_STATUS = 499;
export const INTERNAL_ERROR_MESSAGE =
  "サーバー内部でエラーが発生しました。時間をおいて再試行してください。";

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function logRoute(
  route: string,
  status: number,
  startedAt: number,
  detail: string,
) {
  console.log(
    `[api/${route}] status=${status} duration=${Date.now() - startedAt}ms ${detail}`,
  );
}

export async function parseJsonBody<Output>(
  request: Request,
  schema: z.ZodType<Output>,
): Promise<{ ok: true; data: Output } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        "INVALID_JSON",
        "リクエスト本文を JSON として解釈できませんでした。",
      ),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      response: errorResponse(
        400,
        "INVALID_ARGUMENT",
        `入力が不正です: ${formatIssues(parsed.error)}`,
      ),
    };
  return { ok: true, data: parsed.data };
}

// Every paid route needs the browser's session / run ids for the budget
// ledger. Missing or malformed ids are a client error (400).
export function requireBudgetContext(
  request: Request,
  route: string,
  startedAt: number,
):
  | { ok: true; context: BudgetRequestContext }
  | { ok: false; response: NextResponse } {
  const parsed = parseBudgetContext(request.headers);
  if (parsed.ok) return parsed;
  logRoute(route, 400, startedAt, "invalid budget headers");
  return {
    ok: false,
    response: errorResponse(400, "INVALID_ARGUMENT", parsed.message),
  };
}

// Budget refusals: 429 with a `BUDGET_*` code (distinct from the upstream
// `RESOURCE_EXHAUSTED`), and 503 when the ledger itself is unreachable so
// no paid call starts without accounting (fail closed).
export function budgetErrorResponse(
  route: string,
  error: unknown,
  startedAt: number,
): NextResponse | undefined {
  if (error instanceof BudgetExceededError) {
    logRoute(route, 429, startedAt, `budget=${error.code} type=${error.type}`);
    return errorResponse(429, error.code, error.message);
  }
  if (error instanceof LedgerUnavailableError) {
    console.error(
      `[api/${route}] ledger unavailable: ${error.message}`,
      error.cause ?? "",
    );
    logRoute(route, 503, startedAt, "ledger unavailable");
    return errorResponse(503, "BUDGET_UNAVAILABLE", LEDGER_UNAVAILABLE_MESSAGE);
  }
  return undefined;
}

export function clientAbortedResponse(route: string, startedAt: number) {
  logRoute(route, CLIENT_ABORTED_STATUS, startedAt, "client aborted");
  return errorResponse(
    CLIENT_ABORTED_STATUS,
    "CLIENT_ABORTED",
    "リクエストが中断されました。",
  );
}

// Unexpected failures (DNS, bugs): the detail stays in the server log.
export function internalErrorResponse(
  route: string,
  error: unknown,
  startedAt: number,
) {
  console.error(`[api/${route}] unexpected error`, error);
  logRoute(route, 500, startedAt, "unexpected error");
  return errorResponse(500, "INTERNAL", INTERNAL_ERROR_MESSAGE);
}

export function placesErrorResponse(
  route: string,
  error: unknown,
  startedAt: number,
  signal?: AbortSignal,
) {
  if (isClientAbort(error, signal))
    return clientAbortedResponse(route, startedAt);
  const budgetResponse = budgetErrorResponse(route, error, startedAt);
  if (budgetResponse) return budgetResponse;
  if (error instanceof PlacesApiError) {
    logRoute(
      route,
      error.httpStatus,
      startedAt,
      `google=${error.googleStatus}`,
    );
    return errorResponse(error.httpStatus, error.googleStatus, error.message);
  }
  return internalErrorResponse(route, error, startedAt);
}
