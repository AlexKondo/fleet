import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import type { HostOfferView, HostParticipantView, HostRequestView } from "./CarpoolHostSection";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface HostCarpoolData {
  offer: HostOfferView | null;
  participants: HostParticipantView[];
  pending: HostRequestView[];
  history: HostRequestView[];
  policyEnabled: boolean;
  showSection: boolean;
}

/** One row of host_ride_request_places (0064): coarse while PENDING, exact once ACCEPTED, else null. */
export interface HostPlaceRow {
  request_id: string;
  rider_id: string;
  status: string;
  pickup_label: string | null;
  dropoff_label: string | null;
  is_exact: boolean;
}

/**
 * Pure: the places the HOST may see for a request, decided by the DATABASE function (the browser and
 * even this server never receive the exact address of a request that is not ACCEPTED - the
 * definer function returns a coarse label for PENDING). This mapper additionally refuses to show
 * anything for a status other than PENDING/ACCEPTED, whatever the row says (defence in depth).
 */
export function placesForHost(status: string, place: HostPlaceRow | undefined) {
  if (!place || (status !== "PENDING" && status !== "ACCEPTED")) {
    return { pickupLabel: null, dropoffLabel: null, placesExact: false };
  }
  return {
    pickupLabel: place.pickup_label,
    dropoffLabel: place.dropoff_label,
    placesExact: status === "ACCEPTED" && place.is_exact,
  };
}

/**
 * Phase C5: everything the host's carpool section on My Trip needs, read under the HOST's own
 * RLS context (carpool_ride_requests is readable only by the rider, the offer's host and
 * managers - 0062). Participants come from trip_participants status='accepted', which holds both
 * the new engine's accepted riders (written by accept_carpool_ride_request) and legacy ones, so
 * nobody is listed twice.
 */
export async function loadHostCarpool(
  supabase: Supabase,
  organizationId: string,
  tripRequestId: string,
): Promise<HostCarpoolData> {
  const [policyLoad, { data: offerRows }, { data: participantRows }, { data: placeRows }] = await Promise.all([
    loadLatestPolicy(supabase, organizationId),
    supabase
      .from("carpool_offers")
      .select("id, status, seats_offered, seats_available")
      .eq("trip_request_id", tripRequestId)
      .order("created_at", { ascending: false }),
    supabase
      .from("trip_participants")
      .select("id, passenger_id, passenger_count, passenger:profiles(full_name)")
      .eq("trip_request_id", tripRequestId)
      .eq("status", "accepted")
      .order("joined_at", { ascending: true }),
    // 0064: the rider's pickup/drop-off are NOT directly readable; this definer function answers only for
    // the host and returns a coarse label while PENDING, the exact one once ACCEPTED.
    supabase.rpc("host_ride_request_places", { p_trip_request_id: tripRequestId }),
  ]);
  const placeByRequest = new Map((placeRows ?? []).map((p) => [p.request_id, p as HostPlaceRow]));
  const acceptedPlaceByRider = new Map(
    (placeRows ?? []).filter((p) => p.status === "ACCEPTED").map((p) => [p.rider_id, p as HostPlaceRow]),
  );

  const offerIds = (offerRows ?? []).map((o) => o.id);
  const { data: requestRows } =
    offerIds.length > 0
      ? await supabase
          .from("carpool_ride_requests")
          .select(
            "id, status, status_reason, requested_seats, requested_departure_at, match_additional_distance_km, match_additional_time_min, updated_at, rider:profiles!rider_id(full_name)",
          )
          .in("carpool_offer_id", offerIds)
          .order("created_at", { ascending: true })
      : { data: [] };

  const all = requestRows ?? [];
  const toView = (r: (typeof all)[number]): HostRequestView => ({
    id: r.id,
    status: r.status,
    statusReason: r.status_reason,
    riderName: r.rider?.full_name ?? null,
    requestedSeats: r.requested_seats,
    requestedDepartureAt: r.requested_departure_at,
    detourKm: r.match_additional_distance_km === null ? null : Number(r.match_additional_distance_km),
    detourMin: r.match_additional_time_min === null ? null : Number(r.match_additional_time_min),
    ...placesForHost(r.status, placeByRequest.get(r.id)),
  });

  const latest = (offerRows ?? [])[0];
  const offer: HostOfferView | null = latest
    ? {
        id: latest.id,
        status: latest.status,
        seatsOffered: latest.seats_offered,
        seatsAvailable: latest.seats_available,
      }
    : null;
  const policyEnabled = policyLoad.ok && policyLoad.policy.carpoolEnabled;

  return {
    offer,
    participants: (participantRows ?? []).map((p) => {
      const place = acceptedPlaceByRider.get(p.passenger_id);
      return {
        id: p.id,
        name: p.passenger?.full_name ?? null,
        seats: p.passenger_count,
        pickupLabel: place?.pickup_label ?? null,
        dropoffLabel: place?.dropoff_label ?? null,
      };
    }),
    pending: all.filter((r) => r.status === "PENDING").map(toView),
    history: all
      .filter((r) => r.status !== "PENDING" && r.status !== "ACCEPTED")
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, 20)
      .map(toView),
    policyEnabled,
    showSection: policyEnabled || offer !== null || all.length > 0,
  };
}
