import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatDateTimeShort } from "@/lib/formatDateTime";
import { carpoolStatusText, fillTemplate } from "@/lib/carpool/errorText";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import type { Locale } from "../../lib/i18n/locales";
import { FmShell } from "../carpool/FmShell";
import {
  FmAlertIcon,
  FmCalendarIcon,
  FmFuelIcon,
  FmGaugeIcon,
  FmBatteryIcon,
  FmPinIcon,
  FmUsersIcon,
} from "../fmIcons";
import { loadMyChecklistStates } from "@/lib/operations/checklistState";
import { ReservationActions } from "./ReservationActions";
import { HomeGantt } from "./HomeGantt";
import { openReservationsNearestFirst } from "@/lib/trips/homeReservations";
import { byNextReservation } from "@/lib/trips/ganttOrder";
import { timelineWindow, type TimelineBooking } from "../fleet/timelineLayout";
import { loadTripRiders } from "@/lib/carpool/tripRiders";
import { fleetTexts } from "@/lib/i18n/areas/fleet";
import "../fleet/vehicle-workspace.css";
import type { StatusMeta } from "./statusMeta";
import "./home.css";

/** What the dashboard already loaded for the fleet cards (same query the manager view uses). */
export interface HomeVehicle {
  row: {
    id: string;
    plate: string;
    status: string;
    odometer_km: number;
    fuel_level_percent: number | null;
    battery_level_percent: number | null;
    category: { name: string; energy_type: string } | null;
    current_location: { name: string } | null;
  };
  attention: string[];
}

