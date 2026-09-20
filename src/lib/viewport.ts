import type { LatLngLiteral } from "./place-dto";

export type Viewport = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type Rectangle = { low: LatLngLiteral; high: LatLngLiteral };

// Places API (New) rejects a `locationRestriction.rectangle` whose longitude
// span is 180 degrees or more. A zoomed-out map produces such a viewport, so
// the client narrows it around the same centre before searching.
export const MAX_LONGITUDE_SPAN = 180;
export const CLAMPED_LONGITUDE_SPAN = 179.9;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeLongitude = (longitude: number) =>
  ((((longitude + 180) % 360) + 360) % 360) - 180;

export function viewportToRectangle(viewport: Viewport): Rectangle {
  const south = clamp(Math.min(viewport.south, viewport.north), -90, 90);
  const north = clamp(Math.max(viewport.south, viewport.north), -90, 90);
  let west = viewport.west;
  let east = viewport.east;
  let span = east - west;
  if (span < 0) span += 360; // The viewport crosses the antimeridian.
  if (span >= MAX_LONGITUDE_SPAN) {
    const center = normalizeLongitude(west + span / 2);
    west = center - CLAMPED_LONGITUDE_SPAN / 2;
    east = center + CLAMPED_LONGITUDE_SPAN / 2;
  } else if (east < west) {
    east += 360;
  }
  // The search schema requires low.lng <= high.lng, so any part beyond
  // ±180 degrees is cut off rather than wrapped around.
  return {
    low: { lat: south, lng: clamp(west, -180, 180) },
    high: { lat: north, lng: clamp(east, -180, 180) },
  };
}
