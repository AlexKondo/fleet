import type { Dictionary } from "./dictionaries";

/**
 * S3-10: plain-language label of an audit_log action code for /admin and /admin/audit, in the viewer's language.
 * Unknown codes (e.g. future or dynamic "incident.<kind>") never show the raw key alone: they get the
 * translated fallback with a readable form of the code.
 */
export function auditActionLabel(dict: Pick<Dictionary, "auditActions">, code: string): string {
  const label = dict.auditActions.labels[code];
  if (label) return label;
  return dict.auditActions.fallback.replace("{code}", code.replace(/[._]+/g, " ").trim());
}
