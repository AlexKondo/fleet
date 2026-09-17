import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTime, formatDayMonth } from "@/lib/formatDateTime";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { AppShell } from "../../../AppShell";
import { getStatusMeta } from "../../../dashboard/statusMeta";
import { StatusBadge } from "../../../ui/StatusBadge";

const STATUS_BAR_CLASS: Record<string, string> = {
  confirmed: "bg-signal-teal/70 border-signal-teal",
  pending_approval: "bg-gwm-accent/70 border-gwm-accent hazard-stripe",
  completed: "bg-fog-600/50 border-fog-600",
  cancelled: "bg-fog-800/40 border-fog-700",
};

const DAY_WIDTH_PX = 96;
const ROW_HEIGHT_PX = 44;

/**
 * Vehicle schedule — lets anyone checking whether a car is really free for a given date
 * see its actual calendar instead of trusting a single "Reservado"/"Disponível" badge,
 * which only ever reflects the vehicle's current-moment state, not future bookings (see
 * 0024_time_aware_approval_and_pickup.sql — a vehicle can be legitimately booked for next
 * week while showing "Disponível" today). Rendered as a Gantt-style timeline — a glance at
 * bar positions reads faster than scanning a list of date/time strings row by row.
 */
export default async function VehicleSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();
  const locale = await getLocale();

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // Profile, vehicle and its reservations are all keyed off values already in hand (the
  // user id and the route param) — none depends on the result of another, so all three go
  // out together instead of as three back-to-back round trips.
  const [{ data: profile }, { data: vehicle }, { data: reservationRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase
      .from("vehicles")
      .select(
        "id, plate, name, color, status, category:vehicle_categories(name), current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("reservations")
      .select(
        `id, status, start_at, end_at, impacted_at,
       trip_request:trip_requests(origin, destination, requester:profiles(full_name))`,
      )
      .eq("vehicle_id", id)
      .order("start_at", { ascending: true }),
  ]);

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  if (!profile || !isFleetManager) redirect("/dashboard");

  if (!vehicle) redirect("/fleet");

  const reservations = reservationRows ?? [];
  const meta = getStatusMeta(dict)[vehicle.status];
  const reservationStatusLabel: Record<string, string> = dict.fleet.detail.reservationStatus;
  const now = new Date();

  // Timeline bounds: a few days of padding around today plus whatever the reservations
  // actually span, so a vehicle with no bookings still shows a readable empty week instead
  // of a zero-width chart.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

  const allTimes = reservations.flatMap((r) => [new Date(r.start_at), new Date(r.end_at)]);
  const rangeStart = startOfDay(
    new Date(Math.min(startOfDay(now).getTime(), ...allTimes.map((d) => d.getTime()))),
  );
  const rangeEnd = endOfDay(
    new Date(Math.max(endOfDay(new Date(now.getTime() + 3 * 86400000)).getTime(), ...allTimes.map((d) => d.getTime()))),
  );

  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const totalDays = Math.round(totalMs / 86400000);
  const totalWidthPx = totalDays * DAY_WIDTH_PX;

  const days: Date[] = [];
  for (let d = new Date(rangeStart); d < rangeEnd; d = new Date(d.getTime() + 86400000)) {
    days.push(d);
  }

  const pxFor = (isoDate: string) =>
    ((new Date(isoDate).getTime() - rangeStart.getTime()) / totalMs) * totalWidthPx;

  const todayPx = pxFor(now.toISOString());

  return (
    <AppShell
      active="fleet"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.fleet.detail.title}
    >
      <div className="px-6 py-6">
        <Link href="/fleet" className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent">
          ← {dict.fleet.detail.backToFleet}
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-md border border-line-800 bg-panel-900/60 p-5">
          <div>
            <p className="text-xl text-paper-50">{vehicle.name ?? vehicle.plate}</p>
            <p className="font-mono text-sm text-fog-400">{vehicle.plate}</p>
            <p className="mt-1 text-xs text-fog-400">
              {vehicle.category?.name ?? "—"}
              {vehicle.color ? ` · ${vehicle.color}` : ""} · {vehicle.current_location?.name ?? "—"}
            </p>
          </div>
          <StatusBadge meta={meta} />
        </div>

        <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
            {dict.fleet.detail.scheduleHeading}
          </h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fog-400">
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] border border-signal-teal bg-signal-teal/70" />
              {dict.fleet.detail.reservationStatus.confirmed}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] border border-gwm-accent bg-gwm-accent/70" />
              {dict.fleet.detail.reservationStatus.pending_approval}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] border border-fog-600 bg-fog-600/50" />
              {dict.fleet.detail.reservationStatus.completed}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] border border-fog-700 bg-fog-800/40" />
              {dict.fleet.detail.reservationStatus.cancelled}
            </li>
          </ul>
        </div>

        {reservations.length === 0 ? (
          <p className="text-sm text-fog-400">{dict.fleet.detail.empty}</p>
        ) : (
          <div className="flex overflow-hidden rounded-md border border-line-800 bg-panel-900/60">
            {/* Fixed label column — stays put while only the timeline scrolls horizontally. */}
            <div className="w-56 shrink-0 border-r border-line-800 sm:w-72">
              <div style={{ height: 32 }} className="border-b border-line-800" />
              {reservations.map((r) => (
                <div
                  key={r.id}
                  style={{ height: ROW_HEIGHT_PX }}
                  className="flex flex-col justify-center border-b border-line-800 px-3 last:border-b-0"
                >
                  <p className="truncate text-xs text-paper-50">
                    {r.trip_request?.requester?.full_name ?? "—"}
                  </p>
                  <p className="truncate text-[11px] text-fog-600">
                    {r.trip_request?.origin} → {r.trip_request?.destination}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <div style={{ width: totalWidthPx }} className="relative">
                {/* Date header */}
                <div style={{ height: 32 }} className="flex border-b border-line-800">
                  {days.map((d, i) => (
                    <div
                      key={i}
                      style={{ width: DAY_WIDTH_PX }}
                      className="flex shrink-0 items-center justify-center border-r border-line-800/60 text-[11px] uppercase tracking-widest text-fog-600"
                    >
                      {formatDayMonth(d, locale)}
                    </div>
                  ))}
                </div>

                {/* Day gridlines + "today" marker, spanning the full body height */}
                <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0">
                  {days.map((_, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-r border-line-800/40"
                      style={{ left: i * DAY_WIDTH_PX }}
                    />
                  ))}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-signal-red/70"
                    style={{ left: todayPx }}
                    title={dict.fleet.detail.nowMarker}
                  />
                </div>

                {reservations.map((r) => {
                  const left = pxFor(r.start_at);
                  const width = Math.max(pxFor(r.end_at) - left, 6);
                  return (
                    <div
                      key={r.id}
                      style={{ height: ROW_HEIGHT_PX }}
                      className="relative border-b border-line-800 last:border-b-0"
                    >
                      <div
                        title={`${r.trip_request?.requester?.full_name ?? "—"} · ${r.trip_request?.origin} → ${r.trip_request?.destination}\n${formatDateTime(r.start_at, locale)} → ${formatDateTime(r.end_at, locale)}\n${reservationStatusLabel[r.status] ?? r.status}`}
                        className={`absolute top-1/2 h-6 -translate-y-1/2 rounded-sm border ${STATUS_BAR_CLASS[r.status] ?? "border-line-700 bg-panel-800"}`}
                        style={{ left, width }}
                      />
                      {r.impacted_at ? (
                        <span
                          className="absolute top-1 h-2 w-2 -translate-x-1/2 rounded-full bg-signal-yellow"
                          style={{ left }}
                          title={dict.fleet.detail.impacted}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
