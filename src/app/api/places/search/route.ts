import { NextResponse } from "next/server";
import { placeSearchRequestSchema } from "@/lib/api-schemas";
import { logRoute, parseJsonBody, placesErrorResponse } from "@/lib/api-route";
import { searchText } from "@/lib/places-new";
import type { PlaceSearchResponse } from "@/lib/place-dto";

const ROUTE = "places/search";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const parsed = await parseJsonBody(request, placeSearchRequestSchema);
  if (!parsed.ok) {
    logRoute(ROUTE, 400, startedAt, "invalid input");
    return parsed.response;
  }
  try {
    const places = await searchText(parsed.data, { signal: request.signal });
    logRoute(ROUTE, 200, startedAt, `results=${places.length}`);
    const body: PlaceSearchResponse = { places };
    return NextResponse.json(body);
  } catch (error) {
    return placesErrorResponse(ROUTE, error, startedAt, request.signal);
  }
}
