"use server";

import type { PhotoAngle } from "@/lib/domain/checklist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { uploadInspectionPhotos } from "@/lib/domain/uploadInspectionPhotos";
import { getDictionary } from "@/lib/i18n/getLocale";

export interface PickupFormInput {
  reservationId: string;
  odometerKm: number;
  fuelLevelPercent: number | null;
  batteryLevelPercent: number | null;
  hasDamage: boolean;
  damageNotes: string | null;
  missingSafetyEquipment: string[];
  isDirtyExterior: boolean;
  isDirtyInterior: boolean;
}

export interface SubmitPickupResult {
  success: boolean;
  error?: string;
  /** Angles whose photo the user provided but which failed to upload/save. */
  failedPhotoAngles?: PhotoAngle[];
  /**
   * BR-013/ADR-004 — external damage requires photo evidence, unlike every other angle
   * which is best-effort. True when hasDamage was reported but no "damage" angle photo
   * made it into storage (missing or failed upload). Unlike failedPhotoAngles, the caller
   * must not treat this as skippable — the checklist itself is already recorded (see
   * comment below), but the UI must keep the user on this screen until it's resolved.
   */
  damageEvidenceMissing?: boolean;
}

/**
 * Uploads whichever standardized angles the user actually captured (fleet-car-saas.txt
 * §10) to the private `vehicle-photos` bucket and records each one in
 * `inspection_photos`. Photos are optional at submit time — a spotty connection during a
 * pickup/return shouldn't block the checklist itself — so this never throws; it reports
 * which angles (if any) failed back to the caller instead.
 */
export async function submitPickup(
  input: PickupFormInput,
  photos: FormData,
): Promise<SubmitPickupResult> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { success: false, error: "not_authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  // Supabase's generated RPC arg types don't mark these as nullable even though the
  // Postgres function parameters happily accept NULL (no NOT NULL constraint on args) —
  // the casts below are for the generated types only, not a runtime concern.
  const { data: inspectionId, error } = await supabase.rpc("record_pickup", {
    p_reservation_id: input.reservationId,
    p_odometer_km: input.odometerKm,
    p_fuel_level_percent: input.fuelLevelPercent as number,
    p_battery_level_percent: input.batteryLevelPercent as number,
    p_has_damage: input.hasDamage,
    p_damage_notes: input.damageNotes as string,
    p_missing_safety_equipment: input.missingSafetyEquipment,
    p_is_dirty_exterior: input.isDirtyExterior,
    p_is_dirty_interior: input.isDirtyInterior,
    p_role: profile?.role === "security" ? "security" : "traveler",
  });

  if (error) {
    const dict = await getDictionary();
    const message = error.message.includes("DRIVER_NOT_AUTHORIZED")
      ? dict.errors.reservations.driverNotAuthorized
      : error.message.includes("LICENSE_EXPIRED")
        ? dict.errors.reservations.licenseExpired
        : error.message.includes("EARLY_PICKUP_NOT_ALLOWED")
          ? dict.errors.reservations.earlyPickupNotAllowed
          : error.message;
    return { success: false, error: message };
  }
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

  const damagePhotoFile = photos.get("photo_damage");
  const damageEvidenceMissing =
    input.hasDamage &&
    (!(damagePhotoFile instanceof File) ||
      damagePhotoFile.size === 0 ||
      failedPhotoAngles.includes("damage"));

  return {
    success: true,
    failedPhotoAngles: failedPhotoAngles.length > 0 ? failedPhotoAngles : undefined,
    damageEvidenceMissing: damageEvidenceMissing || undefined,
  };
}
