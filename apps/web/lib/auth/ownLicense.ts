import type { TypedSupabaseClient } from "@fleet/supabase-client";

export interface OwnLicense {
  number: string | null;
  category: string | null;
  expiration: string | null;
  driverAuthorized: boolean;
}

/**
 * The signed-in user's OWN license data. Since migration 0063 the license columns of `profiles`
 * (number / category / expiration / driver_authorized / reminder timestamps) are not SELECT-able by
 * the `authenticated` role at all (a coworker could read them otherwise); the only way for a user to
 * read them is this definer function, which answers strictly for auth.uid(). Returns null when the
 * call failed (so callers can distinguish "no license on file" from "could not read").
 */
export async function getOwnLicense(supabase: TypedSupabaseClient): Promise<OwnLicense | null> {
  const { data, error } = await supabase.rpc("get_my_license");
  if (error || !data) return null;
  const row = data[0];
  return {
    number: row?.drivers_license_number ?? null,
    category: row?.drivers_license_category ?? null,
    expiration: row?.drivers_license_expiration ?? null,
    driverAuthorized: row?.driver_authorized ?? false,
  };
}
