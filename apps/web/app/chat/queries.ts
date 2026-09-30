import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";

export interface ActiveReservationSummary {
  reservationId: string;
  status: string;
  vehiclePlate: string;
  destination: string;
  departureAt: string;
  expectedReturnAt: string;
}

/**
 * The caller's own pending/confirmed reservations — used both to give the orchestrator
 * context (so "cancela minha viagem" can resolve to the one active reservation without
 * asking which one) and to resolve VIEW_RESERVATION/FIND_MY_VEHICLE/CANCEL_RESERVATION
 * when the message didn't name a reservationId explicitly.
 */
export async function findActiveReservations(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<ActiveReservationSummary[]> {
  const { data } = await supabase
    .from("reservations")
    .select(
      `id, status, vehicle:vehicles(plate), trip_request:trip_requests!inner(requester_id, destination, departure_at, expected_return_at)`,
    )
    .eq("trip_request.requester_id", userId)
    .in("status", ["pending_approval", "confirmed"]);

  return (data ?? [])
    .filter((r) => r.trip_request)
    .map((r) => ({
      reservationId: r.id,
      status: r.status,
      vehiclePlate: r.vehicle?.plate ?? "",
      destination: r.trip_request!.destination,
      departureAt: r.trip_request!.departure_at,
      expectedReturnAt: r.trip_request!.expected_return_at,
    }));
}

/** Resolves a possibly-missing reservationId slot against the caller's own active
 * reservations — exact match if given, the single active one if there's only one, or
 * null (ambiguous/none) otherwise, which the caller should turn into a clarifying
 * question rather than guessing. */
export function resolveReservationId(
  slotValue: string | undefined,
  active: ActiveReservationSummary[],
): string | null {
  if (slotValue) return active.some((r) => r.reservationId === slotValue) ? slotValue : null;
  return active.length === 1 ? active[0]!.reservationId : null;
}
