import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import { carpoolStatusText, fillTemplate } from "@/lib/carpool/errorText";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import type { Locale } from "../../lib/i18n/locales";
import { FmShell } from "../carpool/FmShell";
import {
  FmAlertIcon,
  FmCalendarIcon,
  FmCarIcon,
  FmChevronIcon,
  FmFuelIcon,
  FmGaugeIcon,
  FmBatteryIcon,
  FmPinIcon,
  FmUsersIcon,
} from "../fmIcons";
import { HomeDetailPanel, HomeGantt, HomeSelectionProvider, type HomeItem, type HomeLabels } from "./HomeSelection";
import { timelineWindow, type TimelineBooking } from "../fleet/timelineLayout";
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

  // Next reservation: the earliest still-open one that has not ended (own query, so it never depends on how many past rows exist).
  // The chart of the employee's own reservations (the same window as the fleet schedule), one row per vehicle they reserved.
  const [{ data: nextRows, error: nextReservationError }, { data: myRequests, error: carpoolRequestsError }, { data: chartRows, error: chartError }] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        `id, status, start_at, end_at, impacted_at, impacted_reason,
         trip_request:trip_requests!inner(origin, destination, requester_id),
         vehicle:vehicles(id, plate, name, status)`,
      )
      .eq("trip_request.requester_id", userId)
      .in("status", ["pending_approval", "confirmed"])
      .gte("end_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(1),
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
      .select("id, status, start_at, end_at, trip_request:trip_requests!inner(origin, destination, requester_id), vehicle:vehicles(id, plate, name, status)")
      .eq("trip_request.requester_id", userId)
      .in("status", ["pending_approval", "confirmed", "completed"])
      .gte("end_at", new Date(timelineWindow(Date.now()).start).toISOString())
      .order("start_at", { ascending: true }),
  ]);

  const next = nextRows?.[0] ?? null;
  const byId = new Map(vehicles.map((v) => [v.row.id, v] as const));
  const nextVehicle = next?.vehicle ? byId.get(next.vehicle.id) : undefined;

  // Same conditions as the reservation detail page (the checklist pages re-check them server-side).
  const vStatus = next?.vehicle?.status;
  // FIX-VENCIDAS R2: no pickup once the reservation window has ended (same rule as fm_checklist_state, 0208).
  const canPickup =
    next?.status === "confirmed" &&
    (vStatus === "reserved" || vStatus === "awaiting_pickup") &&
    new Date(next.end_at).getTime() > Date.now();
  const canReturn = next?.status === "confirmed" && vStatus === "in_use";

  const nowMs = Date.now();
  const T = fleetTexts[locale];
  const chartByVehicle = new Map<string, { id: string; plate: string; name: string | null; bookings: TimelineBooking[] }>();
  for (const r of chartRows ?? []) {
    if (!r.vehicle) continue;
    const row = chartByVehicle.get(r.vehicle.id) ?? { id: r.vehicle.id, plate: r.vehicle.plate, name: r.vehicle.name, bookings: [] };
    row.bookings.push({ id: r.id, start: r.start_at, end: r.end_at, status: r.status, label: r.trip_request?.destination ?? "" });
    chartByVehicle.set(r.vehicle.id, row);
  }
  const chartVehicles = [...chartByVehicle.values()];
  const energyShows = (e: string | undefined, kinds: string[]) => (e ? kinds.includes(e) : false);
  const homeItems: HomeItem[] = (chartRows ?? []).flatMap((r) => {
    if (!r.vehicle) return [];
    const hv = byId.get(r.vehicle.id);
    const energy = hv?.row.category?.energy_type;
    const confirmed = r.status === "confirmed";
    return [{
      id: r.id,
      statusLabel: (dict.trips.statuses as Record<string, string>)[r.status] ?? r.status,
      tone: confirmed ? "ok" : r.status === "pending_approval" ? "warn" : r.status === "cancelled" ? "bad" : "neutral",
      startLabel: formatDateTimeShort(r.start_at, locale),
      endLabel: formatDateTimeShort(r.end_at, locale),
      origin: r.trip_request?.origin ?? "—",
      destination: r.trip_request?.destination ?? "—",
      vehicleName: r.vehicle.name ?? r.vehicle.plate,
      plate: r.vehicle.plate,
      location: hv?.row.current_location?.name ?? null,
      battery: energyShows(energy, ["BEV", "PHEV"]) ? hv?.row.battery_level_percent ?? null : null,
      fuel: energyShows(energy, ["ICE", "HEV", "PHEV"]) ? hv?.row.fuel_level_percent ?? null : null,
      odometer: hv ? `${hv.row.odometer_km.toLocaleString(locale)} km` : null,
      canPickup: confirmed && (r.vehicle.status === "reserved" || r.vehicle.status === "awaiting_pickup") && new Date(r.end_at).getTime() > nowMs,
      canReturn: confirmed && r.vehicle.status === "in_use",
    }];
  });
  const homeLabels: HomeLabels = {
    departure: h.detailDeparture, ret: h.detailReturn, placeholder: h.detailPlaceholder, viewDetails: h.viewDetails,
    pickup: dict.trips.list.startPickup, returnAction: dict.trips.list.registerReturn,
    location: t.vehicles.currentLocation, battery: t.vehicles.battery, fuel: t.vehicles.fuel, odometer: t.vehicles.odometer,
  };

  const firstName = (userName.split(" ")[0] ?? userName).trim() || userName;
  const nextTone = next?.status === "confirmed" ? "ok" : "warn";

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

        <HomeSelectionProvider items={homeItems} labels={homeLabels}>
        <div className="hm-grid">
          <div className="hm-col-main">
            <nav className="hm-actions" aria-label={h.quickActions} data-testid="home-quick-actions">
              <Link href="/trips/new" className="hm-action" data-tone="blue">
                <span className="hm-action-icon"><FmCarIcon /></span>
                <span className="hm-action-text">
                  <strong>{h.actionBook}</strong>
                  <small>{h.actionBookHint}</small>
                </span>
              </Link>
            </nav>

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

            <HomeDetailPanel variant="mobile" />

            <section className="fm-card hm-card hm-next" aria-labelledby="hm-next-d">
              <NextReservation idSuffix="d" />
            </section>
          </div>

          <aside className="hm-col-side" aria-label={h.actionTrips}>
            <HomeDetailPanel variant="desktop" />
          </aside>
        </div>
        </HomeSelectionProvider>

      </div>
    </FmShell>
  );

  /** The "next reservation" card; rendered twice (mobile slot / desktop aside), only one is visible per breakpoint. */
  function NextReservation({ idSuffix }: { idSuffix: string }) {
    return (
      <>
        <div className="hm-card-head">
          <h2 id={`hm-next-${idSuffix}`} className="fm-h2">{h.nextTitle}</h2>
          <Link href="/trips" className="hm-link">{h.viewAll}</Link>
        </div>
        {nextReservationError ? (
          <p className="fm-error" role="alert" data-testid={`home-next-error-${idSuffix}`}>{t.vehicles.loadError}</p>
        ) : next ? (
          <div className="hm-next-body" data-testid={idSuffix === "d" ? "home-next-reservation" : "home-next-reservation-mobile"}>
            <div className="hm-next-when">
              <span className="hm-next-icon"><FmCalendarIcon /></span>
              <span>
                <strong>{formatDateTimeShort(next.start_at, locale)}</strong>
                <span className="hm-muted"> → {timeOf(next.end_at, locale)}</span>
              </span>
            </div>
            <div className="hm-next-vehicle">
              <div>
                <p className="hm-next-name">{next.vehicle?.name ?? next.vehicle?.plate ?? "—"}</p>
                <p className="hm-plate">{next.vehicle?.plate}</p>
                <p className="hm-muted hm-route">{next.trip_request?.origin} → {next.trip_request?.destination}</p>
              </div>
              <span className="fm-pill" data-tone={nextTone}>
                {(dict.trips.statuses as Record<string, string>)[next.status] ?? next.status}
              </span>
            </div>
            {nextVehicle ? (
              <dl className="hm-next-facts">
                {nextVehicle.row.current_location ? (
                  <div><dt><FmPinIcon /><span className="fm-sr-only">{t.vehicles.currentLocation}</span></dt><dd>{nextVehicle.row.current_location.name}</dd></div>
                ) : null}
                {nextVehicle.row.battery_level_percent !== null && (nextVehicle.row.category?.energy_type === "BEV" || nextVehicle.row.category?.energy_type === "PHEV") ? (
                  <div><dt><FmBatteryIcon /><span className="fm-sr-only">{t.vehicles.battery}</span></dt><dd>{nextVehicle.row.battery_level_percent}%</dd></div>
                ) : null}
                {nextVehicle.row.fuel_level_percent !== null && (nextVehicle.row.category?.energy_type === "ICE" || nextVehicle.row.category?.energy_type === "HEV" || nextVehicle.row.category?.energy_type === "PHEV") ? (
                  <div><dt><FmFuelIcon /><span className="fm-sr-only">{t.vehicles.fuel}</span></dt><dd>{nextVehicle.row.fuel_level_percent}%</dd></div>
                ) : null}
                <div><dt><FmGaugeIcon /><span className="fm-sr-only">{t.vehicles.odometer}</span></dt><dd>{nextVehicle.row.odometer_km.toLocaleString(locale)} km</dd></div>
              </dl>
            ) : null}
            <div className="hm-next-actions">
              <Link href={`/reservations/${next.id}`} className="fm-btn fm-btn-ghost">
                {h.viewDetails} <FmChevronIcon />
              </Link>
              {canPickup ? (
                <Link href={`/reservations/${next.id}/pickup`} className="fm-btn fm-btn-primary">{dict.trips.list.startPickup}</Link>
              ) : null}
              {canReturn ? (
                <Link href={`/reservations/${next.id}/return`} className="fm-btn fm-btn-primary">{dict.trips.list.registerReturn}</Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="hm-empty">
            <p className="hm-muted">{h.nextEmpty}</p>
            <Link href="/trips/new" className="fm-btn fm-btn-primary">{h.nextEmptyCta}</Link>
          </div>
        )}
      </>
    );
  }
}
