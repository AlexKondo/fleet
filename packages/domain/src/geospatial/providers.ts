/**
 * Phase C2 — Geospatial Layer (domain interfaces).
 *
 * Zero I/O, zero Google-specific types, matching the same purity rule as
 * `packages/domain/src/carpool/carpoolPolicy.ts` and `findCarpoolMatches.ts`: this package
 * has no `fetch`, no SDKs, no environment reads — only plain types and pure functions. Any
 * concrete provider (Google Maps Platform or otherwise) lives in `apps/web/lib/geospatial/`
 * and implements these interfaces; nothing under `packages/domain/` may import a
 * Google-specific type or package. This lets the matching engine (Phase C3) depend only on
 * these interfaces and stay provider-agnostic (swap Google for another vendor without
 * touching domain code).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Where a resolved location's coordinates ultimately came from — feeds the audit trail
 * (pack §06) so a match can be explained/debugged later. */
export type LocationResolutionSource =
  | "corporate_mobility_point"
  | "geocoding_provider"
  | "place_search_provider"
  | "manual_lat_lng";

export interface ResolvedLocation {
  coordinates: LatLng;
  /** Human-readable formatted address, when the provider returns one. */
  formattedAddress?: string;
  /** Opaque provider-specific place reference (e.g. a Place ID), stored but never
   * interpreted by domain code. */
  providerPlaceRef?: string;
  source: LocationResolutionSource;
  /** Phase C5: the geocoder's own result `types` and partial-match flag, kept so the caller can
   * tell a pin-able address from a city-level result (see carpool/locationResolution.ts). */
  placeTypes?: string[];
  partialMatch?: boolean;
  /** Set when the location resolves to a known Corporate Mobility Point (Phase C2 §9). */
  corporateMobilityPointId?: string;
}

/** A single candidate returned by a place-text search (e.g. autocomplete-style lookup). */
export interface PlaceSearchResult {
  displayName: string;
  formattedAddress: string;
  coordinates: LatLng;
  providerPlaceRef: string;
  /** Phase C5: the provider's place types (e.g. establishment, point_of_interest, locality). */
  types?: string[];
}

export interface PlaceSearchProvider {
  /** Free-text place search (e.g. "shopping morumbi sao paulo"). Never throws — an
   * unavailable provider or malformed response resolves to `{ status: "unavailable" }`. */
  searchPlaces(query: string): Promise<PlaceSearchOutcome>;
}

export type PlaceSearchOutcome =
  | { status: "ok"; results: PlaceSearchResult[] }
  | { status: "unavailable"; reason: string };

export interface GeocodingProvider {
  /** Resolves a free-text address into coordinates. Never throws. */
  geocode(address: string): Promise<GeocodingOutcome>;
}

export type GeocodingOutcome =
  | { status: "ok"; location: ResolvedLocation }
  | { status: "unavailable"; reason: string };

/** The result of evaluating a route-insertion detour for one candidate rider against a
 * host's baseline route (pack §01/§02 — "additionalDistance"/"additionalTime" must both be
 * within the policy's configured threshold). All distances in kilometers, all durations in
 * minutes — provider adapters are responsible for converting from whatever native units
 * the underlying API returns (meters/seconds for Google Routes API). */
export interface RouteEvaluationResult {
  baselineDistanceKm: number;
  baselineDurationMin: number;
  candidateRouteDistanceKm: number;
  candidateRouteDurationMin: number;
  /** candidateRouteDistanceKm - baselineDistanceKm. Never negative in a well-formed
   * response (a detour cannot make the trip shorter); adapters clamp to 0 defensively. */
  additionalDistanceKm: number;
  /** candidateRouteDurationMin - baselineDurationMin. Same non-negative clamp as above. */
  additionalTimeMin: number;
}

export interface RoutingProvider {
  /**
   * Computes the baseline route (host origin -> host destination) once per host trip.
   * Never throws.
   */
  computeRoute(origin: LatLng, destination: LatLng): Promise<RouteComputeOutcome>;

  /**
   * Computes the route-insertion detour for a single rider candidate: how much additional
   * distance/time the host's baseline route gains by inserting the candidate's
   * pickup/dropoff. Calls the underlying routing API internally (baseline + detour route)
   * and returns a single `RouteEvaluationResult` — callers never need to orchestrate the
   * two calls themselves. Never throws.
   */
  evaluateInsertion(input: RouteInsertionInput): Promise<RouteInsertionOutcome>;
}

export interface RouteInsertionInput {
  hostOrigin: LatLng;
  hostDestination: LatLng;
  candidatePickup: LatLng;
  candidateDropoff: LatLng;
}

export type RouteComputeOutcome =
  | { status: "ok"; distanceKm: number; durationMin: number }
  | { status: "unavailable"; reason: string };

export type RouteInsertionOutcome =
  | { status: "ok"; result: RouteEvaluationResult }
  | { status: "unavailable"; reason: string };
