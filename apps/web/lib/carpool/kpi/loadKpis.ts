import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@fleet/supabase-client";
import {
  aggregateProvider, aggregateRequests, aggregateSearchLog, aggregateShared, countEvents,
  type KpiReport, type RideRequestRow,
} from "./aggregate";

/**
 * C7b KPI dashboard data function. Takes the SERVICE-ROLE client on purpose and must only be called after the
 * caller's role (fleet_manager / administrator) and organization were verified server-side (the page does):
 * the stored pickup / drop-off coordinates of riders are revoked from the `authenticated` role (0064), and the
 * result is aggregated numbers only - no row, label or coordinate ever leaves this function.
 *
 * F1 hardening: PostgREST caps every response at max_rows (1000 on this project), so every list is read page by
 * page with .range() over a stable order, `.in()` id lists are chunked, and ANY query error THROWS (the page then
 * renders its localized error alert) instead of silently turning into zeros.
 */
export const PAGE_SIZE = 1000;
export const IN_CHUNK = 100;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function pageAll<T>(label: string, build: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`kpi query failed (${label}): ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export async function chunked<T, R>(ids: T[], size: number, run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await run(ids.slice(i, i + size))));
  return out;
}

export async function loadCarpoolKpis(
  admin: SupabaseClient<Database>,
  organizationId: string,
  days: number,
  now: Date = new Date(),
): Promise<KpiReport> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const fromDay = from.slice(0, 10);

  const [searchLog, events, requests, quota, completed, activeOffers] = await Promise.all([
    pageAll("search_log", (a, b) =>
      admin.from("carpool_search_log")
        .select("source, offers_evaluated, prefilter_candidates, precise_route_calls, compatible_count, outcome, latency_ms, created_at")
        .eq("organization_id", organizationId).gte("created_at", from).lte("created_at", to).order("id").range(a, b)),
    pageAll("events", (a, b) =>
      admin.from("carpool_events").select("event_type").eq("organization_id", organizationId)
        .gte("created_at", from).lte("created_at", to).order("id").range(a, b)),
    pageAll("requests", (a, b) =>
      admin.from("carpool_ride_requests").select("status, requested_seats").eq("organization_id", organizationId)
        .gte("created_at", from).lte("created_at", to).order("id").range(a, b)),
    pageAll("quota", (a, b) =>
      admin.from("geo_provider_quota_counters").select("provider_call_kind, call_count, error_count, total_latency_ms")
        .eq("organization_id", organizationId).gte("day", fromDay).order("id").range(a, b)),
    pageAll("completed_reservations", (a, b) =>
      admin.from("reservations").select("trip_request_id").eq("organization_id", organizationId).eq("status", "completed")
        .gte("end_at", from).lte("end_at", to).order("id").range(a, b)),
    admin.from("carpool_offers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active"),
  ]);
  if (activeOffers.error) throw new Error(`kpi query failed (active_offers): ${activeOffers.error.message}`);

  // Completed shared trips: a completed host reservation with >= 1 ACCEPTED rider request on the host's offer.
  const completedTripIds = [...new Set(completed.map((r) => r.trip_request_id))];
  const offers = await chunked(completedTripIds, IN_CHUNK, (chunk) =>
    pageAll("offers", (a, b) =>
      admin.from("carpool_offers").select("id, trip_request_id").eq("organization_id", organizationId)
        .in("trip_request_id", chunk).order("id").range(a, b)));
  const offerIds = offers.map((o) => o.id);
  const accepted = await chunked(offerIds, IN_CHUNK, (chunk) =>
    pageAll("accepted_requests", (a, b) =>
      admin.from("carpool_ride_requests")
        .select("id, carpool_offer_id, status, requested_seats, pickup_location, dropoff_location")
        .eq("organization_id", organizationId).eq("status", "ACCEPTED").in("carpool_offer_id", chunk).order("id").range(a, b)));
  const acceptedOnCompleted: RideRequestRow[] = accepted.map((r) => ({
    status: r.status, requested_seats: r.requested_seats, pickup_location: r.pickup_location, dropoff_location: r.dropoff_location,
  }));
  const tripByOffer = new Map(offers.map((o) => [o.id, o.trip_request_id]));
  const completedSharedTrips = new Set(accepted.map((r) => tripByOffer.get(r.carpool_offer_id))).size;

  return {
    range: { days, from, to },
    search: aggregateSearchLog(searchLog),
    offers: { enabled: countEvents(events, "CarpoolOfferEnabled"), activeNow: activeOffers.count ?? 0 },
    requests: aggregateRequests(requests),
    invalidations: countEvents(events, "RideInvalidated"),
    shared: aggregateShared(completedSharedTrips, acceptedOnCompleted),
    provider: aggregateProvider(quota),
  };
}
