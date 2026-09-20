// Server-side adapter for Places API (New). The browser never talks to Google
// Places directly; the route handlers under src/app/api/places call this file.
// FieldMasks are fixed here so the client cannot widen them (and the SKU).
import type { PlaceSearchInput } from "./api-schemas";
import type { PlaceDetail, PlaceSummary, Review } from "./place-dto";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1";
const LANGUAGE_CODE = "ja";
const REGION_CODE = "JP";

// Text Search: every field is within the "Text Search Pro" SKU (id is
// Essentials IDs Only). `rating` is an Enterprise field and is deliberately
// excluded; the Google rating appears after Place Details is fetched.
export const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
].join(",");

// Place Details: `reviews` puts this request in the
// "Place Details Enterprise + Atmosphere" SKU. Sub-fields limit the payload,
// not the SKU.
export const DETAIL_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "googleMapsUri",
  "rating",
  "userRatingCount",
  "currentOpeningHours.openNow",
  "regularOpeningHours.weekdayDescriptions",
  "websiteUri",
  "reviews.text",
  "reviews.rating",
  "reviews.publishTime",
  "reviews.relativePublishTimeDescription",
  "reviews.authorAttribution",
  "reviews.googleMapsUri",
].join(",");

export const SEARCH_QUOTA_MESSAGE =
  "Google Places の検索上限に達しました。時間をおいて再検索してください。";
export const DETAIL_QUOTA_MESSAGE =
  "Google Places の利用上限に達しました。時間をおいて再検索してください。";

export class PlacesApiError extends Error {
  readonly httpStatus: number;
  readonly googleStatus: string;

  constructor(input: {
    httpStatus: number;
    googleStatus: string;
    message: string;
  }) {
    super(input.message);
    this.name = "PlacesApiError";
    this.httpStatus = input.httpStatus;
    this.googleStatus = input.googleStatus;
  }
}

// Minimal shapes of the Google responses. Everything is optional because the
// API omits fields that have no value.
type RawLocalizedText = { text?: string; languageCode?: string };
type RawLatLng = { latitude?: number; longitude?: number };
export type RawReview = {
  text?: RawLocalizedText;
  rating?: number;
  publishTime?: string;
  relativePublishTimeDescription?: string;
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
  googleMapsUri?: string;
};
export type RawPlace = {
  id?: string;
  displayName?: RawLocalizedText;
  formattedAddress?: string;
  location?: RawLatLng;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  websiteUri?: string;
  reviews?: RawReview[];
};
type RawSearchResponse = { places?: RawPlace[] };
type RawErrorBody = {
  error?: { code?: number; status?: string; message?: string };
};

export type CallOptions = {
  signal?: AbortSignal;
  // Injected by unit tests; production uses the global fetch.
  fetchImplementation?: typeof fetch;
};

function requireApiKey(): string {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key)
    throw new PlacesApiError({
      httpStatus: 500,
      googleStatus: "MISSING_API_KEY",
      message: "サーバーの GOOGLE_MAPS_SERVER_API_KEY が設定されていません。",
    });
  return key;
}

export function mapPlaceSummary(raw: RawPlace): PlaceSummary | undefined {
  if (
    !raw.id ||
    typeof raw.location?.latitude !== "number" ||
    typeof raw.location?.longitude !== "number"
  )
    return undefined;
  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? "",
    address: raw.formattedAddress ?? "",
    location: { lat: raw.location.latitude, lng: raw.location.longitude },
    googleMapsUri:
      raw.googleMapsUri ??
      `https://www.google.com/maps/place/?q=place_id:${raw.id}`,
  };
}

// Reviews without text (rating-only reviews) are dropped: they cannot be sent
// to the analysis model and have no excerpt to attribute.
export function mapReview(raw: RawReview): Review | undefined {
  const text = raw.text?.text;
  if (!text) return undefined;
  const author: Review["author"] = {
    name: raw.authorAttribution?.displayName ?? "",
  };
  if (raw.authorAttribution?.uri) author.uri = raw.authorAttribution.uri;
  if (raw.authorAttribution?.photoUri)
    author.photoUri = raw.authorAttribution.photoUri;
  const review: Review = {
    text,
    rating: raw.rating ?? 0,
    publishTime: raw.publishTime ?? "",
    relativePublishTimeDescription: raw.relativePublishTimeDescription ?? "",
    author,
  };
  if (raw.googleMapsUri) review.googleMapsUri = raw.googleMapsUri;
  return review;
}

