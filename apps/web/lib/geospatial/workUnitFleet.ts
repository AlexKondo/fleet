import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMobilityPoint, resolveOriginLocation } from "@/lib/trips/originLocation";

/**
 * True when no vehicle (not archived) is registered at the person's work unit.
 * A unit is a corporate mobility point; its vehicles are the ones parked in its sub-locations (vehicle_locations.mobility_point_id).
 * A unit with no sub-location, or that matches no vehicle location at all, has no vehicle (vehicles are only offered at a registered location).
 * Best effort: an org without vehicle locations, an empty name or a read failure is `false`, so the normal flow carries on.
 */
export async function workUnitHasNoVehicles(supabase: SupabaseClient<any>, unitName: string): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const [{ data: locations }, { data: pointRows }] = await Promise.all([
      supabase.from("vehicle_locations").select("id, name, mobility_point_id").eq("enabled", true),
      supabase.from("corporate_mobility_points").select("id, name, aliases, address_label").eq("is_active", true),
    ]);
    type Loc = { id: string; name: string; mobility_point_id?: string | null };
    const locs = (locations ?? []) as Loc[];
    const points = ((pointRows ?? []) as { id: string; name: string; aliases?: string[]; address_label?: string }[]).map((p) => ({
      id: p.id, name: p.name, aliases: p.aliases ?? [], addressLabel: p.address_label,
    }));
    let ids: string[] = [];
    const point = resolveMobilityPoint(points, unitName);
    if (point) ids = locs.filter((l) => l.mobility_point_id === point.id).map((l) => l.id);
    if (ids.length === 0) {
      const resolution = resolveOriginLocation(locs.map((l) => ({ id: l.id, name: l.name })), { originText: unitName });
      if (resolution.kind === "no_locations") return false;
      if (resolution.kind === "unknown") return unitName.trim().length >= 3;
      ids = [resolution.location.id];
    }
    const { count, error } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .in("current_location_id", ids);
    if (error || count === null) return false;
    return count === 0;
  } catch {
    return false;
  }
}

/** A message that is about getting a vehicle / going somewhere (used to warn before the assistant starts asking questions). */
export const RESERVATION_WORDS = /reserv|ve[ií]culo|carro|viagem|viajar|preciso ir|quero ir|vou para|vehicle|car\b|trip|coche|viaje|车|行程/i;
