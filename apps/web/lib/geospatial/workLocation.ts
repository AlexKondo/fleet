import type { SupabaseClient } from "@supabase/supabase-js";

/** The corporate mobility point where a person works ("Seu local de trabalho", profiles.work_location_id): the default origin of their trips. */
export interface WorkLocation {
  id: string;
  name: string;
  addressLabel: string;
}

/** Best effort: no work location (not set, point deactivated, read failure) is simply `null` and the person is asked where they leave from. */
export async function loadWorkLocation(supabase: SupabaseClient<any>, userId: string): Promise<WorkLocation | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data: profile } = await supabase.from("profiles").select("work_location_id").eq("id", userId).maybeSingle();
    const id = profile?.work_location_id;
    if (!id) return null;
    const { data: point } = await supabase.from("corporate_mobility_points").select("id, name, address_label, is_active").eq("id", id).maybeSingle();
    if (!point || point.is_active === false) return null;
    return { id: point.id, name: point.name, addressLabel: point.address_label };
  } catch {
    return null;
  }
}
