"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import { setGanttZoomPreference, type GanttZoomLevel } from "./ganttZoomActions";

export type GanttBar = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  /** Vehicle plate — the row's stable identity (grouping key), always unique per vehicle
   * even when the name is missing or duplicated. */
  rowPlate: string;
  /** Vehicle name/model, shown above the plate — easier to spot in a lot than a plate
   * alone. Falls back to the plate itself when unset. */
  rowVehicleName: string;
  /** Shown on the bar itself and in its tooltip — e.g. requester name (fleet view) or
   * destination (driver's own trips view). */
  barLabel: string;
  tooltipExtra?: string;
};

// One bar per reservation, colored and iconed by where it actually stands — not just
// pending_approval/confirmed/cancelled/completed, but whether a confirmed one has started
// yet, since "reserved, not picked up" and "out on the road" look identical otherwise.
function barVisual(status: string, startMs: number, endMs: number, now: number): { className: string; icon: string } {
  if (status === "cancelled") return { className: "bg-signal-red/80", icon: "✕" };
  if (status === "completed") return { className: "bg-line-700", icon: "✓" };
  if (status === "pending_approval") return { className: "bg-gwm-accent", icon: "?" };
  // confirmed
  if (now < startMs) return { className: "bg-fog-600", icon: "🕐" };
  if (now > endMs) return { className: "bg-signal-blue", icon: "▶" };
  return { className: "bg-signal-blue", icon: "▶" };
}

// Pixels-per-day per zoom level — "zoom in" (week) spreads days out for detail, "zoom out"
// (quarter) compresses them to see more at a glance. The scrollable container (set by the
// caller with overflow-x-auto) handles anything wider than the viewport.
const PX_PER_DAY: Record<GanttZoomLevel, number> = { week: 140, month: 44, quarter: 16 };
const ZOOM_ORDER: GanttZoomLevel[] = ["quarter", "month", "week"];

