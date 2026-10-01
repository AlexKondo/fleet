import { recommendVehicle, type CandidateVehicle, type TripRequest } from "@fleet/domain";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import {
  toDomainCategory,
  toDomainVehicle,
  VEHICLE_CATEGORY_DOMAIN_COLUMNS,
  VEHICLE_DOMAIN_COLUMNS,
} from "./mappers";
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
    .select(`${VEHICLE_DOMAIN_COLUMNS}, category:vehicle_categories(${VEHICLE_CATEGORY_DOMAIN_COLUMNS})`)
    .eq("organization_id", organizationId)
    .eq("status", "available");

  return (vehicleRows ?? [])
    .filter((row) => row.category)
    .map((row) => ({
      vehicle: toDomainVehicle(row, row.category!.energy_type),
      category: toDomainCategory(row.category!),
    }));
}

/**
 * BR-019/BR-020/J-13 — automatic reassignment when a delay marks a reservation impacted
 * (see 0018_automatic_reassignment.sql for why the decision is made here, in the domain
 * package's own recommendVehicle, rather than duplicated in SQL). Called from
 * postReservationMessage after post_reservation_message returns which reservations it
 * just marked impacted.
 *
 * Every impacted reservation gets exactly one follow-up notification either way — a
 * silent "left impacted with no explanation" outcome isn't acceptable to the affected
 * requester: either the vehicle actually changed (told which plate), or it didn't and
 * they need to know their trip is now at risk and a human has to sort it out. Only the
 * one case where the reservation/requester can't even be resolved (deleted mid-flight,
 * effectively impossible in practice) has no one to notify.
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

  // One notification row per impacted reservation, accumulated and written as a single
  // multi-row INSERT after the loop rather than one round trip per reservation — the
  // vehicle/reservation reads below genuinely must be sequential (each swap changes what
  // the next iteration may offer, see loadAvailableVehicleCandidates), but the
  // notifications don't feed anything and were paying N serial round trips for nothing.
  const notificationRows: {
    organization_id: string;
    user_id: string;
    title: string;
    body: string;
  }[] = [];

  for (const reservationId of impactedReservationIds) {
    // Phase C7 (0063): the impacted reservation belongs to ANOTHER traveler (the next booking of the
    // delayed vehicle) and the caller is the delaying employee, whose RLS context can no longer read
    // someone else's reservation. This read therefore uses the service-role client, still scoped by
    // the caller's own organization id and by ids returned from the post_reservation_message definer
    // RPC (never client input).
    const { data: reservation } = await admin
      .from("reservations")
      .select(
        `id, vehicle_id,
         trip_request:trip_requests(id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, requester_id)`,
      )
      .eq("id", reservationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!reservation?.trip_request) continue;

    const requesterId = reservation.trip_request.requester_id;
    let reassignedPlate: string | null = null;

    const candidates = await loadAvailableVehicleCandidates(supabase, organizationId);
    const alternatives = candidates.filter((c) => c.vehicle.id !== reservation.vehicle_id);

    if (alternatives.length > 0) {
      const tripRequest: TripRequest = {
        id: reservation.trip_request.id,
        organizationId,
        requesterId,
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

      // requiredPreparation present means the winner is only READY_IF_PREPARED (tier 1)
      // — not eligible for an unattended swap, same reasoning as the candidate pool
      // filter above.
      const isFullyReady =
        recommendation.recommendedVehicleId &&
        !(recommendation.requiredPreparation && recommendation.requiredPreparation.length > 0);

      if (isFullyReady) {
        const newVehicleId = recommendation.recommendedVehicleId as string;
        const { error: swapError } = await admin.rpc("auto_reassign_reservation_vehicle", {
          p_organization_id: organizationId,
          p_reservation_id: reservationId,
          p_new_vehicle_id: newVehicleId,
        });
        if (!swapError) {
          reassignedPlate = alternatives.find((c) => c.vehicle.id === newVehicleId)?.vehicle.plate ?? "";
        }
      }
    }

    notificationRows.push(
      reassignedPlate !== null
        ? {
            organization_id: organizationId,
            user_id: requesterId,
            title: "Veículo reatribuído automaticamente",
            body: `Devido a um atraso na reserva anterior, sua viagem foi movida automaticamente para o veículo ${reassignedPlate}.`,
          }
        : {
            organization_id: organizationId,
            user_id: requesterId,
            title: "Seu pedido de veículo não pôde ser atendido",
            body: "Um atraso na reserva anterior deste veículo afeta o horário da sua viagem, e não encontramos outro veículo disponível agora. O gestor de frota já foi avisado para resolver manualmente.",
          },
    );
  }

  if (notificationRows.length > 0) {
    await supabase.from("notifications").insert(notificationRows);
  }
}
