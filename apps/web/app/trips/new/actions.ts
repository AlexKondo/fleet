"use server";

import { redirect } from "next/navigation";
import {
  planMobility,
  type CarpoolCandidate,
  type CandidateVehicle,
  type PreparationAction,
  type TrafficRestrictionResult,
} from "@fleet/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTime } from "@/lib/formatDateTime";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import {
  toDomainCategory,
  toDomainVehicle,
  VEHICLE_CATEGORY_DOMAIN_COLUMNS,
  VEHICLE_DOMAIN_COLUMNS,
} from "@/lib/domain/mappers";
import { loadOrgConfig } from "@/lib/domain/orgConfig";
import { getFleetManagerEmails } from "@/lib/email/recipients";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppUrl } from "@/lib/getAppUrl";
import { maxOfferableSeats, validOfferSeats } from "@fleet/domain";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import {
  buildOfferCards,
  deriveCarpoolGating,
  runCarpoolFirst,
  type CarpoolFirstState,
  type CarpoolGating,
} from "@/lib/carpool/carpoolFirst";
import { resolveLocationText } from "@/lib/carpool/resolveLocationText";
import { loadOfferCardRows } from "@/lib/carpool/offerCardRows";
import { clampText, MAX_JUSTIFICATION_TEXT, MAX_LOCATION_TEXT } from "@/lib/trips/textLimits";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import { searchCompatibleCarpool } from "@/app/carpool/actions";
import { enableCarpoolOffer } from "@/app/carpool/requestActions";

export interface TripFormInput {
  departureAt: string;
  expectedReturnAt: string;
  origin: string;
  destination: string;
  distanceKm: number;
  passengerCount: number;
  requiresCargo: boolean;
  justification: string;
  /** Whether the requester consents to sharing this vehicle with other travelers headed
   * the same way, if create_vehicle_reservation ends up being the RPC actually called
   * (findCarpoolMatches only reads this off an EXISTING trip being considered as a
   * candidate, so it has no effect on the current search — only on whether THIS booking,
   * once made, can later be offered to someone else). */
  allowCarpool: boolean;
}

export interface PlanTripResult {
  type: "carpool" | "vehicle" | "none";
  reasons: string[];
  /** Every compatible existing trip, not just the closest — see planMobility.carpoolOptions. */
  carpoolOptions?: {
    reservationId: string;
    /** The HOST's trip_request id (what create_carpool_participation's
     * p_existing_trip_request_id needs) — NOT the same as reservationId. */
    tripRequestId: string;
    vehiclePlate: string;
    departureAt: string;
    expectedReturnAt: string;
  }[];
  vehicle?: {
    vehicleId: string;
    plate: string;
    vehicleName: string;
    categoryName: string;
    reasons: string[];
    requiredPreparation?: PreparationAction[];
    /** §15 — set only when the recommended vehicle is affected by a circulation restriction. */
    trafficRestriction?: TrafficRestrictionResult;
    /**
     * BR-005/PB-003 — every OTHER eligible vehicle besides the recommended one, populated
     * only when organization_settings.booking_mode is 'user_choice' or 'hybrid' (empty
     * array for 'ai_recommended', which keeps the exact prior single-recommendation
     * behavior). Lets the requester pick a different eligible vehicle instead.
     */
    alternatives: {
      vehicleId: string;
      plate: string;
      vehicleName: string;
      categoryName: string;
      reasons: string[];
      /** Phase C5: seats the host could offer if this vehicle is chosen. */
      maxOfferableSeats: number;
    }[];
    /** Phase C5: capacity - declared occupants, exactly as enable_carpool_offer derives it. */
    maxOfferableSeats: number;
  };
  bookingMode: "ai_recommended" | "user_choice" | "hybrid";
  error?: string;
  /** Phase C5: how the org's carpool policy gates this plan (absent on errors). When
   * `newEngine` is true the old city-string carpool matcher was NOT consulted. */
  carpoolGating?: CarpoolGating;
  /** Phase C5: result of the carpool-first search (only from planTripAction, only when the
   * org policy has carpool + carpool-first enabled). */
  carpoolFirst?: CarpoolFirstState;
}

