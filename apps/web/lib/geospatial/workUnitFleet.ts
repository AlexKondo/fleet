import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOriginLocation } from "@/lib/trips/originLocation";

/**
 * True when no vehicle (not archived) is registered at the person's work unit: either the unit matches a vehicle location with no vehicle in it,
 * or it matches no vehicle location at all (vehicles are only offered at a registered location that matches the origin, so there is none there).
 * Best effort: an org without vehicle locations, an empty name or a read failure is `false`, so the normal flow carries on.
 */
export async function workUnitHasNoVehicles(supabase: SupabaseClient<any>, unitName: string): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data: locations } = await supabase.from("vehicle_locations").select("id, name");
    const resolution = resolveOriginLocation((locations ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })), { originText: unitName });
    if (resolution.kind === "no_locations") return false;
    if (resolution.kind === "unknown") return unitName.trim().length >= 3;
    const { count, error } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .eq("current_location_id", resolution.location.id);
    if (error || count === null) return false;
    return count === 0;
  } catch {
    return false;
  }
}

/** A message that is about getting a vehicle / going somewhere (used to warn before the assistant starts asking questions). */
export const RESERVATION_WORDS = /reserv|ve[ií]culo|carro|viagem|viajar|preciso ir|quero ir|vou para|vehicle|car\b|trip|coche|viaje|车|行程/i;
