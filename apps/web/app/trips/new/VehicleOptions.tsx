"use client";

import { energyFilterTypes, filterByEnergy } from "@/lib/trips/reservarForm";
import { fillTemplate } from "@/lib/carpool/errorText";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { VehicleCardInfo } from "./actions";
import { RvCarIcon } from "./rvIcons";

export interface VehicleOption {
  vehicleId: string;
  plate: string;
  vehicleName: string;
  categoryName: string;
  info: VehicleCardInfo;
  energyType: string;
  recommended: boolean;
}

const ENERGY_KEY = { ICE: "energyICE", HEV: "energyHEV", PHEV: "energyPHEV", BEV: "energyBEV" } as const;

export function energyLabel(dict: Dictionary, type: string): string {
  const key = (ENERGY_KEY as Record<string, keyof Dictionary["trips"]["reservar"]>)[type];
  return key ? (dict.trips.reservar[key] as string) : type;
}

/**
 * "Veículos disponíveis (N)": cards built ONLY from the real plan data (plate, category, energy type, capacity, energy level,
 * range, odometer, current location - a fact is shown only when the vehicle has it). The recommended vehicle is the featured
 * card ("Recomendado", primary action "Solicitar reserva", plus the host offer step and the engine's reasons passed as
 * `recommendedExtras`); every other eligible vehicle has "Selecionar". Filter chips exist only for the energy types that are
 * really present among the options.
 */
export function VehicleOptions({
  dict,
  locale,
  options,
  filter,
  onFilter,
  onConfirm,
  busy,
  recommendedExtras,
}: {
  dict: Dictionary;
  locale: Locale;
  options: VehicleOption[];
  filter: string;
  onFilter: (next: string) => void;
  onConfirm: (vehicleId: string) => void;
  busy: boolean;
  recommendedExtras: React.ReactNode;
}) {
  const t = dict.trips.request;
  const rv = dict.trips.reservar;
  const types = energyFilterTypes(options);
  const showChips = types.length > 1;
  const effectiveFilter = filter === "all" || types.includes(filter) ? filter : "all";
  const visible = filterByEnergy(options, effectiveFilter);
  const km = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 0 });

  const facts = (o: VehicleOption): string[] => {
    const i = o.info;
    const out: string[] = [];
    if (i.estimatedRangeKm != null && i.estimatedRangeKm > 0) out.push(fillTemplate(rv.rangeKm, { km: km(i.estimatedRangeKm) }));
    if (i.batteryLevelPercent != null) out.push(fillTemplate(rv.batteryLevel, { pct: Math.round(i.batteryLevelPercent) }));
    if (i.fuelLevelPercent != null) out.push(fillTemplate(rv.fuelLevel, { pct: Math.round(i.fuelLevelPercent) }));
    if (i.odometerKm != null) out.push(fillTemplate(rv.odometerKm, { km: km(i.odometerKm) }));
    return out;
  };

  return (
    <section className="fm-card rv-vehicles" aria-labelledby="rv-vehicles-title" data-testid="rv-vehicles">
      <div className="rv-vehicles-head">
        <div>
          <h2 id="rv-vehicles-title" className="fm-h2">
            {fillTemplate(rv.vehiclesTitle, { count: options.length })}
          </h2>
          <p className="rv-sub">{rv.vehiclesHint}</p>
        </div>
        {showChips ? (
          <div className="rv-filters" role="group" aria-label={rv.filterLabel} data-testid="rv-energy-filters">
            {["all", ...types].map((f) => (
              <button
                key={f}
                type="button"
                className="rv-filter"
                aria-pressed={effectiveFilter === f}
                data-filter={f}
                onClick={() => onFilter(f)}
              >
                {f === "all" ? rv.filterAll : energyLabel(dict, f)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rv-muted" role="status">
          {rv.noVehiclesFiltered}
        </p>
      ) : (
        <ul className="rv-vgrid">
          {visible.map((o) => (
            <li
              key={o.vehicleId}
              className={o.recommended ? "rv-vcard rv-vcard-rec" : "rv-vcard"}
              data-testid={o.recommended ? "vehicle-card-recommended" : "vehicle-card"}
              data-energy={o.energyType}
            >
              <div className="rv-vmain">
                <span className="rv-vmedia" aria-hidden="true">
                  <RvCarIcon />
                </span>
                <div className="rv-vtitle">
                  {o.recommended ? (
                    <>
                      <span className="rv-vbadge" aria-hidden="true">
                        {rv.recommendedBadge}
                      </span>
                      <span className="fm-sr-only">{t.recommendedVehicle}</span>
                    </>
                  ) : null}
                  <h3 className="rv-plate">{o.plate}</h3>
                  <p className="rv-muted">
                    {o.vehicleName && o.vehicleName !== o.plate ? `${o.vehicleName} · ` : ""}
                    {o.categoryName}
                  </p>
                </div>
              </div>
              <div className="rv-vchips">
                {o.energyType ? <span className="rv-vchip rv-vchip-energy">{energyLabel(dict, o.energyType)}</span> : null}
                {o.info.passengerCapacity ? (
                  <span className="rv-vchip">{fillTemplate(rv.seatsCount, { count: o.info.passengerCapacity })}</span>
                ) : null}
              </div>
              <ul className="rv-vfacts">
                {facts(o).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {o.info.locationName ? <li>{o.info.locationName}</li> : null}
              </ul>
              {o.recommended ? <div className="rv-vextras">{recommendedExtras}</div> : null}
              <button
                type="button"
                onClick={() => onConfirm(o.vehicleId)}
                disabled={busy}
                className={o.recommended ? "fm-btn fm-btn-primary rv-vaction" : "fm-btn fm-btn-ghost rv-vaction"}
                data-testid={o.recommended ? "vehicle-request" : "vehicle-select"}
              >
                {o.recommended ? (busy ? t.confirming : t.requestReservation) : rv.select}
                <span className="fm-sr-only"> {o.plate}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
