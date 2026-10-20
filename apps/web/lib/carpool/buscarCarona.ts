/**
 * SCR-USR-003 "Buscar Carona" (/carpool): pure helpers for the dedicated rider screen. The search itself
 * reuses runCarpoolFirst (carpoolFirst.ts); this module only holds what is new and pure:
 *  - input validation/normalisation of the client payload (never trusted),
 *  - the org-policy gate of the screen,
 *  - the conversion of a <input type="datetime-local"> value into the exact instant the rider typed.
 */

import { clampText, MAX_LOCATION_TEXT } from "@/lib/trips/textLimits";
import { parseBrasiliaLocalDateTime } from "@/lib/trips/brasiliaLocalDateTime";

export const MAX_SEATS = 8;
/** A requested departure more than this far in the past is a typo, not a trip. */
const PAST_TOLERANCE_MS = 5 * 60_000;

export interface BuscarInput {
  originText: string;
  destinationText: string;
  /** ISO instant. */
  departureAt: string;
  /** ISO instant of the optional return (round trip); absent = one-way. */
  returnAt?: string;
  passengerCount: number;
}

export type ParsedBuscarInput = { ok: true; input: BuscarInput } | { ok: false };

/** Validates the (untrusted) client payload. Text is clamped, never rewritten; the instant is kept exactly. */
export function parseBuscarInput(raw: unknown, now: Date = new Date()): ParsedBuscarInput {
  if (typeof raw !== "object" || raw === null) return { ok: false };
  const r = raw as Record<string, unknown>;
  const originText = clampText(r.originText, MAX_LOCATION_TEXT).trim();
  const destinationText = clampText(r.destinationText, MAX_LOCATION_TEXT).trim();
  if (!originText || !destinationText) return { ok: false };

  if (typeof r.departureAt !== "string") return { ok: false };
  const when = new Date(r.departureAt);
  if (!Number.isFinite(when.getTime())) return { ok: false };
  if (when.getTime() < now.getTime() - PAST_TOLERANCE_MS) return { ok: false };

  // optional return: empty = one-way; present = a valid instant strictly after the departure
  let returnAt: string | undefined;
  if (r.returnAt !== undefined && r.returnAt !== null && r.returnAt !== "") {
    if (typeof r.returnAt !== "string") return { ok: false };
    const back = new Date(r.returnAt);
    if (!Number.isFinite(back.getTime()) || back.getTime() <= when.getTime()) return { ok: false };
    returnAt = back.toISOString();
  }

  const seats = r.passengerCount;
  if (typeof seats !== "number" || !Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) {
    return { ok: false };
  }
  return {
    ok: true,
    input: { originText, destinationText, departureAt: when.toISOString(), ...(returnAt ? { returnAt } : {}), passengerCount: seats },
  };
}

export type BuscarGate = "enabled" | "disabled" | "unknown";

/**
 * The screen only needs the carpool engine to be ON for the organization (carpool-first is the New Trip
 * step and is not required here). A failed policy read is "unknown": the page shows the outage banner
 * and never runs a search (fail closed, same stance as deriveCarpoolGating).
 */
export function deriveBuscarGate(
  load: { ok: true; policy: { carpoolEnabled: boolean } } | { ok: false },
): BuscarGate {
  if (!load.ok) return "unknown";
  return load.policy.carpoolEnabled ? "enabled" : "disabled";
}

/**
 * "2026-10-12T07:30" (a zone-less date+time value) -> ISO instant of that wall-clock time in BRASILIA time (the fleet's zone,
 * parseBrasiliaLocalDateTime: the same rule as the trip form), whatever zone the browser or the server runs in.
 * Null when empty / malformed / an impossible date.
 */
export function brasiliaInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = parseBrasiliaLocalDateTime(value);
  if (!Number.isFinite(d.getTime())) return null;
  const back = d
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(" ", "T");
  return back === value ? d.toISOString() : null;
}

/**
 * "2026-10-12T07:30" (datetime-local, no zone) -> ISO instant of THAT wall-clock time in the browser's zone.
 * The seconds are forced to 0 and nothing is rounded, so the requested time is preserved exactly. Returns null
 * when the value is empty or invalid.
 */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // reject overflow such as 2026-02-31 (Date would silently roll it into March)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  if (date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date.toISOString();
}
