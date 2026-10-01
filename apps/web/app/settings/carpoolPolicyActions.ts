"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { parseCarpoolPolicyForm } from "@/lib/carpool/policyInput";

export interface CarpoolPolicyActionState {
  status: "idle" | "success" | "error";
  error?: "invalid_values" | "not_authorized" | "version_conflict" | "save_failed";
  invalidFields?: string[];
  version?: number;
}

/**
 * Phase C5 (pack rule 11 "all thresholds administrator-configurable"): publishes a NEW policy
 * version. carpool_policy_settings is insert-only (UPDATE/DELETE revoked, 0060), so every save
 * is an INSERT with policy_version = latest + 1 under the manager's own RLS INSERT policy.
 * Role and organization are re-derived from the session here (and enforced again by RLS); the
 * browser's ids/limits are never trusted. A concurrent publish collides on
 * unique(organization_id, policy_version) and is reported as a conflict, not silently merged.
 */
export async function publishCarpoolPolicy(
  _prev: CarpoolPolicyActionState,
  formData: FormData,
): Promise<CarpoolPolicyActionState> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { status: "error", error: "not_authorized" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();
  if (!profile || (profile.role !== "fleet_manager" && profile.role !== "administrator")) {
    return { status: "error", error: "not_authorized" };
  }

  const parsed = parseCarpoolPolicyForm(formData);
  if (!parsed.ok) return { status: "error", error: "invalid_values", invalidFields: parsed.invalidFields };
  const v = parsed.values;

  const { data: latest, error: latestError } = await supabase
    .from("carpool_policy_settings")
    .select("policy_version")
    .eq("organization_id", profile.organization_id)
    .order("policy_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { status: "error", error: "save_failed" };
  const nextVersion = (latest?.policy_version ?? 0) + 1;

  const { error } = await supabase.from("carpool_policy_settings").insert({
    organization_id: profile.organization_id,
    policy_version: nextVersion,
    carpool_enabled: v.carpoolEnabled,
    carpool_first_enabled: v.carpoolFirstEnabled,
    host_opt_in_required: v.hostOptInRequired,
    host_approval_required: v.hostApprovalRequired,
    departure_window_minutes: v.departureWindowMinutes,
    return_window_minutes: v.returnWindowMinutes,
    max_additional_distance_km: v.maxAdditionalDistanceKm,
    max_additional_time_minutes: v.maxAdditionalTimeMinutes,
    max_candidates_for_precise_routing: v.maxCandidatesForPreciseRouting,
    request_expiry_minutes: v.requestExpiryMinutes,
    allow_intermediate_pickup: v.allowIntermediatePickup,
    allow_intermediate_dropoff: v.allowIntermediateDropoff,
    minimum_seat_availability: v.minimumSeatAvailability,
  });
  if (error) {
    console.error("publishCarpoolPolicy failed:", error.message);
    return { status: "error", error: error.code === "23505" ? "version_conflict" : "save_failed" };
  }

  revalidatePath("/settings");
  revalidatePath("/trips/new");
  return { status: "success", version: nextVersion };
}
