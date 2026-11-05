/**
 * The Home list: the reservations still open, the closest first. A vehicle that left and did not come back is the current one, so it leads the
 * list and stays on it even after its window ended; everything else follows by departure.
 */
export function openReservationsNearestFirst<T extends { status: string; start_at: string; end_at: string }>(
  rows: readonly T[],
  isOut: (row: T) => boolean,
  nowMs: number,
): T[] {
  return rows
    .filter((r) => (r.status === "pending_approval" || r.status === "confirmed") && (isOut(r) || Date.parse(r.end_at) >= nowMs))
    .sort((a, b) => Number(isOut(b)) - Number(isOut(a)) || Date.parse(a.start_at) - Date.parse(b.start_at));
}