const TZ = "America/Sao_Paulo";
function timeOf(iso: string, locale: Locale) {
  return new Date(iso).toLocaleTimeString(locale, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

/**
 * SCR-USR-001 "Home" — what an employee sees on /dashboard. Real data only: the employee's next reservation, their
 * live carpool requests, the vehicles they reserved most often (a count of their own reservations) and the same
 * fleet vehicle cards / attention list the page showed before. No map, rating, match score or CO2 figure: the
 * product has no such data.
 */
export async function EmployeeHome({
  userId,
  userName,
  orgName,
  dict,
  locale,
  vehicles,
  fleetActionError,
  actionSuccess,
}: {
  userId: string;
  userName: string;
  orgName: string;
  dict: Dictionary;
  locale: Locale;
  vehicles: HomeVehicle[];
  vehiclesError?: boolean;
  statusMeta?: Record<string, StatusMeta>;
  attentionLabels?: Record<string, string>;
  fleetActionError: boolean;
  actionSuccess: boolean;
}) {
  const t = dict.dashboard;
  const h = t.home;
  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();

  // The chart of the employee's own reservations (the same window as the fleet schedule), one row per vehicle they reserved; the list below it comes from the same rows.
  const [{ data: myRequests, error: carpoolRequestsError }, { data: chartRows, error: chartError }] = await Promise.all([
    supabase
      .from("carpool_ride_requests")
      .select("id, status, requested_departure_at")
      .eq("rider_id", userId)
      .in("status", ["PENDING", "ACCEPTED"])
      .gte("requested_departure_at", nowIso)
      .order("requested_departure_at", { ascending: true })
      .limit(3),
    supabase
      .from("reservations")
      .select("id, status, start_at, end_at, impacted_at, impacted_reason, trip_request_id, trip_request:trip_requests!inner(origin, destination, requester_id), vehicle:vehicles(id, plate, name, status)")
      .eq("trip_request.requester_id", userId)
      .in("status", ["pending_approval", "confirmed", "completed"])
      .gte("end_at", new Date(timelineWindow(Date.now()).start).toISOString())
      .order("start_at", { ascending: true }),
  ]);

  const byId = new Map(vehicles.map((v) => [v.row.id, v] as const));
  // What each confirmed reservation allows NOW comes from the checklist state (the same source as the reservation page): Saída only before the vehicle left,
  // Retorno only after it left and before it came back. Without the state (it failed to load) the vehicle status decides, as before.
  const confirmedIds = (chartRows ?? []).filter((r) => r.status === "confirmed").map((r) => r.id);
  const checklistStates = confirmedIds.length > 0 ? await loadMyChecklistStates(supabase, confirmedIds) : new Map();
  const nowMs = Date.now();
  const T = fleetTexts[locale];
  // the carpool of these trips: the little person on the bar blinks while a request waits for this person's answer, and stays still once somebody is going along
  const ridersByTrip = await loadTripRiders(supabase, Array.from(new Set((chartRows ?? []).map((r) => r.trip_request_id).filter((x): x is string => Boolean(x)))));
  const chartByVehicle = new Map<string, { id: string; plate: string; name: string | null; bookings: TimelineBooking[] }>();
  for (const r of chartRows ?? []) {
    if (!r.vehicle) continue;
    const row = chartByVehicle.get(r.vehicle.id) ?? { id: r.vehicle.id, plate: r.vehicle.plate, name: r.vehicle.name, bookings: [] };
    const riders = r.trip_request_id ? ridersByTrip.get(r.trip_request_id) : undefined;
    row.bookings.push({
      id: r.id, start: r.start_at, end: r.end_at, status: r.status, label: r.trip_request?.destination ?? "",
      carpool: riders?.seats && riders.taken > 0 ? { seats: riders.seats, taken: riders.taken } : undefined,
      carpoolWaiting: riders?.waiting ?? 0,
    });
    chartByVehicle.set(r.vehicle.id, row);
  }
  const chartVehicles = byNextReservation([...chartByVehicle.values()], (v) => v.bookings, nowMs);
  const energyShows = (e: string | undefined, kinds: string[]) => (e ? kinds.includes(e) : false);
  const stateOf = (id: string) => checklistStates?.get(id);
  const isOut = (r: { id: string; status: string }) => {
    const st = stateOf(r.id);
    return r.status === "confirmed" && Boolean(st && (st.own_pickup || st.pickup_traveler || st.legacy_pickup) && !(st.own_return || st.return_traveler));
  };
  const openRows = openReservationsNearestFirst(chartRows ?? [], isOut, nowMs);
  const next = openRows[0] ?? null;
  const listed = openRows.flatMap((r) => {
    if (!r.vehicle) return [];
    const hv = byId.get(r.vehicle.id);
    const energy = hv?.row.category?.energy_type;
    const confirmed = r.status === "confirmed";
    const st = stateOf(r.id);
    const sameDay = formatDate(r.start_at, locale) === formatDate(r.end_at, locale);
    return [{
      id: r.id,
      statusLabel: (dict.trips.statuses as Record<string, string>)[r.status] ?? r.status,
      tone: confirmed ? "ok" : "warn",
      startLabel: formatDateTimeShort(r.start_at, locale),
      endLabel: sameDay ? timeOf(r.end_at, locale) : formatDateTimeShort(r.end_at, locale),
      origin: r.trip_request?.origin ?? "—",
      destination: r.trip_request?.destination ?? "—",
      vehicleName: r.vehicle.name ?? r.vehicle.plate,
      plate: r.vehicle.plate,
      location: hv?.row.current_location?.name ?? null,
      battery: energyShows(energy, ["BEV", "PHEV"]) ? hv?.row.battery_level_percent ?? null : null,
      fuel: energyShows(energy, ["ICE", "HEV", "PHEV"]) ? hv?.row.fuel_level_percent ?? null : null,
      odometer: hv ? `${hv.row.odometer_km.toLocaleString(locale)} km` : null,
      showOps: confirmed,
      hint: st?.checklist_by === "gate" ? h.detailGateDoes
        : st && st.workflow !== "key_custody" && st.pickup_traveler && !st.departed && !(st.own_return || st.return_traveler) ? h.detailAwaitingGate
        : null,
      canPickup: confirmed && new Date(r.end_at).getTime() > nowMs && (st ? st.can_pickup : r.vehicle.status === "reserved" || r.vehicle.status === "awaiting_pickup"),
      canReturn: confirmed && (st ? st.can_return : r.vehicle.status === "in_use"),
    }];
  });

  const firstName = (userName.split(" ")[0] ?? userName).trim() || userName;

  return (
    <FmShell active="dashboard" orgName={orgName} userName={userName} role="employee" isFleetManager={false} isAdministrator={false}>
      <div className="hm" data-testid="employee-home">
        {fleetActionError ? (
          <div role="alert" className="fm-banner fm-banner-danger hm-banner">
            <span>{t.actionError}</span>{" "}
            <Link href="/dashboard" className="hm-link">{t.dismissBanner}</Link>
          </div>
        ) : null}
        {actionSuccess ? (
          <div role="status" className="fm-banner hm-banner">
            <span>{t.actionSuccess}</span>{" "}
            <Link href="/dashboard" className="hm-link">{t.dismissBanner}</Link>
          </div>
        ) : null}

        <h1 className="fm-title">{fillTemplate(h.greeting, { name: firstName })}</h1>
        <p className="fm-subtitle">{h.greetingSub}</p>

        <div className="hm-grid">
          <div className="hm-col-main">
            {carpoolRequestsError ? (
              <section className="fm-card hm-card" role="alert" data-testid="home-carpools-error">
                <h2 className="fm-h2">{h.carpoolTitle}</h2>
                <p className="fm-error">{t.vehicles.loadError}</p>
              </section>
            ) : myRequests && myRequests.length > 0 ? (
              <section className="fm-card hm-card" aria-labelledby="hm-carpool" data-testid="home-carpools">
                <div className="hm-card-head">
                  <h2 id="hm-carpool" className="fm-h2">{h.carpoolTitle}</h2>
                  <Link href="/trips" className="hm-link">{h.viewAll}</Link>
                </div>
                <ul className="hm-list">
                  {myRequests.map((r) => (
                    <li key={r.id} className="hm-row" data-testid="home-carpool-request">
                      <span className="hm-row-icon"><FmUsersIcon /></span>
                      <span className="hm-row-main">
                        <strong>{fillTemplate(dict.carpool.rider.requestedFor, { time: formatDateTimeShort(r.requested_departure_at, locale) })}</strong>
                      </span>
                      <span className="fm-pill" data-tone={r.status === "ACCEPTED" ? "ok" : "info"}>
                        {carpoolStatusText(dict, r.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {next?.impacted_at || next?.status === "pending_approval" ? (
              <section className="fm-card hm-card" aria-label={dict.reservations.detail.impactedTitle} data-testid="home-alerts">
                {next?.impacted_at ? (
                  <p className="hm-alert" role="status">
                    <span className="hm-alert-icon"><FmAlertIcon /></span>
                    <span>
                      <strong>{dict.reservations.detail.impactedTitle}</strong>{" "}
                      {next.impacted_reason ?? dict.reservations.detail.impactedDefaultReason}
                    </span>
                  </p>
                ) : null}
                {next?.status === "pending_approval" ? (
                  <p className="hm-alert" role="status">
                    <span className="hm-alert-icon"><FmAlertIcon /></span>
                    <span>{h.alertAwaiting}</span>
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="fm-card hm-card vw hm-gantt" aria-labelledby="hm-gantt" data-testid="home-reservations-gantt">
              <h2 id="hm-gantt" className="fm-h2">{h.actionTrips}</h2>
              {chartError ? (
                <p className="fm-error" role="alert">{t.vehicles.loadError}</p>
              ) : chartVehicles.length === 0 ? (
                <p className="hm-muted">{h.nextEmpty}</p>
              ) : (
                <HomeGantt rows={chartVehicles.map((v) => ({ id: v.id, name: v.name ?? v.plate, plate: v.plate, bookings: v.bookings }))} locale={locale} T={T} now={nowMs} headLabel={T.listHeadVehicle} />
              )}
            </section>

            <section className="fm-card hm-card hm-next" aria-labelledby="hm-next">
              <div className="hm-card-head">
                <h2 id="hm-next" className="fm-h2">{listed.length > 1 ? h.nextTitleMany : h.nextTitle}</h2>
              </div>
              {chartError ? (
                <p className="fm-error" role="alert" data-testid="home-next-error">{t.vehicles.loadError}</p>
              ) : listed.length > 0 ? (
                <ul className="hm-next-list" data-testid="home-reservations">
                  {listed.map((it, index) => (
                    <li key={it.id} className="hm-next-body" data-testid={index === 0 ? "home-next-reservation" : "home-later-reservation"}>
                      <div className="hm-next-when">
                        <span className="hm-next-icon"><FmCalendarIcon /></span>
                        <span>
                          <strong>{it.startLabel}</strong>
                          <span className="hm-muted"> → {it.endLabel}</span>
                        </span>
                      </div>
                      <div className="hm-next-vehicle">
                        <div>
                          <p className="hm-next-name">{it.vehicleName}</p>
                          <p className="hm-plate">{it.plate}</p>
                          <p className="hm-muted hm-route">{it.origin} → {it.destination}</p>
                        </div>
                        <span className="fm-pill" data-tone={it.tone}>{it.statusLabel}</span>
                      </div>
                      <dl className="hm-next-facts">
                        {it.location ? <div><dt><FmPinIcon /><span className="fm-sr-only">{t.vehicles.currentLocation}</span></dt><dd>{it.location}</dd></div> : null}
                        {it.battery !== null ? <div><dt><FmBatteryIcon /><span className="fm-sr-only">{t.vehicles.battery}</span></dt><dd>{it.battery}%</dd></div> : null}
                        {it.fuel !== null ? <div><dt><FmFuelIcon /><span className="fm-sr-only">{t.vehicles.fuel}</span></dt><dd>{it.fuel}%</dd></div> : null}
                        {it.odometer ? <div><dt><FmGaugeIcon /><span className="fm-sr-only">{t.vehicles.odometer}</span></dt><dd>{it.odometer}</dd></div> : null}
                      </dl>
                      <ReservationActions id={it.id} viewDetails={h.viewDetails} pickup={dict.trips.list.startPickup} returnLabel={dict.trips.list.registerReturn} showOps={it.showOps} canPickup={it.canPickup} canReturn={it.canReturn} hint={it.hint} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="hm-empty">
                  <p className="hm-muted">{h.nextEmpty}</p>
                </div>
              )}
            </section>
          </div>
        </div>

      </div>
    </FmShell>
  );
}
