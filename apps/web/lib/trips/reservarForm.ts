/**
 * Pure helpers of the "Reservar Veiculo" form (SCR-USR-002): date + time inputs composed into the zone-less
 * "YYYY-MM-DDTHH:mm" value the server already parses as Brasilia time (parseBrasiliaLocalDateTime), the "motivo da
 * viagem" select mapped to the existing `justification` text, and the energy-type filter of the vehicle cards.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** "2026-09-13" + "08:00" -> "2026-09-13T08:00" ("" when either part is missing or malformed). */
export function composeLocalDateTime(date: string, time: string): string {
  const d = date.trim();
  const t = time.trim();
  return DATE.test(d) && TIME.test(t) ? `${d}T${t}` : "";
}

/** "2026-09-13T08:00" (or with seconds) -> { date, time }; empty parts when malformed. */
export function splitLocalDateTime(value: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.trim());
  return m ? { date: m[1]!, time: m[2]! } : { date: "", time: "" };
}

export const MOTIVO_KEYS = ["meeting", "clientVisit", "training", "delivery", "maintenance", "other"] as const;
export type MotivoKey = (typeof MOTIVO_KEYS)[number];
export type MotivoLabels = Record<MotivoKey, string>;

/** The text stored in `justification`: the option's label, or the custom text for "Outro". */
export function justificationFor(key: MotivoKey, otherText: string, labels: MotivoLabels): string {
  return key === "other" ? otherText.trim() : labels[key];
}

/** Restores the select from a stored justification (draft / re-render): a known label selects it, anything else is "Outro". */
export function motivoFromJustification(justification: string, labels: MotivoLabels): { key: MotivoKey; other: string } {
  const text = justification.trim();
  if (!text) return { key: "meeting", other: "" };
  for (const key of MOTIVO_KEYS) {
    if (key !== "other" && labels[key] === text) return { key, other: "" };
  }
  return { key: "other", other: text };
}

/** Energy filter chips: only the types that exist among the options, in a stable order. */
const ENERGY_ORDER = ["BEV", "PHEV", "HEV", "ICE"] as const;
export function energyFilterTypes(vehicles: readonly { energyType: string }[]): string[] {
  const present = new Set(vehicles.map((v) => v.energyType));
  const known = ENERGY_ORDER.filter((e) => present.has(e));
  const extra = [...present].filter((e) => !(ENERGY_ORDER as readonly string[]).includes(e)).sort();
  return [...known, ...extra];
}

/** "all" keeps everything (recommended first, order preserved). */
export function filterByEnergy<T extends { energyType: string }>(vehicles: readonly T[], filter: string): T[] {
  return filter === "all" ? [...vehicles] : vehicles.filter((v) => v.energyType === filter);
}