interface CarpoolCandidateWithPlate extends CarpoolCandidate {
  vehiclePlate: string;
}

async function buildPlanInputs(input: TripFormInput) {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return { error: "not_authenticated" as const };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return { error: "no_profile" as const };
  }

  const now = new Date().toISOString();
  const config = await loadOrgConfig(supabase, profile.organization_id);
  // Phase C5: the org's latest carpool policy decides whether the NEW geospatial engine owns
  // carpool (then the old city-string matcher below must not surface offers).
  const gating = deriveCarpoolGating(await loadLatestPolicy(supabase, profile.organization_id));

  const { data: vehicleRows } = await supabase
    .from("vehicles")
    .select(`${VEHICLE_DOMAIN_COLUMNS}, name, category:vehicle_categories(${VEHICLE_CATEGORY_DOMAIN_COLUMNS})`)
    .in("status", ["available", "charging", "cleaning"]);

  // toDomainVehicle deliberately excludes `name` (see VEHICLE_DOMAIN_COLUMNS's comment) —
  // the recommendation engine has no use for it, but the chat confirmation card does, to
  // show a driver-friendly name instead of a bare plate. Looked up separately rather than
  // widening the domain Vehicle type just for this.
  const vehicleNameByPlate = new Map((vehicleRows ?? []).map((row) => [row.plate, row.name]));

  // Phase C7 (0063): an employee's RLS context can no longer read other people's reservations
  // (they carry origin/destination/justification of coworkers' journeys). What the allocation needs
  // is only "which vehicles are busy": get_vehicle_busy_windows is an org-scoped definer function
  // that returns (vehicle_id, start_at, end_at, status) and NOTHING personal.
  //
  // A vehicle only gets vehicles.status = 'reserved' once its reservation is actually
  // *approved* (approve_reservation, 0015_audit_trail.sql) — a merely pending_approval
  // reservation leaves status untouched, so without this the candidate query above would
  // still offer that same vehicle to a second, unrelated trip request. record_pickup/record_return
  // (0004/0006_*.sql) only ever track one reservation "owning" a vehicle's status at a
  // time, so — regardless of whether the two requested time windows actually overlap —
  // a vehicle with any active reservation can't safely be hand out to another one until
  // its current lifecycle (approve → pickup → return) finishes.
  const { data: busyWindows } = await supabase.rpc("get_vehicle_busy_windows", { p_from: now });
  const vehicleIdsWithActiveReservation = new Set((busyWindows ?? []).map((w) => w.vehicle_id));

  const vehicleCandidates: CandidateVehicle[] = (vehicleRows ?? [])
    .filter((row) => row.category && !vehicleIdsWithActiveReservation.has(row.id))
    .map((row) => ({
      vehicle: toDomainVehicle(row, row.category!.energy_type),
      category: toDomainCategory(row.category!),
    }));

  // Phase C7 (0063): the OLD city-string carpool matcher (planMobility's carpoolCandidates) needs
  // other travelers' origin/destination/justification, which are no longer readable by the caller
  // (and must not be loaded with a privileged client either: that would re-create the "directory of
  // coworkers' journeys" the pack forbids). Carpool is now offered ONLY by the geospatial engine
  // (searchCompatibleCarpool, which keeps host trip details server-side). An org with carpool
  // disabled therefore simply gets NO carpool offer at all (decision L3, accepted): "carpool disabled by policy"
  // no longer keeps the pre-carpool behaviour of listing coworkers' trips, and the legacy
  // create_carpool_participation path is refused by RLS for coworker trips. findCarpoolMatches itself is untouched
  // (dead code kept on purpose).
  const carpoolCandidates: CarpoolCandidateWithPlate[] = [];

  return { user, profile, now, config, vehicleCandidates, carpoolCandidates, vehicleNameByPlate, gating };
}

