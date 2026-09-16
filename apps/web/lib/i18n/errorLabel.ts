import type { Dictionary } from "./dictionaries";

/**
 * Server Actions return either an already-localized message (most validation failures —
 * they build it from `dict.errors.*` server-side) or a bare internal code like
 * `not_authorized`, which used to render literally in the UI. Resolve the known codes
 * here and pass anything else through unchanged, so a Postgres/GoTrue message or a new
 * localized string still shows as-is instead of being swallowed.
 *
 * Mirrors the local `errorLabel` in app/settings/SettingsForm.tsx (which resolves against
 * that form's own `settings.form.errors` section); this is the shared variant used by the
 * fleet / users / reservations components.
 */
export function errorLabel(dict: Dictionary, code?: string | null): string {
  const common = dict.errors.common;
  if (!code) return common.generic;
  return (common as Record<string, string>)[code] ?? code;
}
