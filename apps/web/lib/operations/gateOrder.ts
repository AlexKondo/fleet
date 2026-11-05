/** The Portaria list: the event closest to now first, whether it is about to happen or has just happened (a tie goes to the earlier one). */
export function nearestEventFirst<T extends { eventMs: number }>(rows: readonly T[], nowMs: number): T[] {
  return [...rows].sort((a, b) => Math.abs(a.eventMs - nowMs) - Math.abs(b.eventMs - nowMs) || a.eventMs - b.eventMs);
}
