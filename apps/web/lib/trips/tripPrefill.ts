import { clampText, MAX_LOCATION_TEXT } from "./textLimits";

/**
 * Hand-off of a trip request from the FleetMind Assistant to the New Trip form (/trips/new) when
 * the assistant could not complete it (e.g. no vehicle available for the window). Only plain trip
 * data travels in the query string — never a vehicle id, a reservation or anything that acts:
 * the form still runs the normal search/confirm flow, so nothing is created by opening the link.
 *
 * The parsed result uses the SAME field format as the form's own sessionStorage draft
 * (TripRequestForm readDraft: departureAt/expectedReturnAt as Brasília "YYYY-MM-DDTHH:mm",
 * passengerCount, distanceKm, requiresCargo/allowCarpool "on"/"off") plus `offerSeats`.
 */
export const TRIP_PREFILL_PATH = "/trips/new";

const TZ = "America/Sao_Paulo";
/** ISO instant -> "YYYY-MM-DDTHH:mm" in Brasília time (same as TripRequestForm's toLocalInputValue). */
function toBrasiliaInput(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleString("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(" ", "T");
}
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const intIn = (v: string | undefined, min: number, max: number): string | null => {
  if (v === undefined || !/^\d{1,4}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n >= min && n <= max ? String(n) : null;
};

/** Chat slots -> /trips/new?… (only the fields the form understands; empty values are omitted). */
export function buildTripPrefillHref(slots: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | null | undefined) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, v);
  };
  set("origin", slots.origin ? clampText(slots.origin, MAX_LOCATION_TEXT) : null);
  set("destination", slots.destination ? clampText(slots.destination, MAX_LOCATION_TEXT) : null);
  set("departureAt", slots.departureAt ? toBrasiliaInput(slots.departureAt) : null);
  set("expectedReturnAt", slots.expectedReturnAt ? toBrasiliaInput(slots.expectedReturnAt) : null);
  set("passengerCount", intIn(slots.passengerCount, 1, 99));
  const km = slots.distanceKm !== undefined ? Number(slots.distanceKm) : NaN;
  set("distanceKm", Number.isFinite(km) && km > 0 && km <= 5000 ? String(Math.round(km)) : null);
  if (slots.requiresCargo === "true") q.set("requiresCargo", "on");
  if (slots.allowCarpool === "true") q.set("allowCarpool", "on");
  else if (slots.allowCarpool === "false") q.set("allowCarpool", "off");
  set("offerSeats", slots.allowCarpool === "true" ? intIn(slots.offerSeats, 1, 8) : null);
  const qs = q.toString();
  return qs ? `${TRIP_PREFILL_PATH}?${qs}` : TRIP_PREFILL_PATH;
}

/** /trips/new searchParams -> validated draft fields (anything malformed is dropped). */
export function parseTripPrefill(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : undefined;
  };
  const out: Record<string, string> = {};
  const origin = one("origin")?.trim();
  if (origin) out.origin = clampText(origin, MAX_LOCATION_TEXT);
  const destination = one("destination")?.trim();
  if (destination) out.destination = clampText(destination, MAX_LOCATION_TEXT);
  const dep = one("departureAt");
  const ret = one("expectedReturnAt");
  if (dep && LOCAL_RE.test(dep)) out.departureAt = dep;
  if (ret && LOCAL_RE.test(ret)) out.expectedReturnAt = ret;
  const pax = intIn(one("passengerCount"), 1, 99);
  if (pax) out.passengerCount = pax;
  const km = intIn(one("distanceKm"), 1, 5000);
  if (km) out.distanceKm = km;
  if (one("requiresCargo") === "on") out.requiresCargo = "on";
  const carpool = one("allowCarpool");
  if (carpool === "on" || carpool === "off") out.allowCarpool = carpool;
  const seats = carpool === "on" ? intIn(one("offerSeats"), 1, 8) : null;
  if (seats) out.offerSeats = seats;
  return out;
}
