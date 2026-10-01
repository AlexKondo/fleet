import "server-only";
import type {
  GeocodingOutcome,
  GeocodingProvider,
  PlaceSearchOutcome,
  PlaceSearchProvider,
  PlaceSearchResult,
  ResolvedLocation,
} from "@fleet/domain";
import { withCostGuard } from "./costGuard";

/**
 * Phase C2 — Google Maps Platform adapter for geocoding + place search.
 *
 * Follows the exact pattern established by `apps/web/lib/domain/analyzeDriversLicense.ts`:
 * `"server-only"`, raw `fetch` (no SDK), its own env var read with an explicit `!apiKey`
 * short-circuit, defensive parsing of every field, and a typed result union that never
 * throws.
 *
 * Verified live against Google's current documentation at implementation time (2026-09-30):
 * - Geocoding API: https://developers.google.com/maps/documentation/geocoding/requests-geocoding
 *   `GET https://maps.googleapis.com/maps/api/geocode/json?address=...&key=...` ->
 *   `{ status, results: [{ formatted_address, geometry: { location: { lat, lng } }, place_id }] }`.
 * - Places API (New), Text Search:
 *   https://developers.google.com/maps/documentation/places/web-service/text-search
 *   `POST https://places.googleapis.com/v1/places:searchText` with headers
 *   `X-Goog-Api-Key` + `X-Goog-FieldMask`, body `{ textQuery }` ->
 *   `{ places: [{ id, displayName: { text }, formattedAddress, location: { latitude, longitude } }] }`.
 *
 * Every real call is routed through `withCostGuard` — there is no direct unguarded `fetch`
 * to Google anywhere in this file's exported functions.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.types";

function readApiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY;
}

async function rawGeocode(address: string, apiKey: string): Promise<GeocodingOutcome> {
  try {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      return { status: "unavailable", reason: `geocode_http_${response.status}` };
    }

    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null) {
      return { status: "unavailable", reason: "malformed_geocode_response" };
    }
    const body = json as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        place_id?: string;
        types?: string[];
        partial_match?: boolean;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };

    if (body.status !== "OK" || !Array.isArray(body.results) || body.results.length === 0) {
      return { status: "unavailable", reason: `geocode_status_${body.status ?? "unknown"}` };
    }

    const first = body.results[0];
    if (!first) {
      return { status: "unavailable", reason: "geocode_missing_coordinates" };
    }
    const lat = first.geometry?.location?.lat;
    const lng = first.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return { status: "unavailable", reason: "geocode_missing_coordinates" };
    }

    const location: ResolvedLocation = {
      coordinates: { lat, lng },
      formattedAddress: typeof first.formatted_address === "string" ? first.formatted_address : undefined,
      providerPlaceRef: typeof first.place_id === "string" ? first.place_id : undefined,
      source: "geocoding_provider",
      placeTypes: Array.isArray(first.types)
        ? first.types.filter((t): t is string => typeof t === "string")
        : undefined,
      partialMatch: first.partial_match === true ? true : undefined,
    };
    return { status: "ok", location };
  } catch (err) {
    return { status: "unavailable", reason: err instanceof Error ? err.message : "geocode_unknown_error" };
  }
}

async function rawSearchPlaces(query: string, apiKey: string): Promise<PlaceSearchOutcome> {
  try {
    const response = await fetch(PLACES_SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return { status: "unavailable", reason: `places_http_${response.status}` };
    }

    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null) {
      return { status: "unavailable", reason: "malformed_places_response" };
    }
    const body = json as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        types?: string[];
      }>;
    };

    if (!Array.isArray(body.places)) {
      return { status: "unavailable", reason: "places_missing_results" };
    }

    const results: PlaceSearchResult[] = [];
    for (const place of body.places) {
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        typeof place.id !== "string" ||
        typeof place.formattedAddress !== "string" ||
        typeof place.displayName?.text !== "string"
      ) {
        continue; // skip malformed entries defensively rather than fail the whole batch
      }
      results.push({
        displayName: place.displayName.text,
        formattedAddress: place.formattedAddress,
        coordinates: { lat, lng },
        providerPlaceRef: place.id,
        types: Array.isArray(place.types) ? place.types.filter((t): t is string => typeof t === "string") : undefined,
      });
    }

    return { status: "ok", results };
  } catch (err) {
    return { status: "unavailable", reason: err instanceof Error ? err.message : "places_unknown_error" };
  }
}

/**
 * Geocodes a free-text address for the given organization, gated by Cost Guard
 * (`geocode` call kind). Returns `{ status: "unavailable" }` on missing API key, quota
 * block, circuit-open, timeout, malformed response, or non-OK Google status — never throws.
 */
export async function geocodeAddress(organizationId: string, address: string): Promise<GeocodingOutcome> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return { status: "unavailable", reason: "missing_api_key" };
  }

  const guarded = await withCostGuard(
    organizationId,
    "geocode",
    () => rawGeocode(address, apiKey),
    (outcome) => outcome.status === "ok",
  );

  if (guarded.status === "blocked") {
    return { status: "unavailable", reason: guarded.reason };
  }
  return guarded.result;
}

/** Free-text place search, gated by Cost Guard (`place_search` call kind). Never throws. */
export async function searchPlaces(organizationId: string, query: string): Promise<PlaceSearchOutcome> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return { status: "unavailable", reason: "missing_api_key" };
  }

  const guarded = await withCostGuard(
    organizationId,
    "place_search",
    () => rawSearchPlaces(query, apiKey),
    (outcome) => outcome.status === "ok",
  );

  if (guarded.status === "blocked") {
    return { status: "unavailable", reason: guarded.reason };
  }
  return guarded.result;
}

/** Concrete `GeocodingProvider`/`PlaceSearchProvider` implementations bound to one
 * organization — constructed per-request since Cost Guard is org-scoped. */
export function createGooglePlacesProvider(
  organizationId: string,
): GeocodingProvider & PlaceSearchProvider {
  return {
    geocode: (address: string) => geocodeAddress(organizationId, address),
    searchPlaces: (query: string) => searchPlaces(organizationId, query),
  };
}
