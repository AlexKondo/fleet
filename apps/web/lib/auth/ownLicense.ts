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
/** Parses the middleware-provided LICENSE_MISSING_HEADER; null = not provided (caller must read the license itself). */
export function licenseMissingFromHeader(value: string | null | undefined): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

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

/** Brasília calendar date, exact ISO date and explicit authorization; failed reads fail closed for driving. */
export function canDrive(license: OwnLicense | null, now = new Date()): boolean {
 if (!license?.driverAuthorized || !license.number?.trim() || !license.expiration) return false;
 const expiry = license.expiration;
 if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false;
 const parsed = new Date(`${expiry}T12:00:00Z`);
 if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== expiry) return false;
 const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part = (name:string) => parts.find(p=>p.type===name)?.value;
 return expiry >= `${part('year')}-${part('month')}-${part('day')}`;
}
