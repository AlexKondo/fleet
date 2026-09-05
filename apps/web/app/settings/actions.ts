"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SettingsActionState {
  status: "idle" | "success" | "error";
  error?: string;
}

/**
 * Saves organization_settings (fleet-car-saas.txt §8 Range Safety Buffer "configurável",
 * §12 Predictive Maintenance, §15 São Paulo Traffic Restriction Intelligence). Uses the
 * regular authenticated server client — no admin/service-role client needed, since the
 * existing "fleet managers manage organization settings" RLS policy
 * (supabase/migrations/0001_init_schema.sql) already permits UPDATE for
 * fleet_manager/administrator on their own organization's row.
 */
export async function saveOrganizationSettings(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", error: "not_authenticated" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "fleet_manager" && profile.role !== "administrator")) {
    return { status: "error", error: "not_authorized" };
  }

  const rangeSafetyBufferPercent = Number(formData.get("rangeSafetyBufferPercent"));
  const minChargeHoursBev = Number(formData.get("minChargeHoursBev"));
  const minRefuelHoursIceOrPhev = Number(formData.get("minRefuelHoursIceOrPhev"));
  const minCleaningHours = Number(formData.get("minCleaningHours"));
  const carpoolDepartureToleranceMinutes = Number(formData.get("carpoolDepartureToleranceMinutes"));
  const carpoolReturnToleranceMinutes = Number(formData.get("carpoolReturnToleranceMinutes"));
  const maintenanceDueSoonDays = Number(formData.get("maintenanceDueSoonDays"));
  const trafficRestrictionEnabled = formData.get("trafficRestrictionEnabled") === "on";
  const earlyPickupGraceMinutes = Number(formData.get("earlyPickupGraceMinutes"));
  const bookingMode = String(formData.get("bookingMode") ?? "");
  const BOOKING_MODES = ["ai_recommended", "user_choice", "hybrid"] as const;
  if (!BOOKING_MODES.includes(bookingMode as (typeof BOOKING_MODES)[number])) {
    return { status: "error", error: "invalid_values" };
  }

  // Bounded, not just non-negative: the client's <input max> is a UI hint only, not
  // enforcement. rangeSafetyBufferPercent in particular must stay within [0, 100] —
  // assessTripReadiness computes `estimatedRangeKm * (1 - bufferPercent / 100)`, so a
  // value above 100 goes negative and every vehicle in the organization would fail
  // Trip-Specific Readiness permanently until someone fixed the row by hand.
  const boundedFields: [number, number, number][] = [
    [rangeSafetyBufferPercent, 0, 100],
    [minChargeHoursBev, 0, 48],
    [minRefuelHoursIceOrPhev, 0, 48],
    [minCleaningHours, 0, 48],
    [carpoolDepartureToleranceMinutes, 0, 1440],
    [carpoolReturnToleranceMinutes, 0, 1440],
    [maintenanceDueSoonDays, 0, 365],
    [earlyPickupGraceMinutes, 0, 1440],
  ];
  const allValid = boundedFields.every(
    ([value, min, max]) => !Number.isNaN(value) && value >= min && value <= max,
  );
  if (!allValid) {
    return { status: "error", error: "invalid_values" };
  }

  const { error } = await supabase
    .from("organization_settings")
    .update({
      range_safety_buffer_percent: rangeSafetyBufferPercent,
      min_charge_hours_bev: minChargeHoursBev,
      min_refuel_hours_ice_or_phev: minRefuelHoursIceOrPhev,
      min_cleaning_hours: minCleaningHours,
      carpool_departure_tolerance_minutes: carpoolDepartureToleranceMinutes,
      carpool_return_tolerance_minutes: carpoolReturnToleranceMinutes,
      maintenance_due_soon_days: maintenanceDueSoonDays,
      traffic_restriction_enabled: trafficRestrictionEnabled,
      booking_mode: bookingMode as "ai_recommended" | "user_choice" | "hybrid",
      early_pickup_grace_minutes: earlyPickupGraceMinutes,
    })
    .eq("organization_id", profile.organization_id);

  if (error) {
    return { status: "error", error: error.message };
  }

  // AUDIT_TRAIL.md lists "configuration change" as a mandatory audited action. The
  // regular (non-admin) client is enough here — log_audit_event is granted to
  // `authenticated` and auth.uid()/organization_id are already available in this session.
  await supabase.rpc("log_audit_event", {
    p_organization_id: profile.organization_id,
    p_actor_id: user.id,
    p_action: "organization_settings_updated",
    p_entity_type: "organization_settings",
    p_entity_id: profile.organization_id,
    p_after: {
      range_safety_buffer_percent: rangeSafetyBufferPercent,
      min_charge_hours_bev: minChargeHoursBev,
      min_refuel_hours_ice_or_phev: minRefuelHoursIceOrPhev,
      min_cleaning_hours: minCleaningHours,
      carpool_departure_tolerance_minutes: carpoolDepartureToleranceMinutes,
      carpool_return_tolerance_minutes: carpoolReturnToleranceMinutes,
      maintenance_due_soon_days: maintenanceDueSoonDays,
      traffic_restriction_enabled: trafficRestrictionEnabled,
      booking_mode: bookingMode,
      early_pickup_grace_minutes: earlyPickupGraceMinutes,
    },
  });

  revalidatePath("/settings");
  return { status: "success" };
}