/**
 * §15: when this organization has turned the São Paulo traffic-restriction check off
 * (organization_settings.traffic_restriction_enabled = false, edited from /settings),
 * planTrip must not surface a restriction warning at all — even though `planMobility`
 * (packages/domain, not modified here) always evaluates `checkTrafficRestriction`
 * internally against `defaultTrafficRestrictionConfig` and has no per-call "skip" switch.
 * We strip both the dedicated `trafficRestriction` field and the
 * "traffic_restriction_active" reason string here, at the call site, once the plan comes
 * back — rather than passing a `trafficRestrictionConfig` that can never match (e.g. an
 * empty `restrictedZoneCities`/`rules` list), which would still leak the field's
 * *presence* as `{ restricted: false, reasons: [...] }` and is a less direct way to say
 * "this organization turned the check off" than simply never showing it.
 */
function filterTrafficRestrictionReasons(reasons: string[], enabled: boolean): string[] {
  return enabled ? reasons : reasons.filter((r) => r !== "traffic_restriction_active");
}

function parseTripFormInput(formData: FormData): TripFormInput {
  return {
    departureAt: new Date(String(formData.get("departureAt"))).toISOString(),
    expectedReturnAt: new Date(String(formData.get("expectedReturnAt"))).toISOString(),
    origin: clampText(formData.get("origin"), MAX_LOCATION_TEXT),
    destination: clampText(formData.get("destination"), MAX_LOCATION_TEXT),
    distanceKm: Number(formData.get("distanceKm")),
    passengerCount: Number(formData.get("passengerCount")),
    requiresCargo: formData.get("requiresCargo") === "on",
    justification: clampText(formData.get("justification"), MAX_JUSTIFICATION_TEXT),
    allowCarpool: formData.get("allowCarpool") === "on",
  };
}

/**
 * useActionState-bound wrapper around planTrip — kept separate from the plain planTrip()
 * export (still used directly by tests/tools) because useActionState requires the
 * (prevState, formData) signature bound straight to <form action>. DEBUG-SESSION NOTE:
 * TripRequestForm previously called planTrip() as a bare async call from inside
 * startTransition instead of binding it as the form's own action — that shape reproducibly
 * cleared the session cookie and bounced the user to /login on submit in production
 * (confirmed via direct network inspection), while the equivalent useActionState-bound
 * EditVehicleForm/updateVehicle never did. Route every trip/new server action through this
 * bound-to-form shape until the underlying Next.js/Supabase-SSR interaction is root-caused.
 */
export async function planTripAction(
  _prevState: PlanTripResult | null,
  formData: FormData,
): Promise<PlanTripResult> {
  const input = parseTripFormInput(formData);
  const plan = await planTrip(input);
  if (plan.error || !plan.carpoolGating?.carpoolFirst) return plan;

  // Phase C5 carpool-first: resolve the rider's places and search compatible offers BEFORE the
  // vehicle result is shown. Everything stays server-side (Cost Guard-wrapped adapters; the
  // Google key never reaches the browser). The vehicle plan is computed regardless so the
  // normal flow is always one click away (decline / none / outage / clarification).
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  const { data: profile } = user
    ? await supabase.from("profiles").select("organization_id").eq("id", user.id).single()
    : { data: null };
  if (!profile) return plan;

  const geocoder = createGooglePlacesProvider(profile.organization_id);
  const pointsResult = await listCorporateMobilityPoints(supabase, profile.organization_id);
  const points = pointsResult.status === "ok" ? pointsResult.data : [];

  const carpoolFirst = await runCarpoolFirst(
    {
      originText: input.origin,
      destinationText: input.destination,
      departureAt: input.departureAt,
      passengerCount: input.passengerCount,
      requiresCargo: input.requiresCargo,
    },
    {
      resolve: (text) => resolveLocationText(text, { points, geocoder, places: geocoder }),
      search: (draft) => searchCompatibleCarpool(draft),
      loadOfferCards: async (matches) =>
        buildOfferCards(
          matches,
          await loadOfferCardRows(
            profile.organization_id,
            matches.map((m) => m.offerId),
          ),
        ),
    },
  );
  return { ...plan, carpoolFirst };
}

