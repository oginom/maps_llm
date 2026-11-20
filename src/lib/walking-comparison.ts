import { z } from "zod";
import { MAX_WALKING_DESTINATIONS } from "./budget/config.ts";
import {
  reserveBudget,
  settleReservation,
  type BudgetRequestContext,
  type SettleOutcome,
} from "./budget/ledger.ts";

const placeIdSchema = z.string().min(1).max(512).regex(/^\S+$/u);
export const walkingComparisonSchema = z
  .object({
    origin: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict(),
    placeIds: z
      .array(placeIdSchema)
      .min(1)
      .max(MAX_WALKING_DESTINATIONS)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "同じ店舗は複数回選択できません。",
      ),
  })
  .strict();

type WalkingComparison = z.infer<typeof walkingComparisonSchema>;

export class WalkingComparisonError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalidMatrix() {
  return new WalkingComparisonError(
    502,
    "ROUTES_INVALID_RESPONSE",
    "徒歩経路サービスから正しい応答を取得できませんでした。",
  );
}

function upstreamError(status: number) {
  if (status === 429)
    return new WalkingComparisonError(
      429,
      "RESOURCE_EXHAUSTED",
      "徒歩経路サービスの利用上限に達しました。",
    );
  if (status === 401 || status === 403)
    return new WalkingComparisonError(
      502,
      "ROUTES_PERMISSION_DENIED",
      "徒歩経路サービスの利用権限がありません。",
    );
  return new WalkingComparisonError(
    502,
    "ROUTES_UPSTREAM_ERROR",
    "徒歩経路サービスに接続できないか、経路の取得に失敗しました。",
  );
}

const matrixSchema = z.array(
  z.object({
    // Protocol Buffers JSON can omit scalar fields with value zero.
    originIndex: z.literal(0).default(0),
    destinationIndex: z.number().int().nonnegative().default(0),
    status: z.object({ code: z.number().int().nonnegative().default(0) }),
    condition: z.string().optional(),
    duration: z.string().optional(),
  }),
);

export async function computeWalkingComparison(
  { origin, placeIds }: WalkingComparison,
  options: {
    apiKey: string;
    signal: AbortSignal;
    onRequestSent: () => void;
    fetcher?: typeof fetch;
  },
) {
  options.signal.throwIfAborted();
  options.onRequestSent();
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        signal: options.signal,
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": options.apiKey,
          "X-Goog-FieldMask":
            "originIndex,destinationIndex,status,condition,duration",
        },
        body: JSON.stringify({
          origins: [
            {
              waypoint: {
                location: {
                  latLng: { latitude: origin.lat, longitude: origin.lng },
                },
              },
            },
          ],
          destinations: placeIds.map((placeId) => ({ waypoint: { placeId } })),
          travelMode: "WALK",
        }),
      },
    );
  } catch {
    options.signal.throwIfAborted();
    throw upstreamError(502);
  }
  if (!response.ok) throw upstreamError(response.status);
  const parsed = matrixSchema
    .length(placeIds.length)
    .safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw invalidMatrix();
  const durations = new Map<number, number | null>();
  for (const { destinationIndex, status, condition, duration } of parsed.data) {
    if (destinationIndex >= placeIds.length || durations.has(destinationIndex))
      throw invalidMatrix();
    if (status.code === 8) throw upstreamError(429);
    if (status.code === 7 || status.code === 16) throw upstreamError(403);
    if (status.code !== 0 && status.code !== 5) throw upstreamError(502);
    if (condition === "ROUTE_NOT_FOUND" || status.code === 5) {
      durations.set(destinationIndex, null);
    } else {
      if (
        condition !== "ROUTE_EXISTS" ||
        !duration ||
        !/^\d{1,12}(?:\.\d{1,9})?s$/.test(duration)
      )
        throw invalidMatrix();
      durations.set(destinationIndex, Number(duration.slice(0, -1)));
    }
  }
  return {
    routes: placeIds.map((placeId, index) => ({
      placeId,
      durationSeconds: durations.get(index)!,
    })),
  };
}

export async function compareWithWalkingBudget(
  input: WalkingComparison,
  context: BudgetRequestContext,
  signal: AbortSignal,
  apiKey: string | undefined,
  { reserve = reserveBudget, settle = settleReservation, fetcher = fetch } = {},
) {
  signal.throwIfAborted();
  if (!apiKey?.trim())
    throw new WalkingComparisonError(
      503,
      "ROUTES_UNAVAILABLE",
      "徒歩経路サービスが未設定のため、徒歩時間を比較できません。",
    );
  const reservation = await reserve(
    context,
    "routes.matrixElement",
    input.placeIds.length,
  );
  let outcome: SettleOutcome = { kind: "release" };
  try {
    return await computeWalkingComparison(input, {
      apiKey: apiKey.trim(),
      signal,
      fetcher,
      onRequestSent: () => {
        outcome = { kind: "settle" };
      },
    });
  } finally {
    await settle(reservation, outcome);
  }
}
