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

const tokens = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

/**
 * The Places search always tries to answer something, even for nonsense ("zzqxk" -> some shop). A result is only taken when everything the person
 * said appears in its name or address ("EZ Tower" -> "EZ TOWERS - Torre A"): each word of the query must start a word of the result.
 */
export function resemblesQuery(query: string, displayName: string | undefined, formattedAddress: string | undefined): boolean {
  const want = tokens(query);
  if (want.length === 0) return false;
  const have = tokens(`${displayName ?? ""} ${formattedAddress ?? ""}`);
  return want.every((w) => have.some((h) => h.startsWith(w)));
}

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
    if (!NOT_FOUND_REASONS.includes(outcome.reason)) return { status: "unavailable", reason: outcome.reason };
    // "EZ Tower" is a place name, not an address: the geocoder finds nothing, but the Places search (the one behind the site's autocomplete) does.
    // Only a precise result is used; a search that yields just an area, or nothing, is never turned into a guess.
    if (deps.places && !/^\d{5}-?\d{3}$/.test(text)) {
      const found = await deps.places.searchPlaces(text);
      if (found.status === "ok") {
        const hit = found.results.find((r) => classifyLocationPrecision({ types: r.types }) === "precise" && resemblesQuery(text, r.displayName, r.formattedAddress));
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
    }
    return { status: "needs_precision", reason: "not_found" };
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
