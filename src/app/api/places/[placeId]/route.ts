import { NextResponse } from "next/server";
import { formatIssues, placeIdSchema } from "@/lib/api-schemas";
import { errorResponse, logRoute, placesErrorResponse } from "@/lib/api-route";
import { getPlace } from "@/lib/places-new";

const ROUTE = "places/[placeId]";

export async function GET(
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const startedAt = Date.now();
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
  try {
    const place = await getPlace(parsed.data, { signal: request.signal });
    logRoute(
      ROUTE,
      200,
      startedAt,
      `placeId=${place.placeId} reviews=${place.reviews.length}`,
    );
    return NextResponse.json(place);
  } catch (error) {
    return placesErrorResponse(ROUTE, error, startedAt, request.signal);
  }
}
