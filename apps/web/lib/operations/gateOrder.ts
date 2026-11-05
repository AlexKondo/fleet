/** The Portaria list: the event closest to now first, whether it is about to happen or has just happened (a tie goes to the earlier one). */
export function nearestEventFirst<T extends { eventMs: number }>(rows: readonly T[], nowMs: number): T[] {
  return [...rows].sort((a, b) => Math.abs(a.eventMs - nowMs) - Math.abs(b.eventMs - nowMs) || a.eventMs - b.eventMs);
}

/** First and last name: enough for the porter to recognise the person, and it fits the line. */
export function shortPersonName(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts[parts.length - 1]}`;
}
