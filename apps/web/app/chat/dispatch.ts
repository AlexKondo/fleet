import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { planTrip, type TripFormInput } from "@/app/trips/new/actions";
import { postReservationMessage } from "@/app/reservations/[id]/actions";
import { getFleetManagerEmails } from "@/lib/email/recipients";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { formatDateTime } from "@/lib/formatDateTime";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { getAppUrl } from "@/lib/getAppUrl";
import { isCarpoolIntent, type IntentName } from "@fleet/domain";
import { findActiveReservations, resolveReservationId } from "./queries";
import { executeCarpoolIntent, loadChatCarpoolCtx, publishOfferForNewReservation } from "./carpoolChat";

export interface DispatchResult {
  success: boolean;
  // On failure, `message` is a stable internal code (or a raw RPC error) — never shown to
  // the user directly (apps/web/app/chat/actions.ts maps it to a friendly string).
  // `reasons`, when present, is already human-readable Portuguese explaining WHY (e.g. the
  // recommendation engine's own reasons for finding no eligible vehicle) and safe to show
  // as-is — kept separate from `message` specifically so actions.ts never has to guess
  // whether a given string is an internal code or genuine explanatory prose.
  message: string;
  reasons?: string[];
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
        // Now a required slot (intentCatalog.ts) — the orchestrator always asks for it
        // explicitly before this intent can even reach confirmation, same opt-in the
        // self-service form's checkbox has always had.
        allowCarpool: slots.allowCarpool === "true",
      };
      const plan = await planTrip(input);
      if (plan.error) return { success: false, message: plan.error };

      if (plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0) {
        const target = plan.carpoolOptions[0]!;
        // reservationId is a RESERVATION id; create_carpool_participation needs the host's
        // trip_request id (planTrip resolves it from the same candidate, like confirmTrip does).
        if (!target.tripRequestId) return { success: false, message: "carpool_trip_unresolved" };
        const { error } = await supabase.rpc("create_carpool_participation", {
          p_departure_at: input.departureAt,
          p_expected_return_at: input.expectedReturnAt,
          p_origin: input.origin,
          p_destination: input.destination,
          p_distance_km: input.distanceKm,
          p_passenger_count: input.passengerCount,
          p_requires_cargo: input.requiresCargo,
          p_justification: input.justification,
          p_existing_trip_request_id: target.tripRequestId,
        });
        if (error) return { success: false, message: error.message };
        // The form flow (trips/new/actions.ts's confirmTrip) gets this "for free" — a
        // redirect() to /trips after creating always re-renders with fresh data. Chat
        // never navigates the page, so without an explicit revalidate the reservation was
        // real in the database but /trips (already server-rendered before the chat
        // request) kept showing its stale pre-reservation snapshot until a hard refresh.
        revalidatePath("/trips");
        revalidatePath("/dashboard");
        return { success: true, message: `Você entrou na carona no veículo ${target.vehiclePlate}.` };
      }

      if (plan.type === "vehicle" && plan.vehicle) {
        // If the driver picked an alternative earlier in the conversation
        // (actions.ts stashes it as slots.preferredVehicleId once they name one from the
        // list shown alongside the recommendation), honor it — but only if it's still
        // among THIS re-derived eligible set. Never trust a vehicle id that didn't come
        // out of planTrip/planMobility's own re-validation, and silently fall back to the
        // recommendation if the preference no longer checks out (already booked since,
        // no longer eligible, etc.) rather than erroring the whole reservation over it.
        const preferredId = slots.preferredVehicleId;
        const preferredIsEligible =
          preferredId === plan.vehicle.vehicleId ||
          plan.vehicle.alternatives.some((alt) => alt.vehicleId === preferredId);
        const chosenVehicleId = preferredIsEligible ? preferredId! : plan.vehicle.vehicleId;
        const chosenPlate =
          chosenVehicleId === plan.vehicle.vehicleId
            ? plan.vehicle.plate
            : plan.vehicle.alternatives.find((alt) => alt.vehicleId === chosenVehicleId)?.plate ??
              plan.vehicle.plate;

        const { data: createdReservationId, error } = await supabase.rpc("create_vehicle_reservation", {
          p_departure_at: input.departureAt,
          p_expected_return_at: input.expectedReturnAt,
          p_origin: input.origin,
          p_destination: input.destination,
          p_distance_km: input.distanceKm,
          p_passenger_count: input.passengerCount,
          p_requires_cargo: input.requiresCargo,
          p_justification: input.justification,
          p_vehicle_id: chosenVehicleId,
          p_allow_carpool: input.allowCarpool,
        });
        if (error) {
          // This RPC error was previously invisible end-to-end: never logged here, and the
          // user only ever saw the generic friendly fallback (apps/web/app/chat/actions.ts).
          // Root-caused one real failure class this way already (two overloaded
          // create_vehicle_reservation signatures after 0047 added a parameter via CREATE
          // OR REPLACE instead of replacing it — see 0049's migration comment) that was
          // undiagnosable without this.
          console.error("dispatchIntent CREATE_RESERVATION (vehicle) failed:", error.code, error.message);
          return {
            success: false,
            message: error.code === "23P01" ? "RESERVATION_CONFLICT" : error.message,
          };
        }

        // Same manager notification confirmTrip sends (apps/web/app/trips/new/actions.ts)
        // — a reservation created via chat still needs approval like any other, and the
        // approving fleet manager shouldn't only find out by happening to check the app.
        // Best-effort: sendEmail never throws, so a delivery failure never undoes the
        // reservation that was already created.
        const { data: creatorProfile } = await supabase
          .from("profiles")
          .select("organization_id")
          .eq("id", user.id)
          .single();
        if (creatorProfile) {
          const managerEmails = await getFleetManagerEmails(supabase, creatorProfile.organization_id);
          if (managerEmails.length > 0) {
            const { html, text } = renderEmail({
              heading: "Nova reserva aguardando aprovação",
              bodyLines: [
                `Uma nova viagem para <strong>${input.destination}</strong> aguarda aprovação (via assistente conversacional).`,
                `Origem: ${input.origin} · Saída: ${formatDateTime(input.departureAt, DEFAULT_LOCALE)}`,
              ],
              ctaLabel: "Abrir Painel",
              ctaUrl: `${getAppUrl()}/dashboard`,
            });
            await sendEmail({ to: managerEmails, subject: "Nova reserva aguardando aprovação", html, text });
          }
        }

        // Phase C6 host question (parity with confirmTrip): when the org runs the Smart Carpool
        // engine and the user answered Yes to "offer seats", publish through the same
        // enable_carpool_offer path AFTER the reservation exists. Never undoes the reservation.
        let carpoolNote = "";
        if (input.allowCarpool && typeof createdReservationId === "string") {
          const carpoolCtx = await loadChatCarpoolCtx(supabase, user.id);
          if (carpoolCtx?.gating.newEngine) {
            const chosenMax =
              chosenVehicleId === plan.vehicle.vehicleId
                ? plan.vehicle.maxOfferableSeats
                : plan.vehicle.alternatives.find((alt) => alt.vehicleId === chosenVehicleId)?.maxOfferableSeats ?? 0;
            carpoolNote = await publishOfferForNewReservation(carpoolCtx, {
              reservationId: createdReservationId,
              maxSeats: chosenMax,
              requestedSeats: slots.offerSeats,
            });
          }
        }

        revalidatePath("/trips");
        revalidatePath("/dashboard");
        return { success: true, message: `Reserva criada — veículo ${chosenPlate}.${carpoolNote}` };
      }

      return {
        success: false,
        message: "no_eligible_vehicle",
        reasons: plan.reasons.length > 0 ? plan.reasons : ["Nenhum veículo elegível encontrado para esse período."],
      };
    }

    case "CANCEL_RESERVATION": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return { success: false, message: "reservation_not_found" };
      const { error } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId });
      if (error) return { success: false, message: error.message };
      revalidatePath("/trips");
      revalidatePath("/dashboard");
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
      // postReservationMessage's `error` already comes from the app's own i18n dictionary
      // (dict.errors.reservations.*) — genuinely safe human-readable text, not a code.
      if (result.status === "error") {
        return { success: false, message: "message_post_failed", reasons: result.error ? [result.error] : undefined };
      }
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
      if (result.status === "error") {
        return { success: false, message: "message_post_failed", reasons: result.error ? [result.error] : undefined };
      }
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
        allowCarpool: true,
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

    // Smart Carpool (Phase C6): every case calls the same server actions/RPCs as the web UI
    // (apps/web/app/carpool/requestActions.ts) through carpoolChat.ts, which re-resolves every
    // referenced offer/request among the CALLER'S OWN rows and re-validates it at this point.
    // Authorization (host vs rider, organization, seats, idempotency) stays in the RPCs.
    case "OFFER_CARPOOL":
    case "DISABLE_CARPOOL":
    case "FIND_CARPOOL":
    case "REQUEST_CARPOOL":
    case "ACCEPT_CARPOOL_REQUEST":
    case "REJECT_CARPOOL_REQUEST":
    case "CANCEL_CARPOOL_REQUEST": {
      if (!isCarpoolIntent(intent)) return { success: false, message: "not_supported_via_chat" };
      const carpoolCtx = await loadChatCarpoolCtx(supabase, user.id);
      if (!carpoolCtx) return { success: false, message: "not_authenticated" };
      return executeCarpoolIntent(carpoolCtx, intent, slots);
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