export async function planTrip(input: TripFormInput): Promise<PlanTripResult> {
  const built = await buildPlanInputs(input);
  if ("error" in built) {
    return { type: "none", reasons: [], bookingMode: "ai_recommended", error: built.error };
  }
  const { now, config, vehicleCandidates, vehicleNameByPlate, gating } = built;
  // Phase C5 gating: when the new geospatial engine owns carpool for this org the old
  // city-string matcher is NOT consulted (empty candidates => planMobility never returns a
  // carpool plan). NOTE: the chat path (chat/actions.ts, chat/dispatch.ts) also goes through
  // planTrip, so chat stops getting old-engine carpool results until Phase C6 wires voice to
  // the new engine. Orgs with carpool disabled by policy get no carpool offer and no new UI (decision L3: the
  // old matcher is no longer fed candidates for ANY org since 0063, so nothing is offered either way).
  const carpoolCandidates = built.carpoolCandidates;
  const trafficRestrictionEnabled = config.trafficRestrictionEnabled;

  const tripRequest = {
    id: "draft",
    organizationId: built.profile.organization_id,
    requesterId: built.user.id,
    departureAt: input.departureAt,
    expectedReturnAt: input.expectedReturnAt,
    origin: input.origin,
    destination: input.destination,
    distanceKm: input.distanceKm,
    passengerCount: input.passengerCount,
    requiresCargo: input.requiresCargo,
    justification: input.justification,
  };

  const plan = planMobility({
    tripRequest,
    carpoolCandidates,
    carpoolConfig: config.carpool,
    vehicleCandidates,
    now,
    readinessConfig: config.readiness,
  });

  if (plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0) {
    return {
      type: "carpool",
      reasons: plan.reasons,
      bookingMode: config.bookingMode,
      carpoolGating: gating,
      carpoolOptions: plan.carpoolOptions.map((option) => {
        const candidate = carpoolCandidates.find((c) => c.reservationId === option.reservationId);
        return {
          reservationId: option.reservationId,
          tripRequestId: candidate?.existingTrip.id ?? "",
          vehiclePlate: candidate?.vehiclePlate ?? "",
          departureAt: candidate?.existingTrip.departureAt ?? "",
          expectedReturnAt: candidate?.existingTrip.expectedReturnAt ?? "",
        };
      }),
    };
  }

  if (plan.type === "vehicle" && plan.vehicle?.recommendedVehicleId) {
    const candidate = vehicleCandidates.find(
      (c) => c.vehicle.id === plan.vehicle!.recommendedVehicleId,
    );
    const showAlternatives = config.bookingMode !== "ai_recommended";
    const alternatives = showAlternatives
      ? plan.vehicle.rankedEligible
          .filter((r) => r.vehicleId !== plan.vehicle!.recommendedVehicleId)
          .map((r) => {
            const altCandidate = vehicleCandidates.find((c) => c.vehicle.id === r.vehicleId);
            const altPlate = altCandidate?.vehicle.plate ?? "";
            return {
              vehicleId: r.vehicleId,
              plate: altPlate,
              vehicleName: vehicleNameByPlate.get(altPlate) ?? altPlate,
              categoryName: altCandidate?.category.name ?? "",
              reasons: filterTrafficRestrictionReasons(r.reasons, trafficRestrictionEnabled),
              maxOfferableSeats: maxOfferableSeats(altCandidate?.category.passengerCapacity, input.passengerCount),
            };
          })
      : [];
    const recommendedPlate = candidate?.vehicle.plate ?? "";
    return {
      type: "vehicle",
      reasons: filterTrafficRestrictionReasons(plan.reasons, trafficRestrictionEnabled),
      bookingMode: config.bookingMode,
      carpoolGating: gating,
      vehicle: {
        maxOfferableSeats: maxOfferableSeats(candidate?.category.passengerCapacity, input.passengerCount),
        vehicleId: plan.vehicle.recommendedVehicleId,
        plate: recommendedPlate,
        vehicleName: vehicleNameByPlate.get(recommendedPlate) ?? recommendedPlate,
        categoryName: candidate?.category.name ?? "",
        reasons: filterTrafficRestrictionReasons(plan.vehicle.reasons, trafficRestrictionEnabled),
        requiredPreparation: plan.vehicle.requiredPreparation,
        trafficRestriction: trafficRestrictionEnabled ? plan.trafficRestriction : undefined,
        alternatives,
      },
    };
  }

  return {
    type: "none",
    reasons: filterTrafficRestrictionReasons(plan.reasons, trafficRestrictionEnabled),
    bookingMode: config.bookingMode,
    carpoolGating: gating,
  };
}

