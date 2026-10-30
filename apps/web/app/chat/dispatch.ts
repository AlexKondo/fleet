import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { planTrip, type TripFormInput } from "@/app/trips/new/actions";
import { scheduleApprovalRequest } from "@/lib/approvals/scheduleApproval";
import { postReservationMessage } from "@/app/reservations/[id]/actions";
import { getFleetManagerEmails } from "@/lib/email/recipients";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { formatDateTime, formatDateTimeShort } from "@/lib/formatDateTime";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { getAppUrl } from "@/lib/getAppUrl";
import { isCarpoolIntent, type IntentName } from "@fleet/domain";
import { findActiveReservations, resolveReservationId } from "./queries";
import { findOwnOverlappingReservations } from "@/lib/trips/ownOverlap";
import { cleanCancelReason, notifyManagersOfCancellation } from "@/lib/trips/notifyManagersCancellation";
import { clampText, MAX_JUSTIFICATION_TEXT, MAX_LOCATION_TEXT } from "@/lib/trips/textLimits";
import { executeCarpoolIntent, loadChatCarpoolCtx, publishOfferForNewReservation } from "./carpoolChat";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";
import { fillTemplate } from "@/lib/carpool/errorText";
import { noVehicleReply } from "./noVehicle";
import { classifyError, composeFailure, failureReply, type AssistantReply, type ReplyAction } from "./replies";

export interface DispatchResult {
  success: boolean;
  /** A stable internal code (failures) or the success text. Kept for logs/telemetry and tests;
   * what the USER reads is always `reply` (FIX-VENCIDAS/Assistente: plain-language standard). */
  message: string;
  /** The user-facing answer (dictionary text, never a code), with an optional in-app link. */
  reply: AssistantReply;
  /** The engine found no vehicle (and no carpool) for the window: a legitimate business result. */
  noVehicle?: boolean;
}

const ok = (text: string): DispatchResult => ({ success: true, message: text, reply: { content: text } });

