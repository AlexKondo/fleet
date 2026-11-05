"use client";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/locales";
import type { FleetKey } from "@/lib/i18n/areas/fleet";
import { TimelineHeader, TimelineLane } from "../fleet/VehicleTimeline";
import type { TimelineBooking } from "../fleet/timelineLayout";

/** The chart of the person's reservations: a tap on a bar, or on a row, opens that reservation. */
export function HomeGantt({
  rows,
  locale,
  T,
  now,
  headLabel,
}: {
  rows: { id: string; name: string; plate: string; bookings: TimelineBooking[] }[];
  locale: Locale;
  T: Record<FleetKey, string>;
  now: number;
  headLabel: string;
}) {
  const router = useRouter();
  const open = (id: string | null) => {
    if (id) router.push(`/reservations/${id}`);
  };
  // a tap on the row picks the reservation of that vehicle that is running now, else the next one, else the last one
  const pick = (bookings: TimelineBooking[]) => {
    const running = bookings.find((b) => Date.parse(b.start) <= now && now < Date.parse(b.end));
    const next = [...bookings].filter((b) => Date.parse(b.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    return (running ?? next ?? bookings[bookings.length - 1])?.id ?? null;
  };
  return (
    <div className="vw-scroll">
      <div className="vw-grid">
        <div className="vw-list-heading vw-grid-row">
          <div className="vw-rowmain"><strong>{headLabel}</strong></div>
          <TimelineHeader locale={locale} T={T} now={now} />
        </div>
        <ul>
          {rows.map((v) => (
            <li
              key={v.id}
              className="vw-row vw-grid-row"
              onClick={() => open(pick(v.bookings))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(pick(v.bookings)); } }}
              tabIndex={0}
              role="button"
            >
              <div className="vw-rowmain"><span><strong>{v.name}</strong><small>{v.plate}</small></span></div>
              <TimelineLane bookings={v.bookings} locale={locale} T={T} now={now} plate={v.plate} onSelect={open} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
