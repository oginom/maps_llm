import { NextResponse } from "next/server";
import { placeSearchRequestSchema } from "@/lib/api-schemas";
import {
  clientAbortedResponse,
  logRoute,
  parseJsonBody,
  placesErrorResponse,
  requireBudgetContext,
} from "@/lib/api-route";
import {
  reserveBudget,
  settleReservation,
  type Reservation,
  type SettleOutcome,
} from "@/lib/budget/ledger";
import { searchText } from "@/lib/places-new";
import type { PlaceSearchResponse } from "@/lib/place-dto";

const ROUTE = "places/search";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const budget = requireBudgetContext(request, ROUTE, startedAt);
  if (!budget.ok) return budget.response;
  const parsed = await parseJsonBody(request, placeSearchRequestSchema);
  if (!parsed.ok) {
    logRoute(ROUTE, 400, startedAt, "invalid input");
    return parsed.response;
  }
  if (request.signal.aborted) return clientAbortedResponse(ROUTE, startedAt);
  let reservation: Reservation | undefined;
  let outcome: SettleOutcome = { kind: "release" };
  try {
    reservation = await reserveBudget(budget.context, "places.search");
    const places = await searchText(parsed.data, {
      signal: request.signal,
      onRequestSent: () => {
        outcome = { kind: "settle" };
      },
    });
    logRoute(ROUTE, 200, startedAt, `results=${places.length}`);
    const body: PlaceSearchResponse = { places };
    return NextResponse.json(body);
  } catch (error) {
    return placesErrorResponse(ROUTE, error, startedAt, request.signal);
  } finally {
    if (reservation) await settleReservation(reservation, outcome);
  }
}
