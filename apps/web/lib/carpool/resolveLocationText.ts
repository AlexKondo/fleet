/**
 * Phase C5 — turns the text a rider typed into a canonical, precise place, in the pack-01
 * order: (1) Corporate Mobility Point, (2) geocoder (Google, behind the Cost Guard-wrapped
 * adapter - the API key never leaves the server). Anything that is not precise enough is NOT
 * guessed: the caller asks the rider for a more precise place.
 *
 * Pure orchestration with injected dependencies (points list + GeocodingProvider) so the
 * clarification rules are unit-testable without Next, Supabase or Google.
 */

import type { GeocodingProvider, LatLng, PlaceSearchProvider } from "@fleet/domain";
import {
  classifyCoarseKind,
  classifyLocationPrecision,
  firstSegmentKey,
  matchMobilityPoint,
} from "@fleet/domain";

export interface ResolvedPlace {
  /** Canonical label shown back to the rider to confirm. */
  label: string;
  coordinates: LatLng;
  source: "corporate_mobility_point" | "geocoding_provider";
  corporateMobilityPointId?: string;
  providerPlaceRef?: string;
}

export type NeedsPrecisionReason =
  | "empty"
  | "not_found"
  | "city_level"
  | "state_level"
  | "neighborhood_level"
  | "postal_code";

export type ResolveOutcome =
  | { status: "resolved"; place: ResolvedPlace }
  | { status: "needs_precision"; reason: NeedsPrecisionReason }
  | { status: "unavailable"; reason: string };

export interface MobilityPointForResolution {
  id: string;
  name: string;
  aliases: string[];
  addressLabel: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
}

export const MAX_LOCATION_TEXT_LENGTH = 200;

/** Geocoder statuses that mean "this text matches nothing" (the rider's problem), as opposed
 * to an outage / quota / key problem (our problem -> `unavailable`, banner, vehicle flow). */
const NOT_FOUND_REASONS = ["geocode_status_ZERO_RESULTS", "geocode_status_INVALID_REQUEST"];

export async function resolveLocationText(
  rawText: string,
  deps: {
    points: readonly MobilityPointForResolution[];
    geocoder: GeocodingProvider;
    /** Optional: one Places Text Search to recover a company / point-of-interest name that the
     * geocoder only resolved to an area. Never called for bare city/state/neighborhood/CEP input. */
    places?: PlaceSearchProvider;
  },
): Promise<ResolveOutcome> {
  const text = (typeof rawText === "string" ? rawText : "").trim().slice(0, MAX_LOCATION_TEXT_LENGTH);
  if (!text) return { status: "needs_precision", reason: "empty" };

  // 1. Corporate Mobility Point - no provider call, no cost.
  const point = matchMobilityPoint(text, deps.points);
  if (point) {
    return {
      status: "resolved",
      place: {
        label: `${point.name} - ${point.addressLabel}`,
        coordinates: { lat: point.latitude, lng: point.longitude },
        source: "corporate_mobility_point",
        corporateMobilityPointId: point.id,
      },
    };
  }

  // 2. Geocoder (already Cost Guard-gated by the adapter).
  const outcome = await deps.geocoder.geocode(text);
  if (outcome.status === "unavailable") {
    return NOT_FOUND_REASONS.includes(outcome.reason)
      ? { status: "needs_precision", reason: "not_found" }
      : { status: "unavailable", reason: outcome.reason };
  }

  const precision = classifyLocationPrecision({
    types: outcome.location.placeTypes,
    partialMatch: outcome.location.partialMatch,
  });
  if (precision !== "precise") {
    const kind = classifyCoarseKind(outcome.location.placeTypes);
    const reasonOf = (): NeedsPrecisionReason =>
      precision === "unknown"
        ? "not_found"
        : kind === "postal_code"
          ? "postal_code"
          : kind === "neighborhood"
            ? "neighborhood_level"
            : kind === "state"
              ? "state_level"
              : "city_level";

    // The input is "just" the area itself when its first segment equals the geocoder's own first
    // address segment ("São Paulo, SP" / "Minas Gerais" / "Pinheiros, São Paulo"). Only when it is
    // NOT (e.g. "Hospital Albert Einstein, São Paulo") may a company / POI name be behind it, and
    // then - and only then - one Places Text Search is tried. CEP input never triggers it.
    const bareArea =
      kind === "postal_code" ||
      firstSegmentKey(text) === firstSegmentKey(outcome.location.formattedAddress ?? "");
    if (deps.places && !bareArea) {
      const found = await deps.places.searchPlaces(text);
      if (found.status === "ok") {
        const hit = found.results.find(
          (r) => classifyLocationPrecision({ types: r.types }) === "precise",
        );
        if (hit) {
          return {
            status: "resolved",
            place: {
              label: hit.formattedAddress ? `${hit.displayName} - ${hit.formattedAddress}` : hit.displayName,
              coordinates: hit.coordinates,
              source: "geocoding_provider",
              providerPlaceRef: hit.providerPlaceRef,
            },
          };
        }
      }
      // A POI search that only yields an area (or fails) never turns into a guess.
    }
    return { status: "needs_precision", reason: reasonOf() };
  }

  return {
    status: "resolved",
    place: {
      label: outcome.location.formattedAddress ?? text,
      coordinates: outcome.location.coordinates,
      source: "geocoding_provider",
      providerPlaceRef: outcome.location.providerPlaceRef,
    },
  };
}
