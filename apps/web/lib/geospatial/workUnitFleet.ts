import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOriginLocation } from "@/lib/trips/originLocation";

/**
 * True only when the person's work unit is a registered vehicle location AND no vehicle (not archived) is registered there.
 * Best effort: anything unclear (no match, read failure) is `false`, so the normal flow carries on.
 */
export async function workUnitHasNoVehicles(supabase: SupabaseClient<any>, unitName: string): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data: locations } = await supabase.from("vehicle_locations").select("id, name");
    const resolution = resolveOriginLocation((locations ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })), { originText: unitName });
    if (resolution.kind !== "location") return false;
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
