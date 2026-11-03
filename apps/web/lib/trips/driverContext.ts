import { foldAccents } from "@/lib/geospatial/foldAccents";

/**
 * What the assistant "remembers" about a person: the destinations of their latest trips with the times they usually leave/return, and the state of
 * their driver's license. Everything is derived from data that already exists (trip_requests, profiles) so there is no second copy to get out of sync.
 */
export interface PastTrip {
  destination: string;
  date: string; // dd/mm
  departureTime: string; // HH:MM, Brazil time
  returnTime: string | null;
}

interface TripRow {
  destination: string | null;
  departure_at: string | null;
  expected_return_at: string | null;
}

const TZ = "America/Sao_Paulo";
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const ddmm = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const keyOf = (s: string) => foldAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Latest trip per destination (most recent first), at most `limit`. Rows come newest first. */
export function summarizePastTrips(rows: readonly TripRow[], limit = 5): PastTrip[] {
  const seen = new Set<string>();
  const out: PastTrip[] = [];
  for (const r of rows) {
    if (!r.destination || !r.departure_at) continue;
    const key = keyOf(r.destination);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ destination: r.destination.trim().slice(0, 160), date: ddmm(r.departure_at), departureTime: hhmm(r.departure_at), returnTime: r.expected_return_at ? hhmm(r.expected_return_at) : null });
    if (out.length >= limit) break;
  }
  return out;
}

export type LicenseState =
  | { kind: "missing" }
  | { kind: "expired"; date: string }
  | { kind: "expiring"; date: string; days: number }
  | { kind: "ok" };

export const LICENSE_WARN_DAYS = 30;

/** `expiration` is the profile's date (YYYY-MM-DD) or null when no license was ever read. */
export function licenseState(expiration: string | null | undefined, now: Date = new Date()): LicenseState {
  if (!expiration) return { kind: "missing" };
  const end = new Date(`${expiration}T23:59:59-03:00`);
  if (Number.isNaN(end.getTime())) return { kind: "missing" };
  const date = `${expiration.slice(8, 10)}/${expiration.slice(5, 7)}/${expiration.slice(0, 4)}`;
  if (end.getTime() < now.getTime()) return { kind: "expired", date };
  const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  return days <= LICENSE_WARN_DAYS ? { kind: "expiring", date, days } : { kind: "ok" };
}
