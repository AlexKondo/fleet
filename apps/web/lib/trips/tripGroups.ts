/**
 * Grouping of "Minhas Reservas e Viagens" (/trips) rows into the existing sections.
 *
 * R1 (FIX-VENCIDAS): a reservation whose window ended (end_at <= now) and that never had any
 * operational activity (pickup checklist, gate movement, key delivery) is no longer "upcoming":
 * it goes to the History section with a "Não retirada" / "Expirada sem aprovação" badge and offers
 * no pickup action. Reservations with any recorded activity, or whose activity cannot be read,
 * keep their previous handling (an overdue trip in progress stays in the active/upcoming lists and
 * follows the audited exception path of 0200).
 */

/** Subset of fm_checklist_state (lib/operations/checklistState.ts) used to detect activity. */
export interface TripActivityState {
  pickup_traveler: boolean;
  pickup_security: boolean;
  return_traveler: boolean;
  return_security: boolean;
  departed: boolean;
  arrived: boolean;
  legacy_pickup: boolean;
  keys_delivered?: boolean;
  keys_received?: boolean;
}

export interface TripGroupRow {
  status: string;
  end_at: string;
  vehicle?: { status?: string | null } | null;
  cancellation_reason?: string | null;
}

/** Reason codes written by fm_release_expired_reservations (0209). */
export const NO_SHOW_REASON = "no_show_auto";
export const EXPIRED_UNAPPROVED_REASON = "expired_unapproved";

export type ExpiredBadge = "notPickedUp" | "expiredUnapproved";

/** true = some activity recorded, false = none, null = unknown (state not loaded). */
export function hasOperationalActivity(state: TripActivityState | null | undefined): boolean | null {
  if (!state) return null;
  return (
    state.pickup_traveler ||
    state.pickup_security ||
    state.return_traveler ||
    state.return_security ||
    state.departed ||
    state.arrived ||
    state.legacy_pickup ||
    state.keys_delivered === true ||
    state.keys_received === true
  );
}

export function isActiveTrip(r: TripGroupRow): boolean {
  return r.status === "confirmed" && (r.vehicle?.status === "in_use" || r.vehicle?.status === "returning");
}

/**
 * Badge for an open reservation whose window has ended without any activity, or for one that the
 * automatic release already cancelled; null otherwise.
 * - pending_approval past end_at: never approved in time (cannot have activity).
 * - confirmed past end_at: only when activity is known to be absent.
 */
export function expiredBadge(
  r: TripGroupRow,
  nowMs: number,
  activity: boolean | null,
): ExpiredBadge | null {
  if (r.status === "cancelled") {
    if (r.cancellation_reason === NO_SHOW_REASON) return "notPickedUp";
    if (r.cancellation_reason === EXPIRED_UNAPPROVED_REASON) return "expiredUnapproved";
    return null;
  }
  const ended = new Date(r.end_at).getTime() <= nowMs;
  if (!ended) return null;
  if (r.status === "pending_approval") return "expiredUnapproved";
  if (r.status === "confirmed" && !isActiveTrip(r) && activity === false) return "notPickedUp";
  return null;
}

export interface TripGroups<T> {
  activeList: T[];
  upcomingList: T[];
  doneList: T[];
  /** Cancelled rows plus open rows that expired without activity (shown in the cancelled tab). */
  cancelledList: T[];
  /** doneList + cancelledList, newest first. */
  historyList: T[];
}

export function groupTrips<T extends TripGroupRow & { id: string; start_at: string }>(
  rows: readonly T[],
  nowMs: number,
  activityOf: (row: T) => boolean | null,
): TripGroups<T> {
  const expired = (r: T) =>
    r.status !== "cancelled" && expiredBadge(r, nowMs, activityOf(r)) !== null;
  const byStartAsc = (a: T, b: T) => a.start_at.localeCompare(b.start_at);
  const activeList = rows.filter(isActiveTrip).sort(byStartAsc);
  const upcomingList = rows
    .filter(
      (r) =>
        (r.status === "pending_approval" || r.status === "confirmed") &&
        !isActiveTrip(r) &&
        !expired(r),
    )
    .sort(byStartAsc);
  const doneList = rows.filter((r) => r.status === "completed");
  const cancelledList = rows.filter((r) => r.status === "cancelled" || expired(r));
  const historyList = [...doneList, ...cancelledList].sort((a, b) => b.start_at.localeCompare(a.start_at));
  return { activeList, upcomingList, doneList, cancelledList, historyList };
}
