import { recommendVehicle, type CandidateVehicle, type TripRequest } from "@fleet/domain";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { toDomainCategory, toDomainVehicle } from "./mappers";
import { loadOrgConfig } from "./orgConfig";
import { createSupabaseAdminClient } from "../supabase/admin";

/**
 * Only vehicles genuinely 'available' right now are candidates for an UNATTENDED swap —
 * recommendVehicle's own broader pool (also charging/cleaning, "READY_IF_PREPARED") is
 * right for a human planning ahead, but auto-reassignment has no one watching to finish
 * that preparation, so it must land on a vehicle that needs none. Re-queried fresh on
 * every reservation in the batch (not cached once up front) — a vehicle this function
 * just committed to an earlier reservation in the same batch has since flipped to
 * 'reserved'/'in_use' and must not be reused, and (asymmetrically) a vehicle the RPC's
 * own status-reconciliation released back to 'available' as a side effect of an earlier
 * swap should become offerable again — both only visible by re-reading current state.
 */
async function loadAvailableVehicleCandidates(
  supabase: TypedSupabaseClient,
  organizationId: string,
): Promise<CandidateVehicle[]> {
  const { data: vehicleRows } = await supabase
    .from("vehicles")
    .select("*, category:vehicle_categories(*)")
    .eq("organization_id", organizationId)
    .eq("status", "available");

  return (vehicleRows ?? [])
    .filter((row) => row.category)
    .map((row) => ({ vehicle: toDomainVehicle(row), category: toDomainCategory(row.category!) }));
}

/**
 * BR-019/BR-020/J-13 — automatic reassignment when a delay marks a reservation impacted
 * (see 0018_automatic_reassignment.sql for why the decision is made here, in the domain
 * package's own recommendVehicle, rather than duplicated in SQL). Called from
 * postReservationMessage after post_reservation_message returns which reservations it
 * just marked impacted. Best-effort per reservation: a failure to reassign one (no
 * eligible alternative, lost a race for the vehicle) never throws — it's left impacted
 * for a fleet_manager to resolve manually, exactly as before this feature existed.
 */
export async function attemptAutomaticReassignment(
  supabase: TypedSupabaseClient,
  organizationId: string,
  impactedReservationIds: string[],
): Promise<void> {
  if (impactedReservationIds.length === 0) return;

  const config = await loadOrgConfig(supabase, organizationId);
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  for (const reservationId of impactedReservationIds) {
    const { data: reservation } = await supabase
      .from("reservations")
      .select(
        `id, vehicle_id,
         trip_request:trip_requests(id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, requester_id)`,
      )
      .eq("id", reservationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!reservation?.trip_request) continue;

    const candidates = await loadAvailableVehicleCandidates(supabase, organizationId);
    const alternatives = candidates.filter((c) => c.vehicle.id !== reservation.vehicle_id);
    if (alternatives.length === 0) continue;

    const tripRequest: TripRequest = {
      id: reservation.trip_request.id,
      organizationId,
      requesterId: reservation.trip_request.requester_id,
      departureAt: reservation.trip_request.departure_at,
      expectedReturnAt: reservation.trip_request.expected_return_at,
      origin: reservation.trip_request.origin,
      destination: reservation.trip_request.destination,
      distanceKm: Number(reservation.trip_request.distance_km),
      passengerCount: reservation.trip_request.passenger_count,
      requiresCargo: reservation.trip_request.requires_cargo,
      justification: reservation.trip_request.justification,
    };

    const recommendation = recommendVehicle({
      tripRequest,
      candidateVehicles: alternatives,
      now,
      config: config.readiness,
    });

    // requiredPreparation present means the winner is only READY_IF_PREPARED (tier 1) —
    // not eligible for an unattended swap, same reasoning as the candidate pool filter
    // above.
    if (
      !recommendation.recommendedVehicleId ||
      (recommendation.requiredPreparation && recommendation.requiredPreparation.length > 0)
    ) {
      continue;
    }

    const newVehicleId = recommendation.recommendedVehicleId;
    const { error: swapError } = await admin.rpc("auto_reassign_reservation_vehicle", {
      p_organization_id: organizationId,
      p_reservation_id: reservationId,
      p_new_vehicle_id: newVehicleId,
    });
    if (swapError) continue;

    const newPlate = alternatives.find((c) => c.vehicle.id === newVehicleId)?.vehicle.plate ?? "";
    await supabase.from("notifications").insert({
      organization_id: organizationId,
      user_id: reservation.trip_request.requester_id,
      title: "Veículo reatribuído automaticamente",
      body: `Devido a um atraso na reserva anterior, sua viagem foi movida automaticamente para o veículo ${newPlate}.`,
    });
  }
}
