"use client";
import { useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n/locales";
import type { FleetKey } from "@/lib/i18n/areas/fleet";
import { AssistantTrigger } from "../carpool/AssistantTrigger";
import { fmt } from "./fmt";

export interface DialogVehicle {
  id: string; plate: string; vin?: string | null; energyType?: string; unitName?: string; locationName?: string;
  odometerKm?: number; nextServiceKm?: number | null; nextServiceDate?: string | null;
  fuelPercent?: number | null; batteryPercent?: number | null; rangeKm?: number | null;
}

const TABS = ["edit", "overview", "maintenance", "trips", "documents", "intelligence"] as const;
type Tab = (typeof TABS)[number];

/**
 * The menu of ONE vehicle, inside its edit popup. Each link of the old quick-actions box and of the old tab panels lives in exactly one place:
 * edit (the form), overview (the data), maintenance and costs (one record), trips and utilization (one schedule), documents and equipment, intelligence.
 */
export function VehicleDialogTabs({ v, T, locale, dimensionsAvailable, form }: { v: DialogVehicle; T: Record<FleetKey, string>; locale: Locale; dimensionsAvailable: boolean; form: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("edit");
  const label: Record<Tab, string> = {
    edit: T.tabEditData, overview: T.tabOverview, maintenance: T.tabMaintenanceCosts, trips: T.tabTripsUtilization, documents: T.tabDocsEquipment, intelligence: T.tabIntelligence,
  };
  const km = (n: number | undefined | null) => (n == null ? "—" : `${n.toLocaleString(locale)} km`);
  const due = v.nextServiceKm != null && v.odometerKm != null ? v.nextServiceKm - v.odometerKm : null;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next]!);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="vw-dtabs">
      <div className="vw-tabs" role="tablist" aria-label={T.dialogTabs} onKeyDown={onKeyDown}>
        {TABS.map((k) => (
          <button type="button" role="tab" key={k} id={`vw-dtab-${k}`} aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} aria-controls="vw-dtab-panel" onClick={() => setTab(k)}>{label[k]}</button>
        ))}
      </div>
      <div role="tabpanel" id="vw-dtab-panel" aria-labelledby={`vw-dtab-${tab}`} className="vw-dpanel">
        {tab === "edit" && (
          <>
            <div className="vw-dialog-data">
              <p>{fmt(T.vinLine, { value: v.vin ?? T.notRegistered })}</p>
              <p>{fmt(T.propulsionLine, { value: v.energyType ?? "—" })}</p>
              <p>{fmt(T.baseUnitLine, { value: v.unitName ?? (dimensionsAvailable ? T.notLinked : T.unavailable) })}</p>
              <p>{fmt(T.physicalLocationLine, { value: v.locationName ?? "—" })}</p>
            </div>
            <ul className="vw-dialog-list">{form}</ul>
          </>
        )}
        {tab === "overview" && (
          <div className="vw-cards">
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
          </div>
        )}
        {tab === "maintenance" && (
          <article><h3>{T.maintenanceTitle} · {T.tabCosts}</h3><p>{T.recordNote}</p><Link href={`/maintenance/vehicles?vehicle=${v.id}`}>{fmt(T.openRecordOf, { plate: v.plate })}</Link></article>
        )}
        {tab === "trips" && (
          <article><h3>{T.tripsAndBookings}</h3><p>{T.utilizationAvailabilityNote}</p><Link href={`/fleet/vehicles/${v.id}`}>{T.viewBookings}</Link></article>
        )}
        {tab === "documents" && (
          <article><h3>{T.tabDocsEquipment}</h3><Link href={`/documents?target=vehicle&id=${v.id}`}>{T.documents}</Link><Link href={`/fleet/equipment?vehicle=${v.id}`}>{T.configureEquipment}</Link><a href={`/api/exports/vehicle/${v.id}`}>{T.exportRecord}</a></article>
        )}
        {tab === "intelligence" && (
          <article>
            <h3>FleetMind Intelligence</h3>
            <p>{due !== null && due <= 0 ? T.intelligenceReached : T.intelligenceNoAlert}</p>
            <AssistantTrigger draft={fmt(T.checkDraft, { plate: v.plate })}>{fmt(T.askFleetMind, { plate: v.plate })}</AssistantTrigger>
          </article>
        )}
      </div>
    </div>
  );
}
