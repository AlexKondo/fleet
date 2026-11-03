const DAY_MS = 86_400_000;
const BRASILIA_OFFSET_MS = 3 * 3_600_000;

export type TimelineBooking = {
  id: string;
  start: string;
  end: string;
  /** reservations.status: pending_approval | confirmed | completed */
  status: string;
  label: string;
  /** Present only when the trip has an active carpool offer. */
  carpool?: { seats: number; taken: number };
};

export type TimelineBar = { id: string; kind: "pending" | "reserved" | "inUse" | "completed" | "carpool"; leftPct: number; widthPct: number; label: string; start: string; end: string };

/** 00:00 Brasília of the day that holds `ms`, as a UTC instant. */
export function brasiliaDayStart(ms: number): number {
  return Math.floor((ms - BRASILIA_OFFSET_MS) / DAY_MS) * DAY_MS + BRASILIA_OFFSET_MS;
}

/** The window the chart shows: yesterday and the next `days - 1` days (Brasília days). */
export function timelineWindow(now: number, days = 15): { start: number; end: number; dayStarts: number[] } {
  const start = brasiliaDayStart(now) - DAY_MS;
  return { start, end: start + days * DAY_MS, dayStarts: Array.from({ length: days }, (_, i) => start + i * DAY_MS) };
}

function bookingKind(status: string, startMs: number, endMs: number, now: number): TimelineBar["kind"] {
  if (status === "pending_approval") return "pending";
  if (status === "completed") return "completed";
  return now >= startMs && now <= endMs ? "inUse" : "reserved";
}

/** Bars of the vehicle's reservations (row "booking") and, only for trips that have an active carpool, the carpool bars (row "carpool"). */
export function layoutTimeline(bookings: TimelineBooking[], now: number, days = 15): { booking: TimelineBar[]; carpool: TimelineBar[] } {
  const win = timelineWindow(now, days);
  const span = win.end - win.start;
  const booking: TimelineBar[] = [];
  const carpool: TimelineBar[] = [];
  for (const b of bookings) {
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= win.start || s >= win.end) continue;
    const left = ((Math.max(s, win.start) - win.start) / span) * 100;
    const width = Math.max(((Math.min(e, win.end) - Math.max(s, win.start)) / span) * 100, 0.6);
    booking.push({ id: b.id, kind: bookingKind(b.status, s, e, now), leftPct: left, widthPct: width, label: b.label, start: b.start, end: b.end });
    if (b.carpool && b.status !== "completed") {
      carpool.push({ id: `${b.id}:carpool`, kind: "carpool", leftPct: left, widthPct: width, label: `${b.carpool.taken}/${b.carpool.seats}`, start: b.start, end: b.end });
    }
  }
  return { booking, carpool };
}
