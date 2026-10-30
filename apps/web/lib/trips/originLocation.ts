/**
 * Origin check for vehicle search: a vehicle is only offered "at the origin" when its current location is the
 * registered departure location the requester picked (vehicles.current_location_id). Pure; the server action feeds it.
 */

export interface OriginLocation {
  id: string;
  name: string;
}

export type OriginCheckStatus =
  /** the candidates were narrowed to the origin location and at least one vehicle is there (or the org has no locations) */
  | "ok"
  /** a registered location was chosen/recognized but no eligible vehicle is there */
  | "none_at_origin"
  /** the origin could not be tied to any registered location (e.g. typed text that matches none) */
  | "unknown";

export interface OriginCheck {
  status: OriginCheckStatus;
  /** the recognized origin location (absent when unknown or when the org has no locations) */
  originLocationId?: string;
  originLocationName?: string;
  /** the requester asked to see vehicles from other locations too (explicit, with a warning in the UI) */
  includeOthers: boolean;
  /** other locations that DO have eligible vehicles (only filled when nothing is at the origin) */
  others: { locationId: string; name: string; count: number }[];
  /** eligible vehicles that have no registered location at all (cannot be matched to any origin) */
  withoutLocation: number;
}

export function normalizePlaceText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The origin text IS the person's registered work location ("Seu local de trabalho", a corporate mobility point: its name or its
 * address, which is what the form and the assistant send as the default origin). Mobility points are not vehicle locations, so
 * such an origin never matches a vehicle location by name; it must NOT be treated as free text ("offer every vehicle").
 */
export function isWorkLocationOrigin(originText: string, work: { name: string; addressLabel: string } | null | undefined): boolean {
  if (!work) return false;
  const text = normalizePlaceText(originText);
  if (text.length < 3) return false;
  return text === normalizePlaceText(work.name) || text === normalizePlaceText(work.addressLabel);
}

export type OriginResolution =
  | { kind: "location"; location: OriginLocation }
  /** the org has no registered locations: there is nothing to compare, the search stays unfiltered */
  | { kind: "no_locations" }
  | { kind: "unknown" };

/**
 * `locationId` (picked from the list) wins; without it the origin text is matched to a location name
 * (accent/case-insensitive, either side containing the other). A typed text that matches nothing is "unknown".
 */
export function resolveOriginLocation(
  locations: readonly OriginLocation[],
  input: { originLocationId?: string | null; originText: string },
): OriginResolution {
  if (locations.length === 0) return { kind: "no_locations" };
  if (input.originLocationId) {
    const byId = locations.find((l) => l.id === input.originLocationId);
    return byId ? { kind: "location", location: byId } : { kind: "unknown" };
  }
  const text = normalizePlaceText(input.originText);
  if (text.length < 3) return { kind: "unknown" };
  const exact = locations.find((l) => normalizePlaceText(l.name) === text);
  if (exact) return { kind: "location", location: exact };
  const partial = locations.filter((l) => {
    const n = normalizePlaceText(l.name);
    return n.length >= 3 && (text.includes(n) || n.includes(text));
  });
  // ambiguous text (matches several locations) is not guessed
  return partial.length === 1 ? { kind: "location", location: partial[0]! } : { kind: "unknown" };
}

export interface LocatedCandidate {
  currentLocationId: string | null | undefined;
}

/** Splits the candidates into the ones at the origin and the per-location counts of the rest. */
export function splitByOrigin<T>(
  candidates: readonly T[],
  locationOf: (c: T) => string | null | undefined,
  locations: readonly OriginLocation[],
  originId: string | null,
): {
  atOrigin: T[];
  others: { locationId: string; name: string; count: number }[];
  withoutLocation: number;
} {
  const nameById = new Map(locations.map((l) => [l.id, l.name]));
  const atOrigin: T[] = [];
  const counts = new Map<string, number>();
  let withoutLocation = 0;
  for (const c of candidates) {
    const loc = locationOf(c);
    if (loc && loc === originId) atOrigin.push(c);
    else if (!loc || !nameById.has(loc)) withoutLocation++;
    else counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }
  const others = [...counts.entries()]
    .map(([locationId, count]) => ({ locationId, name: nameById.get(locationId)!, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { atOrigin, others, withoutLocation };
}
