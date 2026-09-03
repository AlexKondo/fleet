"use server";

import { deriveReturnOutcome, MAINTENANCE_DUE_SOON_KM, type EnergyType } from "@fleet/domain";
import type { PhotoAngle } from "@/lib/domain/checklist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uploadInspectionPhotos } from "@/lib/domain/uploadInspectionPhotos";

export interface ReturnFormInput {
  reservationId: string;
  odometerKm: number;
  fuelLevelPercent: number | null;
  batteryLevelPercent: number | null;
  hasNewDamage: boolean;
  damageNotes: string | null;
  /** §14 Current Vehicle Location — where the traveler parked it, required on every return. */
  currentLocationId: string;
  missingSafetyEquipment: string[];
  isDirtyExterior: boolean;
  isDirtyInterior: boolean;
}

export interface SubmitReturnResult {
  success: boolean;
  error?: string;
  /** Angles whose photo the user provided but which failed to upload/save. */
  failedPhotoAngles?: PhotoAngle[];
}

export async function submitReturn(
  input: ReturnFormInput,
  photos: FormData,
): Promise<SubmitReturnResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "not_authenticated" };

  const [{ data: profile }, { data: reservation }] = await Promise.all([
    supabase.from("profiles").select("role, organization_id").eq("id", user.id).single(),
    supabase
      .from("reservations")
      .select("vehicle:vehicles(energy_type, next_service_odometer_km)")
      .eq("id", input.reservationId)
      .single(),
  ]);

  if (!reservation?.vehicle) return { success: false, error: "reservation_not_found" };

  const energyType = reservation.vehicle.energy_type as EnergyType;
  const nextService = reservation.vehicle.next_service_odometer_km;
  const maintenanceDueSoon =
    nextService !== null && nextService - input.odometerKm <= MAINTENANCE_DUE_SOON_KM;

  const outcome = deriveReturnOutcome({
    hasNewDamage: input.hasNewDamage,
    missingSafetyEquipment: input.missingSafetyEquipment,
    isDirtyExterior: input.isDirtyExterior,
    isDirtyInterior: input.isDirtyInterior,
    energyType,
    fuelLevelPercent: input.fuelLevelPercent,
    batteryLevelPercent: input.batteryLevelPercent,
    maintenanceDueSoon,
  });

  // See the equivalent comment in reservations/[id]/pickup/actions.ts: the generated RPC
  // arg types omit `| null` even though these Postgres parameters accept NULL.
  const { data: inspectionId, error } = await supabase.rpc("record_return", {
    p_reservation_id: input.reservationId,
    p_odometer_km: input.odometerKm,
    p_fuel_level_percent: input.fuelLevelPercent as number,
    p_battery_level_percent: input.batteryLevelPercent as number,
    p_has_new_damage: input.hasNewDamage,
    p_damage_notes: input.damageNotes as string,
    p_missing_safety_equipment: input.missingSafetyEquipment,
    p_is_dirty_exterior: input.isDirtyExterior,
    p_is_dirty_interior: input.isDirtyInterior,
    p_role: profile?.role === "security" ? "security" : "traveler",
    p_vehicle_event: outcome.vehicleEvent,
    p_workflow_tasks: outcome.workflowTasks,
    p_current_location_id: input.currentLocationId,
  });

  if (error) return { success: false, error: error.message };
  if (!inspectionId) return { success: false, error: "inspection_not_created" };

  // The checklist itself is already recorded at this point — everything below is best
  // effort evidence. We deliberately don't redirect from here (unlike the rest of this
  // app's actions) so the caller can inspect failedPhotoAngles and show them to the user
  // before navigating away; the client component performs the redirect once it has.
  if (!profile?.organization_id) return { success: true };

  const failedPhotoAngles = await uploadInspectionPhotos(
    supabase,
    profile.organization_id,
    inspectionId,
    photos,
  );

  return {
    success: true,
    failedPhotoAngles: failedPhotoAngles.length > 0 ? failedPhotoAngles : undefined,
  };
}
