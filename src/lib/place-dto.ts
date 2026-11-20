// Data transfer objects shared by the Places adapter and the browser.
// Only these mapped fields ever leave the server; raw Places API (New)
// responses are never forwarded.

export type LatLngLiteral = { lat: number; lng: number };

export type PlaceSummary = {
  placeId: string;
  name: string;
  address: string;
  location: LatLngLiteral;
  googleMapsUri: string;
};

export type ReviewAuthor = {
  name: string;
  uri?: string;
  photoUri?: string;
};

export type Review = {
  text: string;
  rating: number;
  publishTime: string;
  relativePublishTimeDescription: string;
  author: ReviewAuthor;
  googleMapsUri?: string;
};

export type PlaceDetail = PlaceSummary & {
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  weekdayDescriptions?: string[];
  websiteUri?: string;
  reviews: Review[];
};

// Bounds on the numbered reviews sent to /api/analyze-reviews.
export const MAX_REVIEW_COUNT = 5;
export const MAX_REVIEWS_TEXT_LENGTH = 8000;

// Error body returned by every API route on failure.
export type ApiErrorBody = { error: { code: string; message: string } };
