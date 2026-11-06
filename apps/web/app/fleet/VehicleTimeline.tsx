"use client";
import type { Locale } from "@/lib/i18n/locales";
import type { FleetKey } from "@/lib/i18n/areas/fleet";
import { formatDateTimeShort, formatDayMonth } from "@/lib/formatDateTime";
import { fmt } from "./fmt";
import { layoutTimeline, timelineWindow, type TimelineBooking, type TimelineRider } from "./timelineLayout";

/** The little person: blinks (amber) while a carpool request waits for the host, stays still (purple) once the carpool is confirmed. */
function RiderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <circle cx="8" cy="4.8" r="3" fill="currentColor" />
      <path d="M2 14.2c0-3.2 2.6-5.4 6-5.4s6 2.2 6 5.4z" fill="currentColor" />
    </svg>
  );
}

/** Top of the chart column: the legend and the days. Sits on the same line as the list heading. */
export function TimelineHeader({ locale, T, now }: { locale: Locale; T: Record<FleetKey, string>; now: number }) {
  const win = timelineWindow(now);
  return (
    <div className="vt-head">
      <ul className="vt-legend" aria-label={T.timelineLegend}>
        <li><i className="vt-key" data-kind="pending" />{T.legendPending}</li>
        <li><i className="vt-key" data-kind="reserved" />{T.legendReserved}</li>
        <li><i className="vt-key" data-kind="inUse" />{T.legendInUse}</li>
        <li><i className="vt-key" data-kind="completed" />{T.legendCompleted}</li>
        <li><i className="vt-key" data-kind="carpool" />{T.legendCarpool}</li>
        <li data-testid="legend-rider-waiting"><i className="vt-rider vt-rider-key" data-state="waiting"><RiderIcon /></i>{T.legendRiderWaiting}</li>
        <li data-testid="legend-rider-confirmed"><i className="vt-rider vt-rider-key" data-state="confirmed"><RiderIcon /></i>{T.legendRiderConfirmed}</li>
      </ul>
      <div className="vt-days" aria-hidden="true">
        {win.dayStarts.map((d) => <span key={d}>{formatDayMonth(new Date(d + 3_600_000), locale)}</span>)}
      </div>
    </div>
  );
}

/** One vehicle's schedule, aligned with its row of the list: a bar per reservation and, only when the trip has an active carpool, a bar of another color under it. */
export function TimelineLane({ bookings, locale, T, now, plate, onSelect }: { bookings: TimelineBooking[]; locale: Locale; T: Record<FleetKey, string>; now: number; plate: string; onSelect?: (bookingId: string) => void }) {
  const win = timelineWindow(now);
  const { booking, carpool } = layoutTimeline(bookings, now);
  const todayPct = ((now - win.start) / (win.end - win.start)) * 100;
  const seatsLabel = (id: string) => {
    const c = bookings.find((b) => b.id === id.replace(":carpool", ""))?.carpool;
    return c ? fmt(T.carpoolSeats, { taken: c.taken, total: c.seats }) : T.legendCarpool;
  };
  const riderTitle = (r: TimelineRider) => (r.state === "waiting" ? fmt(T.riderWaitingTitle, { n: r.waiting }) : T.riderConfirmedTitle);
  const select = (id: string) => (onSelect ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(id); } } : {});
  return (
    <div className="vt-lane" role={onSelect ? "group" : "img"} aria-label={`${T.timelineTitle} ${plate}`} data-testid={`vehicle-timeline-${plate}`}>
      <i className="vt-today" style={{ left: `${todayPct}%` }} aria-hidden="true" />
      <div className="vt-track">
        {booking.map((b) => (
          <span key={b.id} className="vt-bar" data-kind={b.kind} {...(b.rider ? { "data-rider": b.rider.state } : {})} style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} {...(onSelect ? { role: "button", tabIndex: 0, onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(b.id); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(b.id); } } } : {})} title={`${b.label}\n${formatDateTimeShort(b.start, locale)} → ${formatDateTimeShort(b.end, locale)}`}>{b.label}</span>
        ))}
        {booking.map((b) => b.rider ? (
          <span key={`${b.id}:rider`} className="vt-rider" data-state={b.rider.state} data-testid={`rider-${b.rider.state}`} role="img" aria-label={riderTitle(b.rider)} title={riderTitle(b.rider)} style={{ left: `max(0px, calc(${b.leftPct}% - 4px))` }} {...select(b.id)}>
            <RiderIcon />
            {b.rider.state === "waiting" ? <b>{b.rider.waiting}</b> : null}
          </span>
        ) : null)}
      </div>
      <div className="vt-track">
        {carpool.map((b) => (
          <span key={b.id} className="vt-bar" data-kind="carpool" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} title={`${seatsLabel(b.id)}\n${formatDateTimeShort(b.start, locale)} → ${formatDateTimeShort(b.end, locale)}`}>{seatsLabel(b.id)}</span>
        ))}
      </div>
    </div>
  );
}
