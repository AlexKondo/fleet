import Link from "next/link";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";

type GanttReservation = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  vehicle: { plate: string } | null;
  trip_request: { destination: string; requester: { full_name: string } | null } | null;
};

// Plain CSS bars over a fixed time window — no charting library needed for something this
// small, and it keeps the dashboard's zero-new-dependency footprint.
export function ReservationGantt({
  reservations,
  locale,
  unknownRequesterLabel,
}: {
  reservations: GanttReservation[];
  locale: Locale;
  unknownRequesterLabel: string;
}) {
  if (reservations.length === 0) return null;

  const starts = reservations.map((r) => new Date(r.start_at).getTime());
  const ends = reservations.map((r) => new Date(r.end_at).getTime());
  // Pad a little on each side so a bar never touches the edge of the chart, and floor/ceil
  // to whole hours so the day gridlines land on clean boundaries.
  const windowStart = Math.floor(Math.min(...starts) / 3_600_000) * 3_600_000;
  const windowEnd = Math.ceil(Math.max(...ends) / 3_600_000) * 3_600_000;
  const windowMs = Math.max(windowEnd - windowStart, 3_600_000);

  const dayTicks: { label: string; leftPercent: number }[] = [];
  for (
    let t = new Date(windowStart).setHours(0, 0, 0, 0);
    t <= windowEnd;
    t += 86_400_000
  ) {
    if (t < windowStart) continue;
    dayTicks.push({
      label: new Date(t).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      leftPercent: ((t - windowStart) / windowMs) * 100,
    });
  }

  const byVehicle = new Map<string, GanttReservation[]>();
  for (const r of reservations) {
    const plate = r.vehicle?.plate ?? "—";
    const bucket = byVehicle.get(plate) ?? [];
    bucket.push(r);
    byVehicle.set(plate, bucket);
  }
  const rows = [...byVehicle.entries()].sort(([a], [b]) => a.localeCompare(b));

  const nowPercent = ((Date.now() - windowStart) / windowMs) * 100;

  return (
    <div className="mb-4 overflow-x-auto rounded-md border border-line-800">
      <div className="min-w-[900px]">
        <div className="relative flex border-b border-line-800 bg-panel-900/60 text-xs text-fog-600">
          <div className="w-28 shrink-0 px-3 py-2 font-medium uppercase tracking-widest">
            Veículo
          </div>
          <div className="relative flex-1 py-2">
            {dayTicks.map((tick) => (
              <span
                key={tick.leftPercent}
                className="absolute -translate-x-1/2 font-mono"
                style={{ left: `${tick.leftPercent}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
        {rows.map(([plate, rowReservations]) => (
          <div key={plate} className="flex border-b border-line-800 last:border-0">
            <div className="flex w-28 shrink-0 items-center px-3 py-3 font-mono text-sm text-paper-50">
              {plate}
            </div>
            <div className="relative flex-1 py-3">
              {dayTicks.map((tick) => (
                <div
                  key={tick.leftPercent}
                  className="absolute top-0 bottom-0 border-l border-line-800/60"
                  style={{ left: `${tick.leftPercent}%` }}
                />
              ))}
              {windowStart < Date.now() && Date.now() < windowEnd ? (
                <div
                  className="absolute top-0 bottom-0 w-px bg-signal-red"
                  style={{ left: `${nowPercent}%` }}
                  title="Agora"
                />
              ) : null}
              {rowReservations.map((r) => {
                const startMs = new Date(r.start_at).getTime();
                const endMs = new Date(r.end_at).getTime();
                const leftPercent = ((startMs - windowStart) / windowMs) * 100;
                const widthPercent = Math.max(((endMs - startMs) / windowMs) * 100, 1.5);
                const requesterName =
                  r.trip_request?.requester?.full_name ?? unknownRequesterLabel;
                const title = `${requesterName} · ${r.trip_request?.destination ?? "—"} · ${formatDateTime(r.start_at, locale)} → ${formatDateTime(r.end_at, locale)}`;
                return (
                  <Link
                    key={r.id}
                    href={`/reservations/${r.id}`}
                    title={title}
                    className={`absolute top-1/2 h-5 -translate-y-1/2 truncate rounded-sm px-1.5 text-[11px] leading-5 text-ink-950 hover:brightness-110 ${
                      r.status === "confirmed" ? "bg-signal-blue" : "bg-gwm-accent"
                    }`}
                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                  >
                    {requesterName}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