export async function confirmTrip(
  input: TripFormInput & {
    choice: "carpool" | "vehicle";
    targetId: string;
    /** Phase C5: seats the host chose to offer (undefined / 0 => "No"). Only honoured when the
     * org policy has the new carpool engine enabled; re-validated against the chosen vehicle's
     * capacity here and again by enable_carpool_offer. */
    offerSeats?: number;
  },
): Promise<{ success: boolean; error?: string }> {
  const built = await buildPlanInputs(input);
  if ("error" in built) {
    return { success: false, error: built.error };
  }
  const { now, config, vehicleCandidates, gating } = built;
  // Same Phase C5 gating as planTrip (confirmTrip re-derives the plan server-side).
  const carpoolCandidates = built.carpoolCandidates;

  const tripRequest = {
    id: "draft",
    organizationId: built.profile.organization_id,
    requesterId: built.user.id,
    departureAt: input.departureAt,
    expectedReturnAt: input.expectedReturnAt,
    origin: input.origin,
    destination: input.destination,
    distanceKm: input.distanceKm,
    passengerCount: input.passengerCount,
    requiresCargo: input.requiresCargo,
    justification: input.justification,
  };

  const plan = planMobility({
    tripRequest,
    carpoolCandidates,
    carpoolConfig: config.carpool,
    vehicleCandidates,
    now,
    readinessConfig: config.readiness,
  });

  if (plan.type !== input.choice) {
    return { success: false, error: "plan_changed" };
  }

  const supabase = await createSupabaseServerClient();

  if (plan.type === "carpool" && plan.carpoolOptions?.some((c) => c.reservationId === input.targetId)) {
    const { error } = await supabase.rpc("create_carpool_participation", {
      p_departure_at: input.departureAt,
      p_expected_return_at: input.expectedReturnAt,
      p_origin: input.origin,
      p_destination: input.destination,
      p_distance_km: input.distanceKm,
      p_passenger_count: input.passengerCount,
      p_requires_cargo: input.requiresCargo,
      p_justification: input.justification,
      p_existing_trip_request_id: carpoolCandidates.find(
        (c) => c.reservationId === input.targetId,
      )?.existingTrip.id as string,
    });
    if (error) return { success: false, error: error.message };
    redirect("/trips");
  }

  // BR-005: in ai_recommended mode (the default), only the engine's own top pick may be
  // confirmed — same as before this booking-mode feature existed. In user_choice/hybrid,
  // any vehicle from the engine's own re-derived eligible pool is acceptable — re-derived
  // server-side from `plan`, never trusting the client's targetId on its own, so a
  // tampered request still can't book an ineligible vehicle.
  const isAcceptableVehicleTarget =
    plan.type === "vehicle" &&
    plan.vehicle &&
    (plan.vehicle.recommendedVehicleId === input.targetId ||
      (config.bookingMode !== "ai_recommended" &&
        plan.vehicle.rankedEligible.some((r) => r.vehicleId === input.targetId)));

  if (isAcceptableVehicleTarget) {
    const { data: createdReservationId, error } = await supabase.rpc("create_vehicle_reservation", {
      p_departure_at: input.departureAt,
      p_expected_return_at: input.expectedReturnAt,
      p_origin: input.origin,
      p_destination: input.destination,
      p_distance_km: input.distanceKm,
      p_passenger_count: input.passengerCount,
      p_requires_cargo: input.requiresCargo,
      p_justification: input.justification,
      p_vehicle_id: input.targetId,
      p_allow_carpool: input.allowCarpool,
    });
    if (error) {
      // 23P01 = exclusion_violation — the reservations table's EXCLUDE constraint
      // (0001_init_schema.sql) fired because another reservation now overlaps this
      // vehicle/time window (e.g. a concurrent request won the race). A stable error code
      // lets the UI show an actionable "someone else just booked this" message instead of
      // a raw Postgres constraint-violation string.
      return { success: false, error: error.code === "23P01" ? "RESERVATION_CONFLICT" : error.message };
    }

    // Mirrors create_vehicle_reservation's own in-app notification
    // (0008_notifications.sql) — email every fleet manager/administrator that a
    // reservation is waiting on their approval. Best-effort: sendEmail never throws,
    // so a delivery failure here never blocks the reservation that was already created.
    const managerEmails = await getFleetManagerEmails(supabase, built.profile.organization_id);
    if (managerEmails.length > 0) {
      const { html, text } = renderEmail({
        heading: "Nova reserva aguardando aprovação",
        bodyLines: [
          `Uma nova viagem para <strong>${input.destination}</strong> aguarda aprovação.`,
          `Origem: ${input.origin} · Saída: ${formatDateTime(input.departureAt, DEFAULT_LOCALE)}`,
        ],
        ctaLabel: "Abrir Painel",
        ctaUrl: `${getAppUrl()}/dashboard`,
      });
      await sendEmail({ to: managerEmails, subject: "Nova reserva aguardando aprovação", html, text });
    }

    // Phase C5 host offer step: publish the seats ONLY for the reservation that was just
    // created, and never let a publishing problem undo it (the reservation stands; the user is
    // sent to My Trip with a non-fatal notice and the Enable controls to retry).
    let publishFailure: string | null = null;
    const wantsOffer = typeof input.offerSeats === "number" && input.offerSeats > 0;
    if (gating.hostStep && wantsOffer && typeof createdReservationId === "string") {
      const chosen = vehicleCandidates.find((c) => c.vehicle.id === input.targetId);
      const maxSeats = maxOfferableSeats(chosen?.category.passengerCapacity, input.passengerCount);
      const seats = validOfferSeats(input.offerSeats, maxSeats);
      if (seats === null) {
        publishFailure = "CARPOOL_INVALID_SEATS";
      } else {
        const { data: createdReservation } = await supabase
          .from("reservations")
          .select("trip_request_id")
          .eq("id", createdReservationId)
          .maybeSingle();
        if (!createdReservation?.trip_request_id) {
          publishFailure = "CARPOOL_TRIP_NOT_FOUND";
        } else {
          const published = await enableCarpoolOffer(createdReservation.trip_request_id, seats, createdReservationId);
          if (published.status === "error") publishFailure = published.error;
        }
      }
    }
    if (publishFailure && typeof createdReservationId === "string") {
      redirect(`/reservations/${createdReservationId}?carpoolPublish=${encodeURIComponent(publishFailure)}`);
    }

    redirect("/trips");
  }

  return { success: false, error: "target_mismatch" };
}
