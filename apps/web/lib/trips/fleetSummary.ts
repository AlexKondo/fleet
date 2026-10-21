/**
 * FIX-VENCIDAS / Assistente: WHY no vehicle was found for a trip, as counts per blocking reason
 * (never another person's reservation details). Computed only when the engine found nothing.
 */
export interface FleetSummary {
  total: number;
  /** status reserved / awaiting_pickup (held by an approved reservation). */
  reserved: number;
  maintenance: number;
  blocked: number;
  /** in_use / returning. */
  inUse: number;
  /** bookable status but another reservation already holds the requested window. */
  busy: number;
  /** free, but fewer seats than the passengers asked for. */
  seats: number;
  /** free, but the trip needs cargo and the vehicle can't take it. */
  cargo: number;
  /** free and big enough, but the readiness rules (energy, cleaning, documents...) reject it. */
  notReady: number;
  /** any other status (e.g. inspection). */
  other: number;
}

export interface FleetSummaryRow {
  id: string;
  status: string;
  category?: { passenger_capacity?: number | null; supports_cargo?: boolean | null } | null;
}

const BOOKABLE = new Set(["available", "charging", "cleaning"]);

export function summarizeFleet(
  rows: readonly FleetSummaryRow[],
  busyVehicleIds: ReadonlySet<string>,
  trip: { passengerCount: number; requiresCargo: boolean },
): FleetSummary {
  const s: FleetSummary = { total: 0, reserved: 0, maintenance: 0, blocked: 0, inUse: 0, busy: 0, seats: 0, cargo: 0, notReady: 0, other: 0 };
  for (const row of rows) {
    s.total++;
    if (row.status === "reserved" || row.status === "awaiting_pickup") s.reserved++;
    else if (row.status === "maintenance") s.maintenance++;
    else if (row.status === "blocked") s.blocked++;
    else if (row.status === "in_use" || row.status === "returning") s.inUse++;
    else if (!BOOKABLE.has(row.status)) s.other++;
    else if (busyVehicleIds.has(row.id)) s.busy++;
    else if ((row.category?.passenger_capacity ?? 0) < trip.passengerCount) s.seats++;
    else if (trip.requiresCargo && !row.category?.supports_cargo) s.cargo++;
    else s.notReady++;
  }
  return s;
}
