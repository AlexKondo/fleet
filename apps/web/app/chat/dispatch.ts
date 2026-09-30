import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { planTrip, type TripFormInput } from "@/app/trips/new/actions";
import { postReservationMessage } from "@/app/reservations/[id]/actions";
import type { IntentName } from "@fleet/domain";
import { findActiveReservations, resolveReservationId } from "./queries";

export interface DispatchResult {
  success: boolean;
  message: string;
}

/**
 * Executes a fully-slotted, EXPLICITLY CONFIRMED intent by calling the app's existing,
 * already-authorized actions/RPCs — this file must never contain new business logic, only
 * glue. The LLM never picks a vehicle, never decides eligibility, and never writes to the
 * database; every branch below either calls an existing server action or issues the exact
 * same RPC an existing action already uses, so the same RBAC/eligibility/policy checks
 * apply regardless of whether the request came from a form or from chat.
 *
 * START_TRIP/END_TRIP/REQUEST_DIFFERENT_VEHICLE are intentionally NOT automated here: pickup
 * and return require photo evidence (BR-013/ADR-004) chat can't reasonably collect, and
 * vehicle-swap is a fleet-manager/dashboard action tied to a specific UI, not a self-service
 * one. Those intents get a direct answer pointing at the right screen instead of a fabricated
 * "done" — never claim to have done something that didn't actually happen.
 */
export async function dispatchIntent(
  intent: IntentName,
  slots: Record<string, string>,
): Promise<DispatchResult> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { success: false, message: "not_authenticated" };

  switch (intent) {
    case "CREATE_RESERVATION": {
      const input: TripFormInput = {
        departureAt: new Date(slots.departureAt ?? "").toISOString(),
        expectedReturnAt: new Date(slots.expectedReturnAt ?? "").toISOString(),
        origin: slots.origin ?? "",
        destination: slots.destination ?? "",
        distanceKm: Number(slots.distanceKm ?? 0),
        passengerCount: Number(slots.passengerCount ?? 1),
        requiresCargo: slots.requiresCargo === "true",
        justification: slots.justification ?? "Solicitado via assistente conversacional",
      };
      const plan = await planTrip(input);
      if (plan.error) return { success: false, message: plan.error };

      if (plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0) {
        const target = plan.carpoolOptions[0]!;
        const { error } = await supabase.rpc("create_carpool_participation", {
          p_departure_at: input.departureAt,
          p_expected_return_at: input.expectedReturnAt,
          p_origin: input.origin,
          p_destination: input.destination,
          p_distance_km: input.distanceKm,
          p_passenger_count: input.passengerCount,
          p_requires_cargo: input.requiresCargo,
          p_justification: input.justification,
          p_existing_trip_request_id: target.reservationId,
        });
        if (error) return { success: false, message: error.message };
        return { success: true, message: `Você entrou na carona no veículo ${target.vehiclePlate}.` };
      }

      if (plan.type === "vehicle" && plan.vehicle) {
        const { error } = await supabase.rpc("create_vehicle_reservation", {
          p_departure_at: input.departureAt,
          p_expected_return_at: input.expectedReturnAt,
          p_origin: input.origin,
          p_destination: input.destination,
          p_distance_km: input.distanceKm,
          p_passenger_count: input.passengerCount,
          p_requires_cargo: input.requiresCargo,
          p_justification: input.justification,
          p_vehicle_id: plan.vehicle.vehicleId,
        });
        if (error) {
          return {
            success: false,
            message: error.code === "23P01" ? "RESERVATION_CONFLICT" : error.message,
          };
        }
        return { success: true, message: `Reserva criada — veículo ${plan.vehicle.plate}.` };
      }

      return { success: false, message: plan.reasons.join(" ") || "Nenhum veículo elegível encontrado." };
    }

    case "CANCEL_RESERVATION": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return { success: false, message: "reservation_not_found" };
      const { error } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId });
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Reserva cancelada." };
    }

    case "VIEW_RESERVATION":
    case "FIND_MY_VEHICLE": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      const match = active.find((r) => r.reservationId === reservationId) ?? active[0];
      if (!match) return { success: true, message: "Você não tem nenhuma reserva ativa no momento." };
      return {
        success: true,
        message: `Veículo ${match.vehiclePlate}, destino ${match.destination}, saída em ${match.departureAt}.`,
      };
    }

    case "REPORT_DAMAGE":
    case "REPORT_DELAY": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return { success: false, message: "reservation_not_found" };

      const formData = new FormData();
      formData.set("reservationId", reservationId);
      formData.set("messageType", intent === "REPORT_DAMAGE" ? "vehicle_issue" : "delay");
      formData.set("body", slots.damageNotes || slots.delayNotes || "Reportado via assistente conversacional.");
      const result = await postReservationMessage({ status: "idle" }, formData);
      if (result.status === "error") return { success: false, message: result.error ?? "unknown_error" };
      return { success: true, message: "Registrado na reserva." };
    }

    case "EXTEND_RESERVATION": {
      // Reuses the exact same RPC path as the Communication Hub's "return_time_change"
      // message (apps/web/app/reservations/[id]/actions.ts): post_reservation_message
      // updates the reservation's expected return time and runs its own delay-impact/
      // automatic-reassignment side effects atomically — nothing new to implement here.
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return { success: false, message: "reservation_not_found" };
      if (!slots.newExpectedReturnAt) return { success: false, message: "missing_new_return_time" };

      const formData = new FormData();
      formData.set("reservationId", reservationId);
      formData.set("messageType", "return_time_change");
      formData.set("newExpectedReturnAt", slots.newExpectedReturnAt);
      formData.set("body", `Novo horário de retorno solicitado: ${slots.newExpectedReturnAt}.`);
      const result = await postReservationMessage({ status: "idle" }, formData);
      if (result.status === "error") return { success: false, message: result.error ?? "unknown_error" };
      return { success: true, message: "Horário de retorno atualizado." };
    }

    case "CHECK_AVAILABILITY":
    case "CHECK_RANGE": {
      const input: TripFormInput = {
        departureAt: new Date(slots.departureAt ?? new Date().toISOString()).toISOString(),
        expectedReturnAt: new Date(
          slots.expectedReturnAt ?? new Date(Date.now() + 3600_000).toISOString(),
        ).toISOString(),
        origin: slots.origin ?? "",
        destination: slots.destination ?? "",
        distanceKm: Number(slots.distanceKm ?? 0),
        passengerCount: Number(slots.passengerCount ?? 1),
        requiresCargo: false,
        justification: "Consulta via assistente conversacional",
      };
      const plan = await planTrip(input);
      if (plan.type === "none") {
        return { success: true, message: plan.reasons.join(" ") || "Nenhum veículo disponível para essa janela." };
      }
      return {
        success: true,
        message:
          plan.type === "vehicle" && plan.vehicle
            ? `Sim — veículo ${plan.vehicle.plate} disponível. ${plan.vehicle.reasons.join(" ")}`
            : "Há uma opção de carona disponível para essa janela.",
      };
    }

    // Not automated (see file-level comment) — answered informationally by
    // apps/web/app/chat/actions.ts before ever reaching dispatch for these; kept here only
    // so the switch is exhaustive over every catalog intent.
    case "CHANGE_RESERVATION":
    case "REQUEST_DIFFERENT_VEHICLE":
    case "START_TRIP":
    case "END_TRIP":
    case "ASK_FLEET":
      return { success: false, message: "not_supported_via_chat" };
  }
}
