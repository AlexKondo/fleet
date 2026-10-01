/**
 * Phase C5 — maps the stable carpool error codes (rpcErrors.ts + the action-level codes of
 * requestActions.ts) to the translated message in the `carpool.errors` dictionary section.
 * Raw Postgres text never reaches the UI.
 */

import type { Dictionary } from "@/lib/i18n/dictionaries";

type ErrorsDict = Dictionary["carpool"]["errors"];

const KEY_BY_CODE: Record<string, keyof ErrorsDict> = {
  CARPOOL_NOT_AUTHENTICATED: "notAuthorized",
  not_authenticated: "notAuthorized",
  CARPOOL_NOT_AUTHORIZED: "notAuthorized",
  CARPOOL_TRIP_NOT_FOUND: "notFound",
  CARPOOL_OFFER_NOT_FOUND: "notFound",
  CARPOOL_REQUEST_NOT_FOUND: "notFound",
  CARPOOL_INVALID_SEATS: "invalidSeats",
  invalid_input: "invalidSeats",
  CARPOOL_SEATS_EXCEED_CAPACITY: "exceedsCapacity",
  CARPOOL_DISABLED_BY_POLICY: "disabledByPolicy",
  CARPOOL_HOST_TRIP_INACTIVE: "hostTripInactive",
  CARPOOL_HOST_TRIP_STARTED: "hostTripStarted",
  CARPOOL_OFFER_ALREADY_ACTIVE: "alreadyActive",
  CARPOOL_OFFER_ALREADY_DISABLED: "alreadyDisabled",
  CARPOOL_CANNOT_REDUCE_BELOW_SEATS_TAKEN: "cannotReduce",
  CARPOOL_NO_SEATS_AVAILABLE: "noSeats",
  CARPOOL_REQUEST_NOT_PENDING: "requestNotPending",
  CARPOOL_REQUEST_NOT_CANCELLABLE: "requestNotPending",
  CARPOOL_REQUEST_EXPIRED: "requestExpired",
  CARPOOL_OFFER_NOT_ACTIVE: "notCompatible",
  CARPOOL_DETOUR_EXCEEDS_POLICY: "notCompatible",
  CARPOOL_OUTSIDE_DEPARTURE_WINDOW: "notCompatible",
  CARPOOL_CANNOT_REQUEST_OWN_OFFER: "notCompatible",
  offer_not_compatible: "notCompatible",
  carpool_unavailable: "unavailable",
  CARPOOL_REQUEST_ALREADY_EXISTS: "alreadyRequested",
};

export function carpoolErrorText(dict: Dictionary, code: string | null | undefined): string {
  const key = (code && KEY_BY_CODE[code]) || "generic";
  return dict.carpool.errors[key];
}

export function carpoolReasonText(dict: Dictionary, reason: string | null | undefined): string | null {
  if (!reason) return null;
  const reasons = dict.carpool.reasons as Record<string, string>;
  // INVALIDATED reasons are system codes (translated); a REJECTED reason is the host's free text.
  return reasons[reason] ?? reason;
}

export function carpoolStatusText(dict: Dictionary, status: string): string {
  return (dict.carpool.statuses as Record<string, string>)[status] ?? status;
}

export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
