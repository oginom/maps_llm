import { NextResponse } from "next/server";
import { formatIssues, placeIdSchema } from "@/lib/api-schemas";
import {
  clientAbortedResponse,
  errorResponse,
  logRoute,
  placesErrorResponse,
  requireBudgetContext,
} from "@/lib/api-route";
import {
  reserveBudget,
  settleReservation,
  type Reservation,
  type SettleOutcome,
} from "@/lib/budget/ledger";
import { getPlace } from "@/lib/places-new";

const ROUTE = "places/[placeId]";

export async function GET(
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const startedAt = Date.now();
  const budget = requireBudgetContext(request, ROUTE, startedAt);
  if (!budget.ok) return budget.response;
  const { placeId } = await context.params;
  const parsed = placeIdSchema.safeParse(placeId);
  if (!parsed.success) {
    logRoute(ROUTE, 400, startedAt, "invalid placeId");
    return errorResponse(
      400,
      "INVALID_ARGUMENT",
      `入力が不正です: ${formatIssues(parsed.error)}`,
    );
  }
  if (request.signal.aborted) return clientAbortedResponse(ROUTE, startedAt);
  let reservation: Reservation | undefined;
  let outcome: SettleOutcome = { kind: "release" };
  try {
    reservation = await reserveBudget(budget.context, "places.details");
    const place = await getPlace(parsed.data, {
      signal: request.signal,
      onRequestSent: () => {
        outcome = { kind: "settle" };
      },
    });
    logRoute(
      ROUTE,
      200,
      startedAt,
      `placeId=${place.placeId} reviews=${place.reviews.length}`,
    );
    return NextResponse.json(place);
  } catch (error) {
    return placesErrorResponse(ROUTE, error, startedAt, request.signal);
  } finally {
    if (reservation) await settleReservation(reservation, outcome);
  }
}
