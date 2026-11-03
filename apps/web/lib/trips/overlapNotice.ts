/** A person's own reservation (or carpool trip) that overlaps the period they are asking for. */
export interface OwnPeriod {
  plate?: string;
  destination: string;
  startAt: string;
  endAt: string | null;
}

const HOUR_MS = 3_600_000;

/**
 * The ones among `own` whose period overlaps [startIso, endIso]. A period without a return counts as one hour; a request without a valid start
 * overlaps nothing (nothing to compare).
 */
export function overlappingPeriods(own: OwnPeriod[], startIso: string | undefined, endIso: string | undefined): OwnPeriod[] {
  const start = Date.parse(startIso ?? "");
  if (!Number.isFinite(start)) return [];
  const parsedEnd = Date.parse(endIso ?? "");
  const end = Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + HOUR_MS;
  return own.filter((p) => {
    const s = Date.parse(p.startAt);
    if (!Number.isFinite(s)) return false;
    const parsed = Date.parse(p.endAt ?? "");
    const e = Number.isFinite(parsed) && parsed > s ? parsed : s + HOUR_MS;
    return s < end && start < e;
  });
}
