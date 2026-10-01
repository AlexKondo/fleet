/**
 * Phase C5 — pure rules for turning what a rider typed into a location precise enough for
 * route-based carpool matching (pack 01 "Destination policy", pack 07 scenarios
 * "city-only destination requiring precision -> request clarification" and "invalid /
 * unresolvable address -> do not guess").
 *
 * No I/O here: the server (apps/web/lib/carpool/resolveLocationText.ts) calls the Cost
 * Guard-wrapped provider and feeds the result through these predicates.
 */

/** Geocoder result types that denote a specific, pin-able place (a rider can be picked up /
 * dropped off there). Names follow Google's Geocoding "types" vocabulary, which is a de-facto
 * standard; the domain only compares strings, it imports nothing provider-specific. */
export const PRECISE_PLACE_TYPES: readonly string[] = [
  "street_address",
  "premise",
  "subpremise",
  "establishment",
  "point_of_interest",
  "intersection",
  "airport",
  "transit_station",
  "bus_station",
  "train_station",
  "subway_station",
  "shopping_mall",
  "parking",
  "floor",
  "room",
];

/** Types that, ON THEIR OWN, mean "an area" (city, district, state, postal code ...). */
export const COARSE_PLACE_TYPES: readonly string[] = [
  "locality",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "neighborhood",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "administrative_area_level_4",
  "administrative_area_level_5",
  "country",
  "postal_code",
  "postal_town",
  "colloquial_area",
  "political",
];

export type LocationPrecision = "precise" | "city_level" | "unknown";

export interface LocationPrecisionInput {
  /** The geocoder's `types` for the chosen result. */
  types?: readonly string[];
  /** The geocoder reports it only matched part of the input. */
  partialMatch?: boolean;
}

/**
 * Classifies a geocoder result.
 *  - `precise`   : has a pin-able type (street address, establishment, station ...). A bare
 *                  `route` (a street with no number) is accepted only on a full match.
 *  - `city_level`: only area-level types (locality, state, neighborhood, postal code ...)
 *                  => "São Paulo" alone, which the pack says is NOT enough.
 *  - `unknown`   : no usable type information => treated as insufficient by callers (never
 *                  guess a precise location the provider did not vouch for).
 */
export function classifyLocationPrecision(input: LocationPrecisionInput): LocationPrecision {
  const types = (input.types ?? []).filter((t): t is string => typeof t === "string");
  if (types.length === 0) return "unknown";
  if (types.some((t) => PRECISE_PLACE_TYPES.includes(t))) return "precise";
  if (types.includes("route")) return input.partialMatch ? "unknown" : "precise";
  if (types.some((t) => COARSE_PLACE_TYPES.includes(t))) return "city_level";
  return "unknown";
}

/** Case/diacritics/whitespace-insensitive key for comparing typed text with a point's name. */
export function normalizeLocationText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface MobilityPointLike {
  id: string;
  name: string;
  aliases: readonly string[];
  addressLabel: string;
  isActive?: boolean;
}

/**
 * Resolution order step 1 (pack 01): a Corporate Mobility Point whose name, alias or address
 * label equals what the rider typed (normalized, EXACT - never a fuzzy/substring guess).
 * Inactive points never match. Returns undefined when nothing matches or the input is blank.
 */
export function matchMobilityPoint<T extends MobilityPointLike>(
  query: string,
  points: readonly T[],
): T | undefined {
  const key = normalizeLocationText(query);
  if (!key) return undefined;
  return points.find((point) => {
    if (point.isActive === false) return false;
    return [point.name, point.addressLabel, ...point.aliases].some(
      (candidate) => normalizeLocationText(candidate) === key,
    );
  });
}

/**
 * Maximum seats a host may offer: the recommended vehicle's passenger capacity minus the
 * occupants the host declared for their own trip. This is EXACTLY what the database computes
 * in `carpool_vehicle_free_seats` (0058: passenger_capacity - trip_requests.passenger_count),
 * which `enable_carpool_offer` / `update_carpool_offer` enforce - the UI prefill and the DB cap
 * therefore agree. Never negative.
 */
export function maxOfferableSeats(
  vehicleCapacity: number | null | undefined,
  declaredPassengers: number,
): number {
  if (typeof vehicleCapacity !== "number" || !Number.isFinite(vehicleCapacity)) return 0;
  const declared = Number.isFinite(declaredPassengers) ? Math.max(0, Math.floor(declaredPassengers)) : 0;
  return Math.max(0, Math.floor(vehicleCapacity) - declared);
}

/**
 * Validates a host's chosen seat count against the maximum: a positive integer, not above the
 * maximum. Returns the integer, or null when invalid (caller must NOT publish).
 */
export function validOfferSeats(requested: unknown, max: number): number | null {
  if (typeof requested !== "number" || !Number.isInteger(requested)) return null;
  if (requested < 1 || requested > max) return null;
  return requested;
}

export type CoarseKind = "postal_code" | "neighborhood" | "city" | "state";

/** Which KIND of area a coarse (non-precise) result is, for accurate wording to the rider. */
export function classifyCoarseKind(types: readonly string[] | undefined): CoarseKind {
  const t = types ?? [];
  if (t.includes("postal_code")) return "postal_code";
  if (t.some((x) => x === "neighborhood" || x.startsWith("sublocality"))) return "neighborhood";
  if (t.some((x) => x === "administrative_area_level_1" || x === "country")) return "state";
  return "city";
}

/** Normalised first comma-separated segment ("Pinheiros, São Paulo" -> "pinheiros"). */
export function firstSegmentKey(text: string): string {
  return normalizeLocationText(text.split(/,| - | – /)[0] ?? "");
}
