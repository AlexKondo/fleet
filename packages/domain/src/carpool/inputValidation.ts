/**
 * Phase C4 carry-over hardening (C3 Auditor findings a/b): shared, pure input validators.
 * Used by the server actions (before any DB/provider work) and by the matching engine's own
 * fail-closed guards, so garbage like 0 / -1 / 0.5 seats or lat 999 can never be treated as
 * a valid request.
 */

import type { LatLng } from "../geospatial/providers";

/** A seat count must be a positive integer (0, negatives, fractions, NaN, Infinity rejected). */
export function isValidSeatCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Finite latitude in [-90, 90] and longitude in [-180, 180]. */
export function isValidLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
