/**
 * Phase C5 — server-side validation of the carpool policy form (pack rule 11: every threshold
 * is administrator-configurable). Pure and unit-tested; the settings server action calls it and
 * NEVER trusts the browser's min/max attributes. Out-of-range, fractional-where-integer,
 * NaN/Infinity, negative or zero values are all refused.
 */

import type { CarpoolPolicyConfig } from "@fleet/domain";

export interface PolicyBounds {
  min: number;
  max: number;
  integer: boolean;
}

/** Sane operating ranges. maxCandidatesForPreciseRouting is also a cost control (every
 * shortlisted candidate costs a routing call), hence the low ceiling. */
export const POLICY_BOUNDS: Record<
  | "departureWindowMinutes"
  | "returnWindowMinutes"
  | "maxAdditionalDistanceKm"
  | "maxAdditionalTimeMinutes"
  | "maxCandidatesForPreciseRouting"
  | "requestExpiryMinutes"
  | "minimumSeatAvailability",
  PolicyBounds
> = {
  departureWindowMinutes: { min: 1, max: 240, integer: true },
  returnWindowMinutes: { min: 1, max: 240, integer: true },
  maxAdditionalDistanceKm: { min: 0.1, max: 100, integer: false },
  maxAdditionalTimeMinutes: { min: 1, max: 240, integer: false },
  maxCandidatesForPreciseRouting: { min: 1, max: 20, integer: true },
  requestExpiryMinutes: { min: 1, max: 10080, integer: true },
  minimumSeatAvailability: { min: 1, max: 8, integer: true },
};

const BOOLEAN_FIELDS = [
  "carpoolEnabled",
  "carpoolFirstEnabled",
  "hostOptInRequired",
  "hostApprovalRequired",
  "allowIntermediatePickup",
  "allowIntermediateDropoff",
] as const;

export type PolicyParseResult =
  | { ok: true; values: CarpoolPolicyConfig }
  | { ok: false; invalidFields: string[] };

function parseNumber(raw: FormDataEntryValue | null, bounds: PolicyBounds): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (bounds.integer && !Number.isInteger(n)) return null;
  if (n < bounds.min || n > bounds.max) return null;
  return n;
}

export function parseCarpoolPolicyForm(formData: FormData): PolicyParseResult {
  const invalid: string[] = [];
  const numbers: Partial<Record<keyof typeof POLICY_BOUNDS, number>> = {};
  for (const key of Object.keys(POLICY_BOUNDS) as (keyof typeof POLICY_BOUNDS)[]) {
    const n = parseNumber(formData.get(key), POLICY_BOUNDS[key]);
    if (n === null) invalid.push(key);
    else numbers[key] = n;
  }
  if (invalid.length > 0) return { ok: false, invalidFields: invalid };

  const bool = (key: (typeof BOOLEAN_FIELDS)[number]) => formData.get(key) === "on";
  return {
    ok: true,
    values: {
      carpoolEnabled: bool("carpoolEnabled"),
      carpoolFirstEnabled: bool("carpoolFirstEnabled"),
      hostOptInRequired: bool("hostOptInRequired"),
      hostApprovalRequired: bool("hostApprovalRequired"),
      departureWindowMinutes: numbers.departureWindowMinutes!,
      returnWindowMinutes: numbers.returnWindowMinutes!,
      maxAdditionalDistanceKm: numbers.maxAdditionalDistanceKm!,
      maxAdditionalTimeMinutes: numbers.maxAdditionalTimeMinutes!,
      maxCandidatesForPreciseRouting: numbers.maxCandidatesForPreciseRouting!,
      requestExpiryMinutes: numbers.requestExpiryMinutes!,
      allowIntermediatePickup: bool("allowIntermediatePickup"),
      allowIntermediateDropoff: bool("allowIntermediateDropoff"),
      minimumSeatAvailability: numbers.minimumSeatAvailability!,
    },
  };
}
