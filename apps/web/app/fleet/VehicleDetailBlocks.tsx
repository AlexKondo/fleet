"use client";
import Link from "next/link";
import type { Locale } from "@/lib/i18n/locales";
import type { FleetKey } from "@/lib/i18n/areas/fleet";
import { fmt } from "./fmt";

export interface DialogVehicle {
  id: string; plate: string; name?: string | null; vin?: string | null; energyType?: string; unitName?: string; locationName?: string;
  odometerKm?: number; nextServiceKm?: number | null; nextServiceDate?: string | null;
  fuelPercent?: number | null; batteryPercent?: number | null; rangeKm?: number | null;
}

/**
 * What used to be tabs inside the edit popup, now plain blocks at the end of the Frota screen, for the vehicle selected in the list:
 * its data, where it is, its mileage and next service, and one entry point each for maintenance, documents / equipment and the assistant.
 * (The schedule is the chart above; the popup is only the edit form.)
 */
export function VehicleDetailBlocks({ v, T, locale, dimensionsAvailable }: { v: DialogVehicle; T: Record<FleetKey, string>; locale: Locale; dimensionsAvailable: boolean }) {
  const km = (n: number | undefined | null) => (n == null ? "—" : `${n.toLocaleString(locale)} km`);
  const due = v.nextServiceKm != null && v.odometerKm != null ? v.nextServiceKm - v.odometerKm : null;
  return (
    <section className="vw-blocks" aria-label={`${v.name ?? v.plate} (${v.plate})`} data-testid="vehicle-detail-blocks">
      <h2>{v.name ?? v.plate} <small>({v.plate})</small></h2>
      <div className="vw-cards">
        <article>
          <h3>{T.vehicleDataTitle}</h3>
          <p>{fmt(T.vinLine, { value: v.vin ?? T.notRegistered })}</p>
          <p>{fmt(T.propulsionLine, { value: v.energyType ?? "—" })}</p>
          <p>{fmt(T.baseUnitLine, { value: v.unitName ?? (dimensionsAvailable ? T.notLinked : T.unavailable) })}</p>
          <p>{fmt(T.physicalLocationLine, { value: v.locationName ?? "—" })}</p>
        </article>
        <article><h3>{T.currentLocation}</h3><strong>{v.locationName ?? T.notInformed}</strong><p>{T.registeredLocationNote}</p></article>
        <article>
          <h3>{T.vehicleInfo}</h3>
          <dl><dt>{T.totalMileage}</dt><dd>{km(v.odometerKm)}</dd><dt>{T.fuel}</dt><dd>{v.fuelPercent == null ? "—" : `${v.fuelPercent}%`}</dd><dt>{T.battery}</dt><dd>{v.batteryPercent == null ? "—" : `${v.batteryPercent}%`}</dd><dt>{T.recordedRange}</dt><dd>{km(v.rangeKm)}</dd></dl>
        </article>
        <article>
          <h3>{T.nextServiceByKm}</h3>
          <strong>{km(v.nextServiceKm)}</strong>
          <p>{fmt(T.serviceByDateLine, { value: v.nextServiceDate ? new Intl.DateTimeFormat(locale, { timeZone: "America/Sao_Paulo" }).format(new Date(`${v.nextServiceDate}T12:00:00-03:00`)) : T.notConfigured })}</p>
          <p>{due === null ? T.limitNotConfigured : due <= 0 ? T.limitReached : fmt(T.kmRemaining, { km: km(due) })}</p>
        </article>
        <article><h3>{T.maintenanceTitle} · {T.tabCosts}</h3><p>{T.recordNote}</p><Link href={`/maintenance/vehicles?vehicle=${v.id}`}>{fmt(T.openRecordOf, { plate: v.plate })}</Link></article>
        <article><h3>{T.tabDocsEquipment}</h3><Link href={`/documents?target=vehicle&id=${v.id}`}>{T.documents}</Link><Link href={`/fleet/equipment?vehicle=${v.id}`}>{T.configureEquipment}</Link></article>
        <article>
          <h3>FleetMind Intelligence</h3>
          <p>{due !== null && due <= 0 ? T.intelligenceReached : T.intelligenceNoAlert}</p>
        </article>
      </div>
    </section>
  );
}
