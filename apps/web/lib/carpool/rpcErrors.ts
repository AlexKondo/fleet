/**
 * Phase C4 — maps a Postgres exception raised by the carpool lifecycle RPCs (0059) to a
 * stable, non-sensitive code the UI can translate (C5). The RPCs raise exceptions whose
 * message IS the code (e.g. `CARPOOL_NO_SEATS_AVAILABLE`); anything else (a constraint
 * violation, a network error) collapses to one generic code and its raw text stays in the
 * server log only.
 */

export const CARPOOL_ERROR_CODES = [
  "CARPOOL_NOT_AUTHENTICATED",
  "CARPOOL_NOT_AUTHORIZED",
  "CARPOOL_TRIP_NOT_FOUND",
  "CARPOOL_OFFER_NOT_FOUND",
  "CARPOOL_REQUEST_NOT_FOUND",
  "CARPOOL_INVALID_SEATS",
  "CARPOOL_INVALID_LOCATION",
  "CARPOOL_INVALID_DEPARTURE",
  "CARPOOL_DISABLED_BY_POLICY",
  "CARPOOL_HOST_TRIP_INACTIVE",
  "CARPOOL_HOST_TRIP_STARTED",
  "CARPOOL_SEATS_EXCEED_CAPACITY",
  "CARPOOL_OFFER_ALREADY_ACTIVE",
  "CARPOOL_OFFER_ALREADY_DISABLED",
  "CARPOOL_OFFER_COMPLETED",
  "CARPOOL_OFFER_NOT_ACTIVE",
  "CARPOOL_CANNOT_REDUCE_BELOW_SEATS_TAKEN",
  "CARPOOL_CLIENT_REQUEST_ID_REQUIRED",
  "CARPOOL_CLIENT_REQUEST_ID_CONFLICT",
  "CARPOOL_ROUTE_EVALUATION_REQUIRED",
  "CARPOOL_DETOUR_EXCEEDS_POLICY",
  "CARPOOL_OUTSIDE_DEPARTURE_WINDOW",
  "CARPOOL_CANNOT_REQUEST_OWN_OFFER",
  "CARPOOL_NO_SEATS_AVAILABLE",
  "CARPOOL_REQUEST_NOT_PENDING",
  "CARPOOL_REQUEST_NOT_CANCELLABLE",
  "CARPOOL_REQUEST_EXPIRED",
] as const;

export type CarpoolErrorCode =
  | (typeof CARPOOL_ERROR_CODES)[number]
  | "CARPOOL_REQUEST_ALREADY_EXISTS"
  | "CARPOOL_RPC_FAILED";

export function toCarpoolErrorCode(message: string | null | undefined): CarpoolErrorCode {
  const text = (message ?? "").trim();
  if ((CARPOOL_ERROR_CODES as readonly string[]).includes(text)) return text as CarpoolErrorCode;
  // The partial unique index (one live request per rider+offer) surfaces as a 23505.
  if (text.includes("carpool_ride_requests_one_live_per_rider_offer_idx")) {
    return "CARPOOL_REQUEST_ALREADY_EXISTS";
  }
  return "CARPOOL_RPC_FAILED";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
