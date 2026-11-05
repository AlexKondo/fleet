interface ChartReservation {
  status: string;
  start: string;
  end: string;
}

/**
 * The lines of a reservation chart: the vehicle with the closest open reservation on top (one running now comes first). Vehicles with nothing
 * ahead go last, the most recently used first.
 */
export function byNextReservation<R>(rows: readonly R[], reservationsOf: (row: R) => readonly ChartReservation[], nowMs: number): R[] {
  const keyed = rows.map((row) => {
    const reservations = reservationsOf(row);
    const open = reservations.filter((r) => (r.status === "pending_approval" || r.status === "confirmed") && Date.parse(r.end) >= nowMs);
    return {
      row,
      next: open.length > 0 ? Math.min(...open.map((r) => Date.parse(r.start))) : null,
      last: reservations.length > 0 ? Math.max(...reservations.map((r) => Date.parse(r.end))) : 0,
    };
  });
  return keyed
    .sort((a, b) => {
      if (a.next !== null && b.next !== null) return a.next - b.next;
      if (a.next !== null) return -1;
      if (b.next !== null) return 1;
      return b.last - a.last;
    })
    .map((k) => k.row);
}
