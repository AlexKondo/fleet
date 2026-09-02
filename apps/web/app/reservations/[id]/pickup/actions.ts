"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

export async function submitPickup(
  input: PickupFormInput,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "not_authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Supabase's generated RPC arg types don't mark these as nullable even though the
  // Postgres function parameters happily accept NULL (no NOT NULL constraint on args) —
  // the casts below are for the generated types only, not a runtime concern.
  const { error } = await supabase.rpc("record_pickup", {
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

  if (error) return { success: false, error: error.message };
  redirect("/trips");
}