/** Failure with the real cause only in the server log; the user gets the 4-part plain reply. */
function failed(
  dict: Dictionary,
  action: ReplyAction,
  code: string,
  cont: Parameters<typeof failureReply>[3],
  ...signals: (string | null | undefined)[]
): DispatchResult {
  const kind = classifyError(code, ...signals);
  if (kind === "unexpected") console.error(`chat dispatch ${action} failed:`, code, ...signals.filter(Boolean));
  return { success: false, message: code, reply: failureReply(dict, action, kind, cont) };
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
  dict: Dictionary = dictionaries[DEFAULT_LOCALE],
  locale: Locale = DEFAULT_LOCALE,
): Promise<DispatchResult> {
  const r = dict.chat.replies;
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return failed(dict, "generic", "not_authenticated", { mode: "reenter" });

  switch (intent) {
    case "CREATE_RESERVATION": {
      const input: TripFormInput = {
        departureAt: new Date(slots.departureAt ?? "").toISOString(),
        expectedReturnAt: new Date(slots.expectedReturnAt ?? "").toISOString(),
        origin: clampText(slots.origin ?? "", MAX_LOCATION_TEXT),
        originIsFreeText: true,
        destination: clampText(slots.destination ?? "", MAX_LOCATION_TEXT),
        distanceKm: Number(slots.distanceKm ?? 0),
        passengerCount: Number(slots.passengerCount ?? 1),
        requiresCargo: slots.requiresCargo === "true",
        justification: clampText(slots.justification ?? "Solicitado via assistente conversacional", MAX_JUSTIFICATION_TEXT),
        // Now a required slot (intentCatalog.ts) — the orchestrator always asks for it
        // explicitly before this intent can even reach confirmation, same opt-in the
        // self-service form's checkbox has always had.
        allowCarpool: slots.allowCarpool === "true",
      };
      // Every failure of a reservation keeps the trip data in the /trips/new link (true in all
      // branches below: the slots are what the user gave, nothing was created).
      const form = { mode: "form" as const, slots };
      const plan = await planTrip(input);
      if (plan.error) return failed(dict, "reservation", plan.error, form);

      if (plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0) {
        const target = plan.carpoolOptions[0]!;
        // reservationId is a RESERVATION id; create_carpool_participation needs the host's
        // trip_request id (planTrip resolves it from the same candidate, like confirmTrip does).
        if (!target.tripRequestId) return failed(dict, "reservation", "carpool_trip_unresolved", form);
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
        if (error) return failed(dict, "reservation", "carpool_participation_failed", form, error.code, error.message);
        // The form flow (trips/new/actions.ts's confirmTrip) gets this "for free" — a
        // redirect() to /trips after creating always re-renders with fresh data. Chat
        // never navigates the page, so without an explicit revalidate the reservation was
        // real in the database but /trips (already server-rendered before the chat
        // request) kept showing its stale pre-reservation snapshot until a hard refresh.
        revalidatePath("/trips");
        revalidatePath("/dashboard");
        return ok(fillTemplate(r.success.carpoolJoined, { plate: target.vehiclePlate }));
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

        // One person cannot drive two vehicles at once: an own reservation in the same period blocks the booking. The chat does not
        // cancel it on its own; it names it and the person asks to cancel it (CANCEL_RESERVATION asks for the reason).
        const overlaps = await findOwnOverlappingReservations(supabase, user.id, input.departureAt, input.expectedReturnAt);
        if (overlaps.length > 0) {
          const o = overlaps[0]!;
          const reservation = `${o.vehicleName || o.vehiclePlate}${o.vehiclePlate && o.vehicleName !== o.vehiclePlate ? ` (${o.vehiclePlate})` : ""}, ${o.origin} → ${o.destination}, ${formatDateTime(o.startAt, locale)} – ${formatDateTime(o.endAt, locale)}`;
          const content = fillTemplate(dict.chat.replies.reservationOverlap, { reservation });
          return { success: false, message: "user_reservation_overlap", reply: { content } };
        }

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
          // Logged with the real cause (it was invisible end-to-end once: two overloaded
          // create_vehicle_reservation signatures after 0047, see 0049); the user reads the
          // plain-language reason (conflict, maintenance, permission...) or "unexpected".
          console.error("dispatchIntent CREATE_RESERVATION (vehicle) failed:", error.code, error.message);
          const code = error.code === "23P01" ? "RESERVATION_CONFLICT" : "create_reservation_failed";
          return failed(dict, "reservation", code, form, error.code, error.message);
        }
        // Direct manager's WhatsApp approval request (after the response; silent and disabled until the n8n channel is configured).
        scheduleApprovalRequest(typeof createdReservationId === "string" ? createdReservationId : null);

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
        return ok(`${fillTemplate(r.success.reservationCreated, { plate: chosenPlate })}${carpoolNote}`);
      }

      const reply = noVehicleReply(dict, slots, plan.reasons, plan.fleet, "reservation");
      return { success: false, message: "no_eligible_vehicle", reply, noVehicle: true };
    }

    case "CANCEL_RESERVATION": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return failed(dict, "cancel", "reservation_not_found", { mode: "chat" });
      // The manager is told about every cancellation with its reason, so it is asked first (chat/actions.ts); backstop here.
      const cancelReason = cleanCancelReason(slots.cancelReason);
      if (!cancelReason) return failed(dict, "cancel", "missing_cancel_reason", { mode: "chat" });
      const { error } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId, p_reason: cancelReason });
      if (error) return failed(dict, "cancel", "cancel_failed", { mode: "chat" }, error.code, error.message);
      const { data: cancellerProfile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
      if (cancellerProfile) {
        await notifyManagersOfCancellation(supabase, {
          organizationId: cancellerProfile.organization_id,
          requesterId: user.id,
          reservationId,
          reason: cancelReason,
        });
      }
      revalidatePath("/trips");
      revalidatePath("/dashboard");
      return ok(r.success.cancelled);
    }

    case "VIEW_RESERVATION":
    case "FIND_MY_VEHICLE": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      const match = active.find((x) => x.reservationId === reservationId) ?? active[0];
      if (!match) return ok(r.success.noActiveReservation);
      return ok(
        fillTemplate(r.success.reservationInfo, {
          plate: match.vehiclePlate,
          destination: match.destination,
          departure: formatDateTimeShort(match.departureAt, locale),
        }),
      );
    }

    case "REPORT_DAMAGE":
    case "REPORT_DELAY": {
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return failed(dict, "message", "reservation_not_found", { mode: "chat" });

      const formData = new FormData();
      formData.set("reservationId", reservationId);
      formData.set("messageType", intent === "REPORT_DAMAGE" ? "vehicle_issue" : "delay");
      formData.set("body", slots.damageNotes || slots.delayNotes || "Reportado via assistente conversacional.");
      const result = await postReservationMessage({ status: "idle" }, formData);
      // postReservationMessage's `error` already comes from the app's own i18n dictionary
      // (dict.errors.reservations.*) — genuinely safe human-readable text, used as the "why".
      if (result.status === "error") return postFailed(dict, "message", result.error);
      return ok(r.success.messagePosted);
    }

    case "EXTEND_RESERVATION": {
      // Reuses the exact same RPC path as the Communication Hub's "return_time_change"
      // message (apps/web/app/reservations/[id]/actions.ts): post_reservation_message
      // updates the reservation's expected return time and runs its own delay-impact/
      // automatic-reassignment side effects atomically — nothing new to implement here.
      const active = await findActiveReservations(supabase, user.id);
      const reservationId = resolveReservationId(slots.reservationId, active);
      if (!reservationId) return failed(dict, "extend", "reservation_not_found", { mode: "chat" });
      if (!slots.newExpectedReturnAt) return failed(dict, "extend", "missing_new_return_time", { mode: "chat" });

      const formData = new FormData();
      formData.set("reservationId", reservationId);
      formData.set("messageType", "return_time_change");
      formData.set("newExpectedReturnAt", slots.newExpectedReturnAt);
      formData.set("body", `Novo horário de retorno solicitado: ${slots.newExpectedReturnAt}.`);
      const result = await postReservationMessage({ status: "idle" }, formData);
      if (result.status === "error") return postFailed(dict, "extend", result.error);
      return ok(r.success.returnTimeUpdated);
    }

    case "CHECK_AVAILABILITY":
    case "CHECK_RANGE": {
      const input: TripFormInput = {
        departureAt: new Date(slots.departureAt ?? new Date().toISOString()).toISOString(),
        expectedReturnAt: new Date(
          slots.expectedReturnAt ?? new Date(Date.now() + 3600_000).toISOString(),
        ).toISOString(),
        origin: slots.origin ?? "",
        originIsFreeText: true,
        destination: slots.destination ?? "",
        distanceKm: Number(slots.distanceKm ?? 0),
        passengerCount: Number(slots.passengerCount ?? 1),
        requiresCargo: false,
        justification: "Consulta via assistente conversacional",
        allowCarpool: true,
      };
      const plan = await planTrip(input);
      if (plan.error) return failed(dict, "availability", plan.error, { mode: "chat" });
      if (plan.type === "none") {
        // A query, not a failure of the system: answered as a successful reply that explains why.
        const reply = noVehicleReply(dict, slots, plan.reasons, plan.fleet, "availability");
        return { success: true, message: "no_eligible_vehicle", reply, noVehicle: true };
      }
      return ok(
        plan.type === "vehicle" && plan.vehicle
          ? fillTemplate(r.success.vehicleAvailable, { plate: plan.vehicle.plate })
          : r.success.carpoolAvailable,
      );
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
      if (!isCarpoolIntent(intent)) return failed(dict, "generic", "not_supported_via_chat", { mode: "chat" });
      const carpoolCtx = await loadChatCarpoolCtx(supabase, user.id);
      if (!carpoolCtx) return failed(dict, "generic", "not_authenticated", { mode: "reenter" });
      const result = await executeCarpoolIntent(carpoolCtx, intent, slots);
      return { success: result.success, message: result.message, reply: result.reply ?? { content: result.message } };
    }

    // Not automated (see file-level comment) — answered informationally by
    // apps/web/app/chat/actions.ts before ever reaching dispatch for these; kept here only
    // so the switch is exhaustive over every catalog intent.
    case "CHANGE_RESERVATION":
    case "REQUEST_DIFFERENT_VEHICLE":
    case "START_TRIP":
    case "END_TRIP":
    case "ASK_FLEET":
      return failed(dict, "generic", "not_supported_via_chat", { mode: "chat" });
  }
}

/** Translated validation texts postReservationMessage may return (any locale). */
const RESERVATION_MESSAGE_TEXTS = new Set(
  Object.values(dictionaries).flatMap((d) => Object.values(d.errors.reservations as Record<string, string>)),
);

/** postReservationMessage failures: its own dictionary text is the "why"; a raw code or database
 * message (it returns error.message as-is) is classified instead and never shown. */
function postFailed(dict: Dictionary, action: ReplyAction, raw: string | undefined): DispatchResult {
  if (raw && RESERVATION_MESSAGE_TEXTS.has(raw)) {
    return { success: false, message: "message_post_failed", reply: composeFailure(dict, action, raw, { mode: "chat" }) };
  }
  return failed(dict, action, "message_post_failed", { mode: "chat" }, raw);
}
