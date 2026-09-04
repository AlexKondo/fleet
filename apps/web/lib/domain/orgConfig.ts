import type { CarpoolMatchConfig, ReadinessConfig } from "@fleet/domain";
import type { Database, TypedSupabaseClient } from "@fleet/supabase-client";

export type BookingMode = Database["public"]["Enums"]["booking_mode"];

export interface OrgConfig {
  readiness: ReadinessConfig;
  carpool: CarpoolMatchConfig;
  /** §12 Predictive Maintenance — window (days) before the estimated service date at which
   * a vehicle is flagged "due soon". Organization-configurable via /settings; falls back to
   * the same default as `defaultMaintenancePredictionConfig` in @fleet/domain. */
  maintenanceDueSoonDays: number;
  /** §15 São Paulo Traffic Restriction Intelligence — whether the trip-planning flow should
   * surface a circulation-restriction warning at all. Organization-configurable via
   * /settings. */
  trafficRestrictionEnabled: boolean;
  /** BR-005/PB-003/ADR-006 — how the trip-planning flow presents vehicle choice:
   * 'ai_recommended' auto-picks one vehicle (default, matches all prior behavior),
   * 'user_choice'/'hybrid' also surface every other eligible vehicle so the requester can
   * pick a different one. Organization-configurable via /settings. */
  bookingMode: BookingMode;
}

export async function loadOrgConfig(
  supabase: TypedSupabaseClient,
  organizationId: string,
): Promise<OrgConfig> {
  const { data } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .single();

  return {
    readiness: {
      rangeSafetyBufferPercent: data?.range_safety_buffer_percent ?? 20,
      minChargeHoursBEV: data?.min_charge_hours_bev ?? 6,
      minRefuelHoursICEorPHEV: data?.min_refuel_hours_ice_or_phev ?? 1,
      minCleaningHours: data?.min_cleaning_hours ?? 1,
    },
    carpool: {
      departureToleranceMinutes: data?.carpool_departure_tolerance_minutes ?? 30,
      returnToleranceMinutes: data?.carpool_return_tolerance_minutes ?? 30,
    },
    maintenanceDueSoonDays: data?.maintenance_due_soon_days ?? 14,
    trafficRestrictionEnabled: data?.traffic_restriction_enabled ?? true,
    bookingMode: data?.booking_mode ?? "ai_recommended",
  };
}
