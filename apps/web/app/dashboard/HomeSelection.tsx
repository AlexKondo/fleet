"use client";
import { createContext, useContext, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n/locales";
import type { FleetKey } from "@/lib/i18n/areas/fleet";
import { TimelineHeader, TimelineLane } from "../fleet/VehicleTimeline";
import type { TimelineBooking } from "../fleet/timelineLayout";
import { FmCalendarIcon, FmGaugeIcon, FmPinIcon, FmBatteryIcon, FmFuelIcon } from "../fmIcons";
import { ReservationActions } from "./ReservationActions";

/** One reservation of the chart, with everything the detail panel shows (all prepared on the server). */
export interface HomeItem {
  id: string;
  statusLabel: string;
  tone: string;
  startLabel: string;
  endLabel: string;
  origin: string;
  destination: string;
  vehicleName: string;
  plate: string;
  location: string | null;
  battery: number | null;
  fuel: number | null;
  odometer: string | null;
  /** only a confirmed reservation has Saída / Retorno buttons */
  showOps: boolean;
  /** the traveler's pickup checklist is recorded but the gate has not released the vehicle yet */
  awaitingGate: boolean;
  /** the mobility point of this vehicle has the gate do the full check-in / check-out */
  gateDoes: boolean;
  canPickup: boolean;
  canReturn: boolean;
}

export interface HomeLabels {
  departure: string;
  ret: string;
  placeholder: string;
  awaitingGate: string;
  gateDoes: string;
  viewDetails: string;
  pickup: string;
  returnAction: string;
  location: string;
  battery: string;
  fuel: string;
  odometer: string;
}

interface Selection {
  selectedId: string | null;
  select: (id: string | null) => void;
  items: Map<string, HomeItem>;
  labels: HomeLabels;
}
const Ctx = createContext<Selection | null>(null);

/** Shares "which reservation was tapped" between the chart (main column) and the detail panel (side column / under the chart on small screens). */
export function HomeSelectionProvider({ items, labels, initialId = null, children }: { items: HomeItem[]; labels: HomeLabels; initialId?: string | null; children: React.ReactNode }) {
  const [selectedId, select] = useState<string | null>(initialId);
  const value = useMemo(() => ({ selectedId, select, items: new Map(items.map((i) => [i.id, i] as const)), labels }), [selectedId, items, labels]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useSel(): Selection {
  const v = useContext(Ctx);
  if (!v) throw new Error("HomeSelectionProvider is missing");
  return v;
}

/** The chart of the person's reservations: a tap on a row or on a bar selects that reservation. */
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
  const { selectedId, select } = useSel();
  // a tap on the row picks the reservation of that vehicle that is running now, else the next one, else the last one
  const pick = (bookings: TimelineBooking[]) => {
    const t = now;
    const running = bookings.find((b) => Date.parse(b.start) <= t && t < Date.parse(b.end));
    const next = [...bookings].filter((b) => Date.parse(b.start) > t).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
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
          {rows.map((v) => {
            const on = v.bookings.some((b) => b.id === selectedId);
            return (
              <li
                key={v.id}
                className="vw-row vw-grid-row"
                data-selected={on ? "true" : undefined}
                onClick={() => select(pick(v.bookings))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(pick(v.bookings)); } }}
                tabIndex={0}
                role="button"
                aria-pressed={on}
              >
                <div className="vw-rowmain"><span><strong>{v.name}</strong><small>{v.plate}</small></span></div>
                <TimelineLane bookings={v.bookings} locale={locale} T={T} now={now} plate={v.plate} onSelect={(id) => select(id)} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The details of the tapped reservation (departure, return, vehicle...); empty hint until something is tapped. */
export function HomeDetailPanel({ variant }: { variant: "desktop" | "mobile" }) {
  const { selectedId, items, labels } = useSel();
  const it = selectedId ? items.get(selectedId) : undefined;
  // on small screens the panel only takes space once something was tapped
  if (variant === "mobile" && !it) return null;
  return (
    <section className={`fm-card hm-card hm-next ${variant === "desktop" ? "hm-next-desktop" : "hm-next-mobile"}`} aria-live="polite" data-testid={`home-detail-${variant}`}>
      {!it ? (
        <p className="hm-muted">{labels.placeholder}</p>
      ) : (
        <div className="hm-next-body">
          <div className="hm-next-vehicle">
            <div>
              <p className="hm-next-name">{it.vehicleName}</p>
              <p className="hm-plate">{it.plate}</p>
              <p className="hm-muted hm-route">{it.origin} → {it.destination}</p>
            </div>
            <span className="fm-pill" data-tone={it.tone}>{it.statusLabel}</span>
          </div>
          <dl className="hm-detail-times">
            <div><dt><FmCalendarIcon /> {labels.departure}</dt><dd>{it.startLabel}</dd></div>
            <div><dt><FmCalendarIcon /> {labels.ret}</dt><dd>{it.endLabel}</dd></div>
          </dl>
          <dl className="hm-next-facts">
            {it.location ? <div><dt><FmPinIcon /><span className="fm-sr-only">{labels.location}</span></dt><dd>{it.location}</dd></div> : null}
            {it.battery !== null ? <div><dt><FmBatteryIcon /><span className="fm-sr-only">{labels.battery}</span></dt><dd>{it.battery}%</dd></div> : null}
            {it.fuel !== null ? <div><dt><FmFuelIcon /><span className="fm-sr-only">{labels.fuel}</span></dt><dd>{it.fuel}%</dd></div> : null}
            {it.odometer ? <div><dt><FmGaugeIcon /><span className="fm-sr-only">{labels.odometer}</span></dt><dd>{it.odometer}</dd></div> : null}
          </dl>
          <ReservationActions id={it.id} viewDetails={labels.viewDetails} pickup={labels.pickup} returnLabel={labels.returnAction} showOps={it.showOps} canPickup={it.canPickup} canReturn={it.canReturn} hint={it.gateDoes ? labels.gateDoes : it.awaitingGate ? labels.awaitingGate : null} />
        </div>
      )}
    </section>
  );
}
