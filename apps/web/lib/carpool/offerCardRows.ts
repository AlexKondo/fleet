import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Phase C7 (0063): minimal card data for the compatible offers a search just returned.
 *
 * The caller's own RLS context can no longer read other people's carpool offers or their host
 * trips (they are coworkers' journeys), so this read uses the service-role client. It is only ever
 * called with ids produced by the server-side search for an ALREADY AUTHENTICATED user, is scoped
 * to that user's organization, and returns ONLY what the offer card shows (seats + the host's
 * departure time). The host's origin/destination never leave the server.
 */
export async function loadOfferCardRows(
  organizationId: string,
  offerIds: string[],
): Promise<{ id: string; seats_available: number; hostDepartureAt: string | null }[]> {
  if (offerIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("carpool_offers")
    .select("id, seats_available, trip_request:trip_requests(departure_at)")
    .eq("organization_id", organizationId)
    .in("id", offerIds);
  return (data ?? []).map((r) => ({
    id: r.id,
    seats_available: r.seats_available,
    hostDepartureAt: r.trip_request?.departure_at ?? null,
  }));
}
