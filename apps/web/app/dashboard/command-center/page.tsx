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
  FmWrenchIcon,
  FmAlertIcon,
} from "../../fmIcons";
import { VEHICLE_STATUSES } from "../statusMeta";
import "./command-center.css";

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
  searchParams: Promise<{ location?: string }>;
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
      undefined,
      params.location,
    ),
    getDictionary(),
    getLocale(),
  ]);
  const t = dict.commandCenter;
  const number = (n: number | null) =>
    n === null ? "—" : n.toLocaleString(locale as Locale);
  const { vehicles } = data;
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
  const reserved =
    vehicles?.filter((v) => ["reserved", "awaiting_pickup"].includes(v.status))
      .length ?? null;
  const maintenance =
    vehicles?.filter((v) => v.status === "maintenance").length ?? null;
  const blocked =
    vehicles?.filter((v) => v.status === "blocked").length ?? null;
  const otherStatuses =
    (total ?? 0) -
    [active, available, reserved, maintenance, blocked].reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const services = vehicles
    ?.filter((v) => v.next_service_odometer_km !== null)
    .sort(
      (a, b) =>
        a.next_service_odometer_km! -
        a.odometer_km -
        (b.next_service_odometer_km! - b.odometer_km),
    )
    .slice(0, 5);
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
    >
      <div className="fc" data-testid="fleet-command-center">
        <div className="fc-heading">
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
          <div className="fc-filters">
            <form method="get">
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
            <Link href={`/dashboard/command-center?location=${encodeURIComponent(data.selectedLocation)}`}>{t.retry}</Link>
          </p>
        )}
        <div className="fc-layout">
          <div className="fc-main">
            <div className="fc-bottom">
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
                    [t.reserved, reserved],
                    [t.inMaintenance, maintenance],
                    [t.blocked, blocked],
                    ...(otherStatuses > 0 ? [[t.otherStatuses, otherStatuses]] : []),
                  ].map(([label, n]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd>{number(n as number | null)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
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
            </div>
          </div>
        </div>
        <p className="fc-footnote">
          {t.footnote}{" "}
          <Link href="/dashboard">{t.openControls}</Link>
        </p>
      </div>
    </FmShell>
  );
}
