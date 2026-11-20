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
  compareWithWalkingBudget,
  walkingComparisonSchema,
  WalkingComparisonError,
} from "@/lib/walking-comparison";

const ROUTE = "walking-comparison";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const budget = requireBudgetContext(request, ROUTE, startedAt);
  if (!budget.ok) return budget.response;
  const parsed = await parseJsonBody(request, walkingComparisonSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await compareWithWalkingBudget(
      parsed.data,
      budget.context,
      request.signal,
      process.env.GOOGLE_ROUTES_SERVER_API_KEY,
    );
    logRoute(ROUTE, 200, startedAt, `elements=${parsed.data.placeIds.length}`);
    return Response.json(result);
  } catch (error) {
    if (request.signal.aborted) return clientAbortedResponse(ROUTE, startedAt);
    const refused = budgetErrorResponse(ROUTE, error, startedAt);
    if (refused) return refused;
    if (error instanceof WalkingComparisonError) {
      logRoute(ROUTE, error.status, startedAt, error.code);
      return errorResponse(error.status, error.code, error.message);
    }
    return internalErrorResponse(ROUTE, error, startedAt);
  }
}
