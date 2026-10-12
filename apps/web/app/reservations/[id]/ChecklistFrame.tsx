import Link from "next/link";
import { FmShell } from "../../carpool/FmShell";
import { FmCarIcon, FmPinIcon } from "../../fmIcons";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import "./checklist.css";

/**
 * SCR-USR-005 frame shared by the pickup and the return checklist pages: scoped FleetMind v2.0 shell, back link,
 * title, the vehicle card (only fields the vehicle row really has) and the route. The forms render inside.
 */
export async function ChecklistFrame({
  dict,
  title,
  intro,
  shell,
  vehicle,
  showElectricRange,
  route,
  children,
}: {
  dict: Dictionary;
  title: string;
  intro: string;
  shell: { orgName: string; userName: string; role: string };
  vehicle: {
    plate: string;
    name: string | null;
    color: string | null;
    categoryName: string | null;
    energyType: string;
    estimatedRangeKm: number | null;
  };
  showElectricRange: boolean;
  route: { origin: string | null | undefined; destination: string | null | undefined };
  children: React.ReactNode;
}) {
  const isFleetManager = shell.role === "fleet_manager" || shell.role === "administrator";
  return (
    <FmShell
      active="trips"
      orgName={shell.orgName}
      userName={shell.userName}
      role={shell.role}
      isFleetManager={isFleetManager}
      isAdministrator={shell.role === "administrator"}
    >
      <div className="ck" data-testid="checklist-page">
        <Link href="/trips" className="fm-link">
          {dict.reservations.detail.backToTrips}
        </Link>
        <h1 className="fm-title">{title}</h1>
        <p className="fm-subtitle">{intro}</p>

        <section className="fm-card ck-vehicle" aria-label={vehicle.name ?? vehicle.plate}>
          <span className="ck-vehicle-icon"><FmCarIcon /></span>
          <div className="ck-vehicle-main">
            <p className="ck-vehicle-name">
              {vehicle.name ?? vehicle.plate}
            </p>
            <p className="ck-plate">{vehicle.plate}</p>
            <div className="fm-chips">
              <span className="fm-chip">{vehicle.energyType}</span>
              {vehicle.categoryName ? <span className="fm-chip">{vehicle.categoryName}</span> : null}
              {vehicle.color ? <span className="fm-chip">{vehicle.color}</span> : null}
              {showElectricRange && vehicle.estimatedRangeKm !== null ? (
                <span className="fm-chip">
                  {dict.reservations.checklist.electricRange.replace("{km}", String(vehicle.estimatedRangeKm))}
                </span>
              ) : null}
            </div>
            <p className="ck-route break-user-text">
              <FmPinIcon />
              <span className="fm-sr-only">{dict.reservations.checklist.routeLabel}: </span>
              {route.origin} → {route.destination}
            </p>
          </div>
        </section>

        {children}
      </div>
    </FmShell>
  );
}
