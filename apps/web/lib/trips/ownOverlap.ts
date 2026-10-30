import type { TypedSupabaseClient } from "@fleet/supabase-client";

/** One of the caller's own open reservations that collides with a requested window. Nothing about other people. */
export interface OverlappingReservation {
  reservationId: string;
  status: "pending_approval" | "confirmed";
  vehiclePlate: string;
  vehicleName: string;
  origin: string;
  destination: string;
  startAt: string;
  endAt: string;
}

/** Half-open interval test, the same semantics as the reservations EXCLUDE constraint (tstzrange '[)'): back-to-back is fine. */
export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

/**
 * A person cannot drive two vehicles at once: the caller's own pending/confirmed reservations whose window overlaps
 * [departureAt, expectedReturnAt). Read with the caller's RLS client (a requester always sees their own trips).
 * `ignoreReservationId` lets a future "change reservation" flow exclude the reservation being edited.
 */
export async function findOwnOverlappingReservations(
  supabase: TypedSupabaseClient,
  userId: string,
  departureAt: string,
  expectedReturnAt: string,
  ignoreReservationId?: string,
): Promise<OverlappingReservation[]> {
  const { data } = await supabase
    .from("reservations")
    .select(
      "id, status, start_at, end_at, vehicle:vehicles(plate, name), trip_request:trip_requests!inner(requester_id, origin, destination)",
    )
    .eq("trip_request.requester_id", userId)
    .in("status", ["pending_approval", "confirmed"])
    .lt("start_at", expectedReturnAt)
    .gt("end_at", departureAt);

  return (data ?? [])
    .filter((r) => r.trip_request && r.id !== ignoreReservationId)
    .filter((r) => windowsOverlap(r.start_at, r.end_at, departureAt, expectedReturnAt))
    .map((r) => ({
      reservationId: r.id,
      status: r.status as "pending_approval" | "confirmed",
      vehiclePlate: r.vehicle?.plate ?? "",
      vehicleName: r.vehicle?.name ?? r.vehicle?.plate ?? "",
      origin: r.trip_request!.origin,
      destination: r.trip_request!.destination,
      startAt: r.start_at,
      endAt: r.end_at,
    }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
