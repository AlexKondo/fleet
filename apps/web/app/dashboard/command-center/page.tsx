import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import type { Locale } from "@/lib/i18n/locales";
import { loadCommandCenter } from "@/lib/dashboard/loadCommandCenter";
import { FmShell } from "../../carpool/FmShell";
import {
  FmCarIcon,
  FmCalendarIcon,
  FmUsersIcon,
  FmWrenchIcon,
  FmAlertIcon,
} from "../../fmIcons";
import { getStatusMeta, VEHICLE_STATUSES } from "../statusMeta";
import "./command-center.css";
import { CommandSearch } from "./CommandSearch";

const fmt = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""));
function Card({
  title,
  children,
  className = "",
  href,
  viewDetails,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  href?: string;
  viewDetails: string;
}) {
  return (
    <section className={`fc-card ${className}`}>
      <header>
        <h2>{title}</h2>
        {href && <Link href={href}>{viewDetails}</Link>}
      </header>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="fc-empty">{children}</p>;
}

export default async function FleetCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; location?: string }>;
}) {
  const params = await searchParams;
  const db = await createSupabaseServerClient();
  const user = await getCurrentUser(db);
  if (!user) redirect("/login");
  const { data: profile, error } = await db
    .from("profiles")
    .select(
      "full_name, role, organization_id, organization:organizations(name)",
    )
    .eq("id", user.id)
    .single();
  if (
    error ||
    !profile ||
    !["fleet_manager", "administrator"].includes(profile.role)
  )
    redirect("/dashboard");
  const [data, dict, locale] = await Promise.all([
    loadCommandCenter(
      db,
      profile.organization_id,
      params.period,
      params.location,
    ),
    getDictionary(),
    getLocale(),
  ]);
  const t = dict.commandCenter;
  const labels = {
    today: t.periodToday,
    "7d": t.period7d,
    "30d": t.period30d,
    month: t.periodMonth,
  } as const;
  const number = (n: number | null) =>
    n === null ? "—" : n.toLocaleString(locale as Locale);
  const dateLocale = locale as Locale;
  const { vehicles, reservations, rides, tasks, range } = data;
  const statuses = getStatusMeta(dict);
  const counts = VEHICLE_STATUSES.map((status) => ({
    status,
    count: vehicles?.filter((v) => v.status === status).length ?? 0,
  }));
  const total = vehicles?.length ?? null;
  const active =
    vehicles?.filter((v) => ["in_use", "returning"].includes(v.status))
      .length ?? null;
  const available =
    vehicles?.filter((v) => v.status === "available").length ?? null;
  const maintenance =
    vehicles?.filter((v) => v.status === "maintenance").length ?? null;
  const blocked =
    vehicles?.filter((v) => v.status === "blocked").length ?? null;
  const noLocation =
    vehicles?.filter((v) => !v.current_location_id).length ?? null;
  const categories = [
    ...new Set(vehicles?.map((v) => v.category?.name ?? t.noCategory)),
  ].map((name) => ({
    name,
    count:
      vehicles?.filter((v) => (v.category?.name ?? t.noCategory) === name)
        .length ?? 0,
  }));
  const services = vehicles
    ?.filter((v) => v.next_service_odometer_km !== null)
    .sort(
      (a, b) =>
        a.next_service_odometer_km! -
        a.odometer_km -
        (b.next_service_odometer_km! - b.odometer_km),
    )
    .slice(0, 5);
  const recent = reservations
    ?.slice()
    .sort((a, b) => b.start_at.localeCompare(a.start_at))
    .slice(0, 5);
  const insights = [
    ...(blocked
      ? [
          {
            title: t.insightBlockedTitle,
            text: fmt(t.insightBlockedText, { n: number(blocked) }),
            href: "/dashboard#attention",
            tone: "red",
          },
        ]
      : []),
    ...(tasks?.length
      ? [
          {
            title: t.insightTasksTitle,
            text: fmt(t.insightTasksText, { n: number(tasks.length) }),
            href: "/dashboard#open-tasks",
            tone: "orange",
          },
        ]
      : []),
    ...(noLocation
      ? [
          {
            title: t.insightLocationTitle,
            text: fmt(t.insightLocationText, { n: number(noLocation) }),
            href: "/fleet",
            tone: "blue",
          },
        ]
      : []),
    ...(maintenance
      ? [
          {
            title: t.insightMaintenanceTitle,
            text: fmt(t.insightMaintenanceText, { n: number(maintenance) }),
            href: "/dashboard#open-tasks",
            tone: "green",
          },
        ]
      : []),
  ];
  const href = (period: string) =>
    `/dashboard/command-center?period=${period}&location=${encodeURIComponent(data.selectedLocation)}`;
  return (
    <FmShell
      active="dashboard"
      role={profile.role}
      isFleetManager
      isAdministrator={profile.role === "administrator"}
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      wide
      commandCenter
      searchContent={
        <CommandSearch
          items={[
            ...(vehicles ?? []).map((v) => ({
              label: `${v.plate} · ${v.category?.name ?? t.vehicleFallback}`,
              detail: statuses[v.status].label,
              href: `/fleet/vehicles/${v.id}`,
            })),
            ...(reservations ?? []).map((r) => ({
              label: r.trip_request?.requester?.full_name ?? t.tripFallback,
              detail: `${r.trip_request?.origin ?? ""} → ${r.trip_request?.destination ?? ""}`,
              href: `/reservations/${r.id}`,
            })),
          ]}
          labels={{
            aria: t.searchAria,
            placeholder: t.searchPlaceholder,
            heading: t.searchHeading,
            noResults: t.searchNoResults,
          }}
        />
      }
    >
      <div className="fc" data-testid="fleet-command-center">
        <div className="fc-heading">
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
          <div className="fc-filters">
            <nav aria-label={t.periodAria}>
              {Object.entries(labels).map(([key, label]) => (
                <Link
                  key={key}
                  href={href(key)}
                  aria-current={range.period === key ? "page" : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <form method="get">
              <input type="hidden" name="period" value={range.period} />
              <label className="sr-only" htmlFor="fc-location">
                {t.locationAria}
              </label>
              <select
                id="fc-location"
                name="location"
                defaultValue={data.selectedLocation}
                disabled={data.locations === null}
              >
                <option value="all">{t.allLocations}</option>
                {data.locations?.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button type="submit">{t.apply}</button>
            </form>
          </div>
        </div>
        {data.degraded && (
          <p role="alert" className="fc-error">
            {t.degraded}{" "}
            <Link href={href(range.period)}>{t.retry}</Link>
          </p>
        )}
        <div className="fc-layout">
          <div className="fc-main">
            <section className="fc-kpis" aria-label={t.kpisAria}>
              <div className="fc-card fc-kpi">
                <div className="fc-kpi-top">
                  <FmCarIcon />
                  <div>
                    <strong>{number(total)}</strong>
                    <span>{t.vehiclesTotal}</span>
                  </div>
                </div>
                <div className="fc-segments" aria-hidden="true">
                  {counts
                    .filter((c) => c.count)
                    .map((c) => (
                      <span
                        key={c.status}
                        data-status={c.status}
                        style={{ flex: c.count }}
                      />
                    ))}
                </div>
                <dl>
                  {[
                    [t.inOperation, active],
                    [t.available, available],
                    [t.inMaintenance, maintenance],
                    [t.blocked, blocked],
                  ].map(([label, n]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd>{number(n as number | null)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <Link className="fc-card fc-kpi" href="/trips">
                <div className="fc-kpi-top">
                  <FmCalendarIcon />
                  <div>
                    <strong>
                      {number(
                        reservations?.filter(
                          (r) =>
                            r.status === "confirmed" ||
                            r.status === "completed",
                        ).length ?? null,
                      )}
                    </strong>
                    <span>{fmt(t.tripsPeriod, { period: labels[range.period] })}</span>
                  </div>
                </div>
                <dl>
                  {["confirmed", "completed", "cancelled"].map((s) => (
                    <div key={s}>
                      <dt>
                        {s === "confirmed"
                          ? t.confirmed
                          : s === "completed"
                            ? t.completed
                            : t.cancelled}
                      </dt>
                      <dd>
                        {number(
                          reservations?.filter((r) => r.status === s).length ??
                            null,
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <small>{t.byDeparture}</small>
              </Link>
              <Link className="fc-card fc-kpi" href="/analytics/carpool">
                <div className="fc-kpi-top">
                  <FmUsersIcon />
                  <div>
                    <strong>{number(rides?.length ?? null)}</strong>
                    <span>{t.ridesAccepted}</span>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>{t.sharedSeats}</dt>
                    <dd>
                      {number(
                        rides?.reduce((sum, r) => sum + r.requested_seats, 0) ??
                          null,
                      )}
                    </dd>
                  </div>
                </dl>
                <small>{t.ridesNote}</small>
              </Link>
              <div className="fc-card fc-kpi">
                <div className="fc-kpi-top">
                  <span className="fc-gauge" aria-hidden="true">
                    ◔
                  </span>
                  <div>
                    <strong>—</strong>
                    <span>{t.utilizationRate}</span>
                  </div>
                </div>
                <small>{t.utilizationHint}</small>
                <p>{t.utilizationPending}</p>
              </div>
              <div className="fc-card fc-kpi">
                <div className="fc-kpi-top">
                  <FmUsersIcon />
                  <div>
                    <strong>—</strong>
                    <span>{t.occupancyRate}</span>
                  </div>
                </div>
                <small>{t.occupancyHint}</small>
                <p>{t.occupancyPending}</p>
              </div>
            </section>
            <div className="fc-middle">
              <Card
                title={t.fleetLocation}
                viewDetails={t.viewDetails}
                className="fc-location"
                href="/fleet"
              >
                <div className="fc-map-state">
                  <svg
                    className="fc-pin-svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <path d="M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12Z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  <strong>{t.mapUnavailable}</strong>
                  <p>{t.mapNoSource}</p>
                  <span className="fc-pill">{t.locationRegistered}</span>
                </div>
                <div className="fc-location-list">
                  {vehicles === null || data.locations === null ? (
                    <Empty>{t.locationsError}</Empty>
                  ) : (
                    <>
                      {data.locations
                        .filter((l) =>
                          vehicles.some((v) => v.current_location_id === l.id),
                        )
                        .slice(0, 5)
                        .map((l) => (
                          <Link
                            key={l.id}
                            href={`/dashboard/command-center?period=${range.period}&location=${l.id}`}
                          >
                            <span>{l.name}</span>
                            <strong>
                              {
                                vehicles.filter(
                                  (v) => v.current_location_id === l.id,
                                ).length
                              }
                            </strong>
                          </Link>
                        ))}
                      <p>
                        {t.noLocationLabel} <strong>{number(noLocation)}</strong>
                      </p>
                    </>
                  )}
                </div>
              </Card>
              <Card
                title={t.economyTitle}
                viewDetails={t.viewDetails}
                className="fc-sustain"
                href="/analytics"
              >
                <div className="fc-sustain-grid">
                  {[
                    ["♧", t.ecoCarpool],
                    ["◉", t.ecoBev],
                    ["ϟ", t.ecoElectric],
                    ["❧", t.ecoCo2],
                  ].map(([icon, label]) => (
                    <div key={label}>
                      <span aria-hidden="true">{icon}</span>
                      <div>
                        <strong>—</strong>
                        <p>{label}</p>
                        <small>{t.calcPending}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="fc-charts">
              <Card title={t.fleetUtilization} viewDetails={t.viewDetails}>
                <p className="fc-caption">
                  {t.utilizationCaption}
                </p>
                {reservations === null ? (
                  <Empty>{t.seriesUnavailable}</Empty>
                ) : !data.daily.some((d) => d.count) ? (
                  <Empty>{t.noDepartures}</Empty>
                ) : (
                  <div
                    className="fc-bars"
                    role="img"
                    aria-label={data.daily
                      .map((d) => fmt(t.departuresCount, { day: d.day, n: d.count }))
                      .join("; ")}
                  >
                    {data.daily.map((d) => (
                      <div key={d.day} title={fmt(t.departuresCount, { day: d.day, n: d.count })}>
                        <span
                          style={{
                            height: `${(d.count / Math.max(...data.daily.map((x) => x.count), 1)) * 100}%`,
                          }}
                        />
                        <small>{d.day.slice(8)}</small>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title={t.seatOccupancy} viewDetails={t.viewDetails}>
                <Empty>{t.seatOccupancyEmpty}</Empty>
                <p className="fc-caption">{t.seatOccupancyCaption}</p>
              </Card>
              <Card title={t.tripsByUse} viewDetails={t.viewDetails}>
                <Empty>{t.tripsByUseEmpty}</Empty>
              </Card>
            </div>
            <div className="fc-bottom">
              <Card
                title={t.vehiclesByCategory}
                href="/fleet"
                viewDetails={t.viewDetails}
              >
                {vehicles === null ? (
                  <Empty>{t.dataUnavailable}</Empty>
                ) : !total ? (
                  <Empty>{t.noVehicles}</Empty>
                ) : (
                  <div className="fc-category-bars">
                    {categories.map((c) => (
                      <div key={c.name}>
                        <strong>{c.count}</strong>
                        <span
                          style={{
                            height: `${(c.count / Math.max(...categories.map((x) => x.count), 1)) * 90}px`,
                          }}
                        />
                        <small>{c.name}</small>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title={t.fleetStatus} viewDetails={t.viewDetails}>
                {vehicles === null ? (
                  <Empty>{t.dataUnavailable}</Empty>
                ) : (
                  <dl className="fc-status-list">
                    {counts
                      .filter((c) => c.count)
                      .map((c) => (
                        <div key={c.status}>
                          <dt>
                            <i data-status={c.status} />
                            {statuses[c.status].label}
                          </dt>
                          <dd>
                            {c.count}{" "}
                            <small>
                              {total ? Math.round((c.count / total) * 100) : 0}%
                            </small>
                          </dd>
                        </div>
                      ))}
                    {!total && <Empty>{t.noVehiclesFilter}</Empty>}
                  </dl>
                )}
              </Card>
              <Card
                title={t.upcomingMaintenance}
                href="/dashboard#open-tasks"
                viewDetails={t.viewDetails}
              >
                {vehicles === null ? (
                  <Empty>{t.dataUnavailable}</Empty>
                ) : !services?.length ? (
                  <Empty>{t.noServiceByKm}</Empty>
                ) : (
                  <ul className="fc-records">
                    {services.map((v) => (
                      <li key={v.id}>
                        <FmCarIcon />
                        <Link href={`/fleet/vehicles/${v.id}`}>
                          <strong>{v.category?.name ?? v.plate}</strong>
                          <small>{v.plate}</small>
                        </Link>
                        <span
                          className={
                            v.next_service_odometer_km! <= v.odometer_km
                              ? "fc-danger"
                              : ""
                          }
                        >
                          {number(
                            Math.max(
                              0,
                              v.next_service_odometer_km! - v.odometer_km,
                            ),
                          )}{" "}
                          km
                          <small>
                            {v.next_service_odometer_km! <= v.odometer_km
                              ? t.reviewReached
                              : t.untilReview}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card
                title={t.recentTrips}
                href="/trips"
                viewDetails={t.viewDetails}
              >
                {reservations === null ? (
                  <Empty>{t.dataUnavailable}</Empty>
                ) : !recent?.length ? (
                  <Empty>{t.noTrips}</Empty>
                ) : (
                  <ul className="fc-records">
                    {recent.map((r) => (
                      <li key={r.id}>
                        <Link href={`/reservations/${r.id}`}>
                          <strong>
                            {r.trip_request?.requester?.full_name ?? t.driverFallback}
                          </strong>
                          <small>
                            {r.trip_request?.destination ??
                              t.destinationMissing}
                          </small>
                        </Link>
                        <span>
                          {new Date(r.start_at).toLocaleDateString(dateLocale, {
                            timeZone: "America/Sao_Paulo",
                            day: "2-digit",
                            month: "2-digit",
                          })}
                          <small>
                            {dict.fleet.detail.reservationStatus[r.status]}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
          <aside className="fc-side">
            <Card
              title="✦ FleetMind Intelligence"
              className="fc-intelligence"
              viewDetails={t.viewDetails}
            >
              <span className="fc-count">
                {fmt(t.insightsCount, { n: insights.length })}
              </span>
              {vehicles === null || tasks === null ? (
                <Empty>{t.insightsUnconfirmed}</Empty>
              ) : null}
              {insights.length
                ? insights.map((i) => (
                    <Link className="fc-insight" href={i.href} key={i.title}>
                      <span data-tone={i.tone}>✦</span>
                      <div>
                        <strong>{i.title}</strong>
                        <p>{i.text}</p>
                      </div>
                      <b aria-hidden="true">›</b>
                    </Link>
                  ))
                : !data.degraded && (
                    <Empty>{t.noInsights}</Empty>
                  )}
              <p className="fc-caption">{t.insightsCaption}</p>
            </Card>
            <Card
              title={t.alertsTitle}
              href="/dashboard#open-tasks"
              viewDetails={t.viewDetails}
            >
              {tasks === null ? (
                <Empty>{t.alertsUnavailable}</Empty>
              ) : !tasks.length ? (
                <Empty>{t.noOpenTasks}</Empty>
              ) : (
                <ul className="fc-alerts">
                  {tasks
                    .slice()
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 5)
                    .map((task) => (
                      <li key={task.id}>
                        <FmAlertIcon />
                        <Link href="/dashboard#open-tasks">
                          <strong>
                            {dict.dashboard.tasks.types[task.type] ?? task.type}
                          </strong>
                          <p>{task.vehicle?.plate ?? t.vehicleFallback}</p>
                          <small>
                            {new Date(task.created_at).toLocaleDateString(
                              dateLocale,
                              { timeZone: "America/Sao_Paulo" },
                            )}{" "}
                            ·{" "}
                            {(dict.dashboard.tasks.priorities as Record<string, string>)[
                              task.priority
                            ] ?? task.priority}
                          </small>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
            <Card title={t.quickActions} viewDetails={t.viewDetails}>
              <nav className="fc-actions" aria-label={t.quickActions}>
                {[
                  {
                    label: t.newReservation,
                    href: "/trips/new",
                    icon: <FmCalendarIcon />,
                  },
                  {
                    label: t.findCarpool,
                    href: "/carpool",
                    icon: <FmUsersIcon />,
                  },
                  {
                    label: t.manageVehicles,
                    href: "/fleet",
                    icon: <FmCarIcon />,
                  },
                  {
                    label: t.incidentsTasks,
                    href: "/dashboard#attention",
                    icon: <FmAlertIcon />,
                  },
                  {
                    label: t.maintenance,
                    href: "/dashboard#open-tasks",
                    icon: <FmWrenchIcon />,
                  },
                  {
                    label: t.reports,
                    href: "/analytics",
                    icon: <FmCalendarIcon />,
                  },
                ].map((a) => (
                  <Link href={a.href} key={a.label}>
                    <span>{a.icon}</span>
                    {a.label}
                  </Link>
                ))}
              </nav>
            </Card>
          </aside>
        </div>
        <p className="fc-footnote">
          {t.footnote}{" "}
          <Link href="/dashboard">{t.openControls}</Link>
        </p>
      </div>
    </FmShell>
  );
}
