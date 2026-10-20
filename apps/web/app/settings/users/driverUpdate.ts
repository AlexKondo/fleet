/**
 * M3 (C7a audit): builds the profiles UPDATE for the two admin forms of the team screen WITHOUT ever
 * defaulting a missing field to blank. Before, both forms posted ALL four fields (the ones they did not
 * edit as hidden inputs prefilled from page data); when list_member_licenses() failed the page data was
 * silently empty, so toggling "driver authorized" posted blank license fields and WIPED the member's CNH.
 *
 * Now each form says what it edits (`intent`) and carries ONLY those fields; a field that is not in the
 * submission is never written. Not a "use server" module on purpose (its exports must not be client-callable
 * actions).
 */
export type LicenseExpirationSource = "ai" | "manual";

/**
 * profiles.drivers_license_expiration_source (migration 0074): how the stored expiration date got there.
 *  - the driver confirmed what the vision model read  -> "ai"            (account/license/actions.ts, confirm phase)
 *  - an administrator saved a DIFFERENT date           -> "manual"
 *  - the date is unchanged (e.g. only the number/category were edited, or a blur without changes) -> undefined (the stored source is NOT touched)
 *  - the date was cleared                              -> null (not recorded)
 * We never guess or backfill: only these transitions write the column.
 */
export function decideExpirationSource(currentExpiration: string | null | undefined, nextExpiration: string | null): LicenseExpirationSource | null | undefined {
  const cur = currentExpiration ? currentExpiration : null;
  const next = nextExpiration ? nextExpiration : null;
  if (cur === next) return undefined;
  if (next === null) return null;
  return "manual";
}

/** Postgres error raised by the 0075 trigger for an edit of an AI-locked CNH. */
export function isLicenseLockedError(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error) && (error!.code === "42501" || /license_locked_by_ai/.test(error!.message ?? ""));
}

export type DriverUpdateIntent = "authorization" | "license";

export interface DriverProfileUpdate {
  driver_authorized?: boolean;
  drivers_license_number?: string | null;
  drivers_license_category?: string | null;
  drivers_license_expiration?: string | null;
  drivers_license_expiration_source?: LicenseExpirationSource | null;
}

export type DriverUpdateResult =
  | { ok: true; update: DriverProfileUpdate }
  | { ok: false; reason: "invalid_intent" | "license_fields_missing" };

export function buildDriverUpdate(formData: FormData): DriverUpdateResult {
  const intent = formData.get("intent");
  if (intent === "authorization") {
    // An unchecked checkbox is simply absent from FormData, so the form always carries an explicit marker.
    if (formData.get("authorizationSubmitted") !== "1") return { ok: false, reason: "invalid_intent" };
    return { ok: true, update: { driver_authorized: formData.get("driverAuthorized") === "on" } };
  }
  if (intent === "license") {
    // All three inputs of the license form must be present (they may be empty on purpose: an administrator
    // clearing a CNH); a submission that does not carry them (e.g. a form rendered without loaded data)
    // is refused instead of being treated as "clear everything".
    if (!formData.has("licenseNumber") || !formData.has("licenseCategory") || !formData.has("licenseExpiration")) {
      return { ok: false, reason: "license_fields_missing" };
    }
    const number = String(formData.get("licenseNumber") ?? "").trim();
    const category = String(formData.get("licenseCategory") ?? "").trim();
    const expiration = String(formData.get("licenseExpiration") ?? "").trim();
    return {
      ok: true,
      update: {
        drivers_license_number: number || null,
        drivers_license_category: category || null,
        drivers_license_expiration: expiration || null,
      },
    };
  }
  return { ok: false, reason: "invalid_intent" };
}
