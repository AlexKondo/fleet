/**
 * Phase C5 — the org carpool policy loader, extracted verbatim from app/carpool/actions.ts
 * (a "use server" file may only export async server actions, and the New Trip / My Trip /
 * settings code needs the same loader). Fails closed: the permissive default is used ONLY when
 * the query succeeded and the org genuinely has no policy row; a query error never yields a
 * (carpoolEnabled: true) default.
 */

import type { CarpoolPolicyConfig } from "@fleet/domain";
import { defaultCarpoolPolicyConfig } from "@fleet/domain";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type PolicyLoad = { ok: true; policy: CarpoolPolicyConfig; policyVersion: number | null } | { ok: false };

export const POLICY_COLUMNS =
  "policy_version, carpool_enabled, carpool_first_enabled, host_opt_in_required, host_approval_required, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, max_candidates_for_precise_routing, request_expiry_minutes, allow_intermediate_pickup, allow_intermediate_dropoff, minimum_seat_availability";

export interface PolicyRow {
  policy_version: number;
  carpool_enabled: boolean;
  carpool_first_enabled: boolean;
  host_opt_in_required: boolean;
  host_approval_required: boolean;
  departure_window_minutes: number;
  return_window_minutes: number;
  max_additional_distance_km: number | string;
  max_additional_time_minutes: number | string;
  max_candidates_for_precise_routing: number;
  request_expiry_minutes: number;
  allow_intermediate_pickup: boolean;
  allow_intermediate_dropoff: boolean;
  minimum_seat_availability: number;
}

export function policyFromRow(data: PolicyRow): CarpoolPolicyConfig {
  return {
    carpoolEnabled: data.carpool_enabled,
    carpoolFirstEnabled: data.carpool_first_enabled,
    hostOptInRequired: data.host_opt_in_required,
    hostApprovalRequired: data.host_approval_required,
    departureWindowMinutes: data.departure_window_minutes,
    returnWindowMinutes: data.return_window_minutes,
    maxAdditionalDistanceKm: Number(data.max_additional_distance_km),
    maxAdditionalTimeMinutes: Number(data.max_additional_time_minutes),
    maxCandidatesForPreciseRouting: data.max_candidates_for_precise_routing,
    requestExpiryMinutes: data.request_expiry_minutes,
    allowIntermediatePickup: data.allow_intermediate_pickup,
    allowIntermediateDropoff: data.allow_intermediate_dropoff,
    minimumSeatAvailability: data.minimum_seat_availability,
  };
}

export async function loadLatestPolicy(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
): Promise<PolicyLoad> {
  const { data, error } = await supabase
    .from("carpool_policy_settings")
    .select(POLICY_COLUMNS)
    .eq("organization_id", organizationId)
    .order("policy_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false };
  }
  if (!data) {
    return { ok: true, policy: defaultCarpoolPolicyConfig, policyVersion: null };
  }
  return { ok: true, policy: policyFromRow(data as unknown as PolicyRow), policyVersion: data.policy_version };
}