// Plain CSS bars over a fixed time window — no charting library needed for something this
// small, and it keeps the app's zero-new-dependency footprint.
export function ReservationGantt({
  bars,
  locale,
  rowHeading,
  initialZoom,
}: {
  bars: GanttBar[];
  locale: Locale;
  rowHeading: string;
  initialZoom: GanttZoomLevel;
}) {
  const [zoom, setZoom] = useState<GanttZoomLevel>(initialZoom);

  function changeZoom(next: GanttZoomLevel) {
    setZoom(next);
    void setGanttZoomPreference(next);
  }

  if (bars.length === 0) return null;

  const starts = bars.map((r) => new Date(r.start_at).getTime());
  const ends = bars.map((r) => new Date(r.end_at).getTime());
  // Pad a little on each side so a bar never touches the edge of the chart, and floor/ceil
  // to whole days so the day gridlines land on clean boundaries.
  const windowStart = new Date(Math.min(...starts)).setHours(0, 0, 0, 0);
  const windowEndRaw = new Date(Math.max(...ends)).setHours(0, 0, 0, 0) + 86_400_000;
  // Grid always reaches at least a year out from the earliest reservation, even when every
  // bar sits in the first few weeks of it — otherwise the gridlines (and the ability to
  // scroll forward and see "nothing booked yet") stopped dead at the last bar.
  const windowEnd = Math.max(windowEndRaw, windowStart + 365 * 86_400_000);
  const totalDays = Math.round((windowEnd - windowStart) / 86_400_000);
  const pxPerDay = PX_PER_DAY[zoom];
  const totalWidth = totalDays * pxPerDay;

  const dayTicks: { label: string; left: number }[] = [];
  for (let d = 0; d <= totalDays; d++) {
    const t = windowStart + d * 86_400_000;
    dayTicks.push({
      label: new Date(t).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      left: d * pxPerDay,
    });
  }

  const byRow = new Map<string, { vehicleName: string; plate: string; bars: GanttBar[] }>();
  for (const r of bars) {
    const bucket = byRow.get(r.rowPlate) ?? { vehicleName: r.rowVehicleName, plate: r.rowPlate, bars: [] };
    bucket.bars.push(r);
    byRow.set(r.rowPlate, bucket);
  }
  const rows = [...byRow.values()].sort((a, b) => a.vehicleName.localeCompare(b.vehicleName));

  const nowLeft = ((Date.now() - windowStart) / 86_400_000) * pxPerDay;
  const zoomIndex = ZOOM_ORDER.indexOf(zoom);

  return (
    <div className="mb-4 rounded-md border border-line-800">
      <div className="flex items-center justify-end gap-1 border-b border-line-800 bg-panel-900/60 px-2 py-1.5">
        <button
          type="button"
          onClick={() => changeZoom(ZOOM_ORDER[Math.max(zoomIndex - 1, 0)]!)}
          disabled={zoomIndex === 0}
          title="Diminuir zoom"
          aria-label="Diminuir zoom"
          className="rounded-sm border border-line-700 px-2 py-1 text-xs text-fog-400 hover:border-gwm-accent hover:text-gwm-accent disabled:opacity-40"
        >
          −
        </button>
        <span className="w-16 text-center text-[11px] uppercase tracking-widest text-fog-600">
          {zoom === "week" ? "Semana" : zoom === "month" ? "Mês" : "Trimestre"}
        </span>
        <button
          type="button"
          onClick={() => changeZoom(ZOOM_ORDER[Math.min(zoomIndex + 1, ZOOM_ORDER.length - 1)]!)}
          disabled={zoomIndex === ZOOM_ORDER.length - 1}
          title="Aumentar zoom"
          aria-label="Aumentar zoom"
          className="rounded-sm border border-line-700 px-2 py-1 text-xs text-fog-400 hover:border-gwm-accent hover:text-gwm-accent disabled:opacity-40"
        >
          +
        </button>
      </div>
      <div className="gantt-scroll overflow-x-scroll">
        <div style={{ width: totalWidth + 144 }}>
          <div className="relative flex border-b border-line-800 bg-panel-900/60 text-xs text-fog-600">
            <div className="w-36 shrink-0 px-3 py-2 font-medium uppercase tracking-widest">
              {rowHeading}
            </div>
            <div className="relative py-2" style={{ width: totalWidth }}>
              {dayTicks.map((tick) => (
                <span
                  key={tick.left}
                  className="absolute -translate-x-1/2 font-mono"
                  style={{ left: tick.left }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {rows.map(({ vehicleName, plate, bars: rowBars }) => (
            <div key={plate} className="flex border-b border-line-800 last:border-0">
              <div className="flex w-36 shrink-0 flex-col justify-center px-3 py-3">
                <span className="truncate text-sm text-paper-50">{vehicleName}</span>
                <span className="font-mono text-xs text-fog-600">{plate}</span>
              </div>
              <div className="relative py-3" style={{ width: totalWidth }}>
                {dayTicks.map((tick) => (
                  <div
                    key={tick.left}
                    className="absolute top-0 bottom-0 border-l border-line-800/60"
                    style={{ left: tick.left }}
                  />
                ))}
                {windowStart < Date.now() && Date.now() < windowEnd ? (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-signal-red"
                    style={{ left: nowLeft }}
                    title="Agora"
                  />
                ) : null}
                {rowBars.map((r) => {
                  const startMs = new Date(r.start_at).getTime();
                  const endMs = new Date(r.end_at).getTime();
                  const left = ((startMs - windowStart) / 86_400_000) * pxPerDay;
                  const width = Math.max(((endMs - startMs) / 86_400_000) * pxPerDay, 20);
                  const visual = barVisual(r.status, startMs, endMs, Date.now());
                  const title = `${r.barLabel}${r.tooltipExtra ? ` · ${r.tooltipExtra}` : ""} · ${formatDateTime(r.start_at, locale)} → ${formatDateTime(r.end_at, locale)}`;
                  return (
                    <Link
                      key={r.id}
                      href={`/reservations/${r.id}`}
                      title={title}
                      className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 truncate rounded-sm px-1.5 text-[11px] leading-5 text-ink-950 hover:brightness-110 ${visual.className}`}
                      style={{ left, width }}
                    >
                      <span aria-hidden="true">{visual.icon}</span>
                      <span className="truncate">{r.barLabel}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
