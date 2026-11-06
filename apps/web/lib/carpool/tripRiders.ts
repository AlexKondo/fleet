import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** What a trip's carpool looks like from the vehicle bar: seats of the active offer, riders already going along, and requests that still wait for the host. */
export type TripRiders = { seats?: number; taken: number; waiting: number };

type OfferRow = { id: string; trip_request_id: string; seats_offered: number };
type ParticipantRow = { trip_request_id: string; passenger_count: number; status: string };
type WaitingRequestRow = { carpool_offer_id: string };

/**
 * Pure part: puts the three reads together, per trip.
 * - seats: the active offer's seats (a trip without an active offer has none)
 * - taken: accepted riders (new engine and legacy both live in trip_participants status 'accepted')
 * - waiting: new-engine requests in PENDING (through their offer) + legacy participants in 'pending' (the older host acceptance, migration 0020)
 */
export function summarizeTripRiders(offers: OfferRow[], participants: ParticipantRow[], waitingRequests: WaitingRequestRow[]): Map<string, TripRiders> {
  const out = new Map<string, TripRiders>();
  const of = (tripId: string): TripRiders => {
    const cur = out.get(tripId) ?? { taken: 0, waiting: 0 };
    out.set(tripId, cur);
    return cur;
  };
  const tripOfOffer = new Map<string, string>();
  for (const o of offers) {
    tripOfOffer.set(o.id, o.trip_request_id);
    of(o.trip_request_id).seats = o.seats_offered;
  }
  for (const p of participants) {
    if (p.status === "accepted") of(p.trip_request_id).taken += p.passenger_count;
    else if (p.status === "pending") of(p.trip_request_id).waiting += 1;
  }
  for (const r of waitingRequests) {
    const trip = tripOfOffer.get(r.carpool_offer_id);
    if (trip) of(trip).waiting += 1;
  }
  return out;
}

/**
 * Reads, under the caller's own RLS, the carpool state of these trips for the vehicle bars. Best effort: the little person is a hint, so a failed read
 * shows no person instead of breaking the page. The host reads the requests of its own offers and a manager reads all of them (migration 0062).
 */
export async function loadTripRiders(supabase: Supabase, tripIds: string[]): Promise<Map<string, TripRiders>> {
  if (tripIds.length === 0) return new Map();
  const [{ data: offers }, { data: participants }] = await Promise.all([
    supabase.from("carpool_offers").select("id, trip_request_id, seats_offered").eq("status", "active").in("trip_request_id", tripIds),
    supabase.from("trip_participants").select("trip_request_id, passenger_count, status").in("status", ["accepted", "pending"]).in("trip_request_id", tripIds),
  ]);
  const offerRows = (offers ?? []) as OfferRow[];
  const { data: waiting } = offerRows.length
    ? await supabase.from("carpool_ride_requests").select("carpool_offer_id").eq("status", "PENDING").in("carpool_offer_id", offerRows.map((o) => o.id))
    : { data: [] as WaitingRequestRow[] };
  return summarizeTripRiders(offerRows, (participants ?? []) as ParticipantRow[], (waiting ?? []) as WaitingRequestRow[]);
}
