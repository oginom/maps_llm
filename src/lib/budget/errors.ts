// Errors raised by the budget ledger. The route handlers map them to HTTP
// responses in `src/lib/api-route.ts`.
import type { BudgetScope, BudgetType } from "./config.ts";

const TYPE_LABELS: Record<BudgetType, string> = {
  "places.search": "場所の検索",
  "places.details": "口コミの取得",
  "openai.analyze": "AI 評価",
  "openai.examples": "検索の準備",
};

export type BudgetErrorCode =
  | "BUDGET_MONTH_EXCEEDED"
  | "BUDGET_SESSION_EXCEEDED"
  | "BUDGET_RUN_EXCEEDED";

const SCOPE_CODES: Record<BudgetScope, BudgetErrorCode> = {
  month: "BUDGET_MONTH_EXCEEDED",
  session: "BUDGET_SESSION_EXCEEDED",
  run: "BUDGET_RUN_EXCEEDED",
};

export function budgetExceededMessage(
  scope: BudgetScope,
  type: BudgetType,
): string {
  const label = TYPE_LABELS[type];
  switch (scope) {
    case "month":
      return `今月のアプリ利用予算（${label}）の上限に達しました。来月まで新しい検索・評価はできません。`;
    case "session":
      return `このセッションの利用上限（${label}）に達しました。このセッションではこれ以上の検索・評価はできません。`;
    case "run":
      return `この検索の利用上限（${label}）に達しました。新しい検索を開始してください。`;
  }
}

// A reservation was refused because settled + reserved + estimate would pass
// the cap of `scope`. Answered with HTTP 429 and a `BUDGET_*` code.
export class BudgetExceededError extends Error {
  readonly scope: BudgetScope;
  readonly type: BudgetType;
  readonly code: BudgetErrorCode;

  constructor(scope: BudgetScope, type: BudgetType) {
    super(budgetExceededMessage(scope, type));
    this.name = "BudgetExceededError";
    this.scope = scope;
    this.type = type;
    this.code = SCOPE_CODES[scope];
  }
}

export const LEDGER_UNAVAILABLE_MESSAGE =
  "利用状況の台帳に接続できないため、処理を開始できません。時間をおいて再試行してください。";

// The ledger could not be read or written (timeout, auth failure, 5xx after
// retries, missing configuration). Paid calls fail closed with HTTP 503.
export class LedgerUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LedgerUnavailableError";
  }
}

// A commit precondition failed (another writer changed a document between the
// read and the commit). The ledger re-reads and retries.
export class LedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerConflictError";
  }
}