export function mapPlaceDetail(raw: RawPlace): PlaceDetail {
  const summary = mapPlaceSummary(raw);
  if (!summary)
    throw new PlacesApiError({
      httpStatus: 502,
      googleStatus: "INVALID_RESPONSE",
      message: "Google Places の応答に場所 ID または座標がありません。",
    });
  const detail: PlaceDetail = {
    ...summary,
    reviews: (raw.reviews ?? [])
      .map(mapReview)
      .filter((review): review is Review => review !== undefined),
  };
  if (typeof raw.rating === "number") detail.rating = raw.rating;
  if (typeof raw.userRatingCount === "number")
    detail.userRatingCount = raw.userRatingCount;
  if (typeof raw.currentOpeningHours?.openNow === "boolean")
    detail.openNow = raw.currentOpeningHours.openNow;
  if (raw.regularOpeningHours?.weekdayDescriptions?.length)
    detail.weekdayDescriptions = raw.regularOpeningHours.weekdayDescriptions;
  if (raw.websiteUri) detail.websiteUri = raw.websiteUri;
  return detail;
}

export function mapSearchResponse(raw: RawSearchResponse): PlaceSummary[] {
  const places: PlaceSummary[] = [];
  for (const rawPlace of raw.places ?? []) {
    const place = mapPlaceSummary(rawPlace);
    if (place) places.push(place);
    else
      console.warn(
        `[places-new] skipped a search result without id or location (id=${rawPlace.id ?? "none"})`,
      );
  }
  return places;
}

// Converts a non-2xx Google response into the HTTP status the client sees.
export function toPlacesApiError(
  httpStatus: number,
  body: unknown,
  quotaMessage: string,
): PlacesApiError {
  const error =
    typeof body === "object" && body !== null
      ? (body as RawErrorBody).error
      : undefined;
  const googleStatus = error?.status ?? `HTTP_${httpStatus}`;
  const googleMessage = error?.message;
  if (httpStatus === 429 || googleStatus === "RESOURCE_EXHAUSTED")
    return new PlacesApiError({
      httpStatus: 429,
      googleStatus,
      message: quotaMessage,
    });
  if (httpStatus === 400 || googleStatus === "INVALID_ARGUMENT")
    return new PlacesApiError({
      httpStatus: 400,
      googleStatus,
      message:
        googleMessage ?? "Google Places API がリクエストを拒否しました。",
    });
  if (httpStatus === 404 || googleStatus === "NOT_FOUND")
    return new PlacesApiError({
      httpStatus: 404,
      googleStatus,
      message: "指定された場所が見つかりませんでした。",
    });
  // 403 / PERMISSION_DENIED (API disabled, key restriction) and anything else.
  return new PlacesApiError({
    httpStatus: 502,
    googleStatus,
    message: `Google Places API エラー (${googleStatus}): ${
      googleMessage ?? `HTTP ${httpStatus}`
    }`,
  });
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function callPlaces(
  url: string,
  init: RequestInit,
  fieldMask: string,
  quotaMessage: string,
  options: CallOptions,
): Promise<unknown> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const response = await fetchImplementation(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": requireApiKey(),
      "X-Goog-FieldMask": fieldMask,
    },
    signal: options.signal,
  });
  const body = await parseBody(response);
  if (!response.ok) throw toPlacesApiError(response.status, body, quotaMessage);
  if (typeof body !== "object" || body === null)
    throw new PlacesApiError({
      httpStatus: 502,
      googleStatus: "INVALID_RESPONSE",
      message: "Google Places API の応答を JSON として解釈できませんでした。",
    });
  return body;
}

export async function searchText(
  input: PlaceSearchInput,
  options: CallOptions = {},
): Promise<PlaceSummary[]> {
  const requestBody: Record<string, unknown> = {
    textQuery: input.textQuery,
    locationRestriction: {
      rectangle: {
        low: {
          latitude: input.rectangle.low.lat,
          longitude: input.rectangle.low.lng,
        },
        high: {
          latitude: input.rectangle.high.lat,
          longitude: input.rectangle.high.lng,
        },
      },
    },
    // `pageSize` is the current name; `maxResultCount` is deprecated upstream.
    pageSize: input.maxResultCount,
    languageCode: LANGUAGE_CODE,
    regionCode: REGION_CODE,
  };
  if (input.openNow !== undefined) requestBody.openNow = input.openNow;
  const body = await callPlaces(
    `${PLACES_ENDPOINT}/places:searchText`,
    { method: "POST", body: JSON.stringify(requestBody) },
    SEARCH_FIELD_MASK,
    SEARCH_QUOTA_MESSAGE,
    options,
  );
  return mapSearchResponse(body as RawSearchResponse);
}

export async function getPlace(
  placeId: string,
  options: CallOptions = {},
): Promise<PlaceDetail> {
  const query = new URLSearchParams({
    languageCode: LANGUAGE_CODE,
    regionCode: REGION_CODE,
  });
  const body = await callPlaces(
    `${PLACES_ENDPOINT}/places/${encodeURIComponent(placeId)}?${query}`,
    { method: "GET" },
    DETAIL_FIELD_MASK,
    DETAIL_QUOTA_MESSAGE,
    options,
  );
  return mapPlaceDetail(body as RawPlace);
}
