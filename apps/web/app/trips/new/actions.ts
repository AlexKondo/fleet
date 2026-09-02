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
import { toDomainCategory, toDomainVehicle } from "@/lib/domain/mappers";
import { loadOrgConfig } from "@/lib/domain/orgConfig";

export interface TripFormInput {
  departureAt: string;
  expectedReturnAt: string;
  origin: string;
  destination: string;
  distanceKm: number;
  passengerCount: number;
  requiresCargo: boolean;
  justification: string;
}

export interface PlanTripResult {
  type: "carpool" | "vehicle" | "none";
  reasons: string[];
  carpool?: {
    reservationId: string;
    vehiclePlate: string;
    departureAt: string;
    expectedReturnAt: string;
  };
  vehicle?: {
    vehicleId: string;
    plate: string;
    categoryName: string;
    reasons: string[];
    requiredPreparation?: PreparationAction[];
    /** §15 — set only when the recommended vehicle is affected by a circulation restriction. */
    trafficRestriction?: TrafficRestrictionResult;
  };
  error?: string;
}

interface CarpoolCandidateWithPlate extends CarpoolCandidate {
  vehiclePlate: string;
}

async function buildPlanInputs(input: TripFormInput) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const { data: vehicleRows } = await supabase
    .from("vehicles")
    .select("*, category:vehicle_categories(*)")
    .in("status", ["available", "charging", "cleaning"]);

  const vehicleCandidates: CandidateVehicle[] = (vehicleRows ?? [])
    .filter((row) => row.category)
    .map((row) => ({
      vehicle: toDomainVehicle(row),
      category: toDomainCategory(row.category!),
    }));

  const { data: activeReservations } = await supabase
    .from("reservations")
    .select(
      `id, vehicle_id, end_at,
       trip_request:trip_requests(id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, requester_id, organization_id),
       vehicle:vehicles(plate, category:vehicle_categories(passenger_capacity, supports_cargo))`,
    )
    .in("status", ["pending_approval", "confirmed"])
    .gt("end_at", now);

  const tripRequestIds = (activeReservations ?? [])
    .map((r) => r.trip_request?.id)
    .filter((id): id is string => Boolean(id));

  const { data: participantRows } =
    tripRequestIds.length > 0
      ? await supabase
          .from("trip_participants")
          .select("trip_request_id, passenger_count")
          .in("trip_request_id", tripRequestIds)
      : { data: [] };

  const occupancyByTrip = new Map<string, number>();
  for (const p of participantRows ?? []) {
    occupancyByTrip.set(p.trip_request_id, (occupancyByTrip.get(p.trip_request_id) ?? 0) + p.passenger_count);
  }

  const carpoolCandidates: CarpoolCandidateWithPlate[] = (activeReservations ?? [])
    .filter((r) => r.trip_request && r.vehicle?.category)
    .map((r) => ({
      reservationId: r.id,
      vehicleId: r.vehicle_id,
      existingTrip: {
        id: r.trip_request!.id,
        organizationId: r.trip_request!.organization_id,
        requesterId: r.trip_request!.requester_id,
        departureAt: r.trip_request!.departure_at,
        expectedReturnAt: r.trip_request!.expected_return_at,
        origin: r.trip_request!.origin,
        destination: r.trip_request!.destination,
        distanceKm: Number(r.trip_request!.distance_km),
        passengerCount: r.trip_request!.passenger_count,
        requiresCargo: r.trip_request!.requires_cargo,
        justification: r.trip_request!.justification,
      },
      vehicleCapacity: r.vehicle!.category!.passenger_capacity,
      vehicleSupportsCargo: r.vehicle!.category!.supports_cargo,
      currentOccupancy:
        r.trip_request!.passenger_count + (occupancyByTrip.get(r.trip_request!.id) ?? 0),
      vehiclePlate: r.vehicle!.plate,
    }));

  return { user, profile, now, config, vehicleCandidates, carpoolCandidates };
}

export async function planTrip(input: TripFormInput): Promise<PlanTripResult> {
  const built = await buildPlanInputs(input);
  if ("error" in built) {
    return { type: "none", reasons: [], error: built.error };
  }
  const { now, config, vehicleCandidates, carpoolCandidates } = built;

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

  if (plan.type === "carpool" && plan.carpool) {
    const candidate = carpoolCandidates.find((c) => c.reservationId === plan.carpool!.reservationId);
    return {
      type: "carpool",
      reasons: plan.reasons,
      carpool: {
        reservationId: plan.carpool.reservationId,
        vehiclePlate: candidate?.vehiclePlate ?? "",
        departureAt: candidate?.existingTrip.departureAt ?? "",
        expectedReturnAt: candidate?.existingTrip.expectedReturnAt ?? "",
      },
    };
  }

  if (plan.type === "vehicle" && plan.vehicle?.recommendedVehicleId) {
    const candidate = vehicleCandidates.find(
      (c) => c.vehicle.id === plan.vehicle!.recommendedVehicleId,
    );
    return {
      type: "vehicle",
      reasons: plan.reasons,
      vehicle: {
        vehicleId: plan.vehicle.recommendedVehicleId,
        plate: candidate?.vehicle.plate ?? "",
        categoryName: candidate?.category.name ?? "",
        reasons: plan.vehicle.reasons,
        requiredPreparation: plan.vehicle.requiredPreparation,
        trafficRestriction: plan.trafficRestriction,
      },
    };
  }

  return { type: "none", reasons: plan.reasons };
}

export async function confirmTrip(
  input: TripFormInput & { choice: "carpool" | "vehicle"; targetId: string },
): Promise<{ success: boolean; error?: string }> {
  const built = await buildPlanInputs(input);
  if ("error" in built) {
    return { success: false, error: built.error };
  }
  const { now, config, vehicleCandidates, carpoolCandidates } = built;

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

  if (plan.type === "carpool" && plan.carpool?.reservationId === input.targetId) {
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

  if (plan.type === "vehicle" && plan.vehicle?.recommendedVehicleId === input.targetId) {
    const { error } = await supabase.rpc("create_vehicle_reservation", {
      p_departure_at: input.departureAt,
      p_expected_return_at: input.expectedReturnAt,
      p_origin: input.origin,
      p_destination: input.destination,
      p_distance_km: input.distanceKm,
      p_passenger_count: input.passengerCount,
      p_requires_cargo: input.requiresCargo,
      p_justification: input.justification,
      p_vehicle_id: input.targetId,
    });
    if (error) return { success: false, error: error.message };
    redirect("/trips");
  }

  return { success: false, error: "target_mismatch" };
}
