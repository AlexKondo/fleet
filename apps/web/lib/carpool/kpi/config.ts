/**
 * C7b KPI dashboard - the ONLY place that holds estimate parameters. Everything derived from them is labelled
 * "estimate" in the UI; none of it is ever presented as an exact or billed figure.
 */

/**
 * ESTIMATE (not a billing figure): list prices in USD per call at the time of writing, for the Google Maps
 * Platform products this app uses. They ignore free-tier credits, volume discounts and the exact SKU the account
 * is billed under, so the dashboard shows them as "estimated cost". Verify against the current Google Maps
 * Platform pricing sheet and update here (one constant, no other code change needed).
 *  - geocode      : Geocoding API                               ~ USD 5.00 / 1000
 *  - place_search : Places API (New) Text Search                ~ USD 32.00 / 1000 (Pro/Enterprise field mask)
 *  - routing      : Routes API Compute Routes (TRAFFIC_AWARE)   ~ USD 10.00 / 1000 (Pro)
 */
export const PROVIDER_UNIT_PRICE_USD: Record<"geocode" | "place_search" | "routing", number> = {
  geocode: 0.005,
  place_search: 0.032,
  routing: 0.01,
};

/**
 * ESTIMATE: factor applied to the straight-line (haversine) distance between a rider's stored pickup and drop-off
 * coordinates to approximate the road distance that rider would otherwise have driven in an additional vehicle.
 * 1.3 is the usual urban circuity factor; the real figure depends on the road network.
 */
export const ROAD_DISTANCE_FACTOR = 1.3;

export const KPI_RANGE_DAYS = [7, 30, 90] as const;
export type KpiRangeDays = (typeof KPI_RANGE_DAYS)[number];
