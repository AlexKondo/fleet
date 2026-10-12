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
import { EnergyGauge } from "./EnergyGauge";
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
  vehiclesError,
  statusMeta,
  attentionLabels,
  fleetActionError,
  actionSuccess,
}: {
  userId: string;
  userName: string;
  orgName: string;
  dict: Dictionary;
  locale: Locale;
  vehicles: HomeVehicle[];
  vehiclesError: boolean;
  statusMeta: Record<string, StatusMeta>;
  attentionLabels: Record<string, string>;
  fleetActionError: boolean;
  actionSuccess: boolean;
}) {
  const t = dict.dashboard;
  const h = t.home;
  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();

  // Next reservation: the earliest still-open one that has not ended (own query, so it never depends on how many past rows exist).
  // Most-reserved ranking: a count per vehicle over ALL the employee's non-cancelled reservations, read page by page
  // (1000 rows each, only the vehicle columns) instead of a capped list.
  const [{ data: nextRows }, { data: myRequests }, usageRows] = await Promise.all([
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
    (async () => {
      const rows: { vehicle: { id: string; plate: string; name: string | null } | null }[] = [];
      for (let page = 0; page < 50; page++) {
        const { data } = await supabase
          .from("reservations")
          .select("id, vehicle:vehicles(id, plate, name), trip_request:trip_requests!inner(requester_id)")
          .eq("trip_request.requester_id", userId)
          .neq("status", "cancelled")
          .order("id", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    })(),
  ]);

  const next = nextRows?.[0] ?? null;
  const byId = new Map(vehicles.map((v) => [v.row.id, v] as const));
  const nextVehicle = next?.vehicle ? byId.get(next.vehicle.id) : undefined;

  // Same conditions as the reservation detail page (the checklist pages re-check them server-side).
  const vStatus = next?.vehicle?.status;
  const canPickup = next?.status === "confirmed" && (vStatus === "reserved" || vStatus === "awaiting_pickup");
  const canReturn = next?.status === "confirmed" && vStatus === "in_use";

  // "Veículos mais reservados por você": reservations per vehicle (what is counted is reservations, not trips taken).
  const counts = new Map<string, { id: string; plate: string; name: string | null; count: number }>();
  for (const r of usageRows) {
    if (!r.vehicle) continue;
    const c = counts.get(r.vehicle.id) ?? { id: r.vehicle.id, plate: r.vehicle.plate, name: r.vehicle.name, count: 0 };
    c.count += 1;
    counts.set(r.vehicle.id, c);
  }
  const used = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  const attentionByReason = vehicles.reduce<Record<string, { id: string; plate: string }[]>>((acc, { row, attention }) => {
    for (const reason of attention) (acc[reason] ??= []).push({ id: row.id, plate: row.plate });
    return acc;
  }, {});

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
              <Link href="/carpool" className="hm-action" data-tone="green">
                <span className="hm-action-icon"><FmUsersIcon /></span>
                <span className="hm-action-text">
                  <strong>{h.actionCarpool}</strong>
                  <small>{h.actionCarpoolHint}</small>
                </span>
              </Link>
              <Link href="/trips" className="hm-action" data-tone="violet">
                <span className="hm-action-icon"><FmCalendarIcon /></span>
                <span className="hm-action-text">
                  <strong>{h.actionTrips}</strong>
                  <small>{h.actionTripsHint}</small>
                </span>
              </Link>
            </nav>

            {/* mobile order: the next reservation sits right under the actions (the aside is hidden there) */}
            <section className="fm-card hm-card hm-next hm-next-mobile" aria-labelledby="hm-next-m">
              <NextReservation idSuffix="m" />
            </section>

            {myRequests && myRequests.length > 0 ? (
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

            <section className="fm-card hm-card" aria-labelledby="hm-attention" data-testid="home-attention">
              <h2 id="hm-attention" className="fm-h2">{t.attention.heading}</h2>
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
              {Object.keys(attentionByReason).length === 0 ? (
                <p className="hm-muted">{t.attention.empty}</p>
              ) : (
                <ul className="hm-attention-list">
                  {Object.entries(attentionByReason).map(([reason, list]) => (
                    <li key={reason}>
                      <strong>{list.length}</strong> {attentionLabels[reason] ?? reason}:{" "}
                      {list.map((v, i) => (
                        <span key={v.id}>
                          <a href={`#vehicle-${v.id}`} className="hm-link">{v.plate}</a>
                          {i < list.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {used.length > 0 ? (
              <section className="fm-card hm-card" aria-labelledby="hm-used" data-testid="home-used-vehicles">
                <h2 id="hm-used" className="fm-h2">{h.usedTitle}</h2>
                <ul className="hm-used">
                  {used.map((u) => {
                    const v = byId.get(u.id);
                    return (
                      <li key={u.id} className="hm-used-item">
                        <span className="hm-row-icon"><FmCarIcon /></span>
                        <strong>{u.name ?? u.plate}</strong>
                        <span className="hm-plate">{u.plate}</span>
                        {v?.row.category ? <span className="fm-chip">{v.row.category.energy_type}</span> : null}
                        <span className="hm-muted">
                          {fillTemplate(u.count === 1 ? h.usedCountOne : h.usedCountOther, { count: u.count })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="hm-col-side" aria-label={h.nextTitle}>
            <section className="fm-card hm-card hm-next hm-next-desktop" aria-labelledby="hm-next-d">
              <NextReservation idSuffix="d" />
            </section>
          </aside>
        </div>

        <section className="hm-fleet" aria-labelledby="hm-fleet">
          <h2 id="hm-fleet" className="fm-h2">{t.vehicles.heading}</h2>
          {vehiclesError ? (
            <p className="fm-error" role="alert">{t.vehicles.loadError}</p>
          ) : vehicles.length === 0 ? (
            <p className="hm-muted">{t.vehicles.emptyLead} {t.vehicles.emptyEmployeeHint}</p>
          ) : (
            <ul className="hm-vehicles">
              {vehicles.map(({ row, attention }) => {
                const energy = row.category?.energy_type;
                const showFuel = energy === "ICE" || energy === "HEV" || energy === "PHEV";
                const showBattery = energy === "BEV" || energy === "PHEV";
                const meta = statusMeta[row.status];
                return (
                  <li key={row.id} id={`vehicle-${row.id}`} className="fm-card hm-vehicle" data-testid="home-vehicle">
                    <div className="hm-vehicle-head">
                      <div>
                        <p className="hm-plate-lg">{row.plate}</p>
                        <p className="hm-muted">{row.category?.name ?? "—"}</p>
                      </div>
                      <span className="fm-pill" data-tone="neutral">{meta?.label ?? row.status}</span>
                    </div>
                    <dl className="hm-vehicle-data">
                      {showFuel ? (
                        <div>
                          <dt>{t.vehicles.fuel}</dt>
                          <dd><EnergyGauge percent={row.fuel_level_percent} kind="fuel" dict={dict} /></dd>
                        </div>
                      ) : null}
                      {showBattery ? (
                        <div>
                          <dt>{t.vehicles.battery}</dt>
                          <dd><EnergyGauge percent={row.battery_level_percent} kind="battery" dict={dict} /></dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>{t.vehicles.odometer}</dt>
                        <dd>{row.odometer_km.toLocaleString(locale)} km</dd>
                      </div>
                      <div>
                        <dt>{t.vehicles.currentLocation}</dt>
                        <dd>{row.current_location?.name ?? "—"}</dd>
                      </div>
                    </dl>
                    {attention.length > 0 ? (
                      <div className="fm-chips">
                        {attention.map((reason) => (
                          <span key={reason} className="fm-chip hm-chip-warn">{attentionLabels[reason] ?? reason}</span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
        {next ? (
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
