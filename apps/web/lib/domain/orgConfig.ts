import type { CarpoolMatchConfig, ReadinessConfig } from "@fleet/domain";
import type { TypedSupabaseClient } from "@fleet/supabase-client";

export async function loadOrgConfig(
  supabase: TypedSupabaseClient,
  organizationId: string,
): Promise<{ readiness: ReadinessConfig; carpool: CarpoolMatchConfig }> {
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
  };
}
