"use client";
import type { Locale } from "@/lib/i18n/locales";
import type { FleetKey } from "@/lib/i18n/areas/fleet";
import { formatDateTimeShort, formatDayMonth } from "@/lib/formatDateTime";
import { fmt } from "./fmt";
import { layoutTimeline, timelineWindow, type TimelineBooking } from "./timelineLayout";

/** The vehicle's schedule: one bar per reservation for its period and, when the trip has an active carpool, a bar of another color under it. */
export function VehicleTimeline({ bookings, locale, T, now }: { bookings: TimelineBooking[]; locale: Locale; T: Record<FleetKey, string>; now: number }) {
  const win = timelineWindow(now);
  const { booking, carpool } = layoutTimeline(bookings, now);
  const todayPct = ((now - win.start) / (win.end - win.start)) * 100;
  const byId = (id: string) => bookings.find((b) => b.id === id.replace(":carpool", ""));
  const seatsLabel = (id: string) => {
    const c = byId(id)?.carpool;
    return c ? fmt(T.carpoolSeats, { taken: c.taken, total: c.seats }) : T.legendCarpool;
  };
  return (
    <section className="vt" aria-label={T.timelineTitle}>
      <h3>{T.timelineTitle}</h3>
      <ul className="vt-legend" aria-label={T.timelineLegend}>
        <li><i className="vt-key" data-kind="pending" />{T.legendPending}</li>
        <li><i className="vt-key" data-kind="reserved" />{T.legendReserved}</li>
        <li><i className="vt-key" data-kind="inUse" />{T.legendInUse}</li>
        <li><i className="vt-key" data-kind="completed" />{T.legendCompleted}</li>
        <li><i className="vt-key" data-kind="carpool" />{T.legendCarpool}</li>
      </ul>
      <div className="vt-scroll">
        <div className="vt-chart">
          <div className="vt-days" aria-hidden="true">
            {win.dayStarts.map((d) => <span key={d}>{formatDayMonth(new Date(d + 3_600_000), locale)}</span>)}
          </div>
          <div className="vt-row" data-testid="vehicle-timeline-booking">
            <i className="vt-today" style={{ left: `${todayPct}%` }} aria-hidden="true" />
            {booking.map((b) => (
              <span key={b.id} className="vt-bar" data-kind={b.kind} style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} title={`${b.label}\n${formatDateTimeShort(b.start, locale)} → ${formatDateTimeShort(b.end, locale)}`}>
                {b.label}
              </span>
            ))}
          </div>
          {carpool.length > 0 ? (
            <div className="vt-row" data-testid="vehicle-timeline-carpool">
              {carpool.map((b) => (
                <span key={b.id} className="vt-bar" data-kind="carpool" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} title={`${seatsLabel(b.id)}\n${formatDateTimeShort(b.start, locale)} → ${formatDateTimeShort(b.end, locale)}`}>
                  {seatsLabel(b.id)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {booking.length === 0 ? <p className="vt-empty">{T.timelineNoBookings}</p> : null}
    </section>
  );
}
