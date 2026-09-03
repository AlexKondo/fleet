"use client";

import { useActionState, useEffect, useState } from "react";
import { updateVehicle, type FleetActionState } from "./actions";

const initialState: FleetActionState = { status: "idle" };

export interface EditableVehicle {
  id: string;
  plate: string;
  category_id: string;
  energy_type: "ICE" | "PHEV" | "BEV";
  odometer_km: number;
  next_service_odometer_km: number | null;
  estimated_range_km: number;
  fuel_level_percent: number | null;
  battery_level_percent: number | null;
  home_location_id: string | null;
}

export function EditVehicleForm({
  vehicle,
  categories,
  locations,
  onSaved,
  onCancel,
}: {
  vehicle: EditableVehicle;
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateVehicle, initialState);
  const [energyType, setEnergyType] = useState(vehicle.energy_type);

  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state, onSaved]);

  const showFuel = energyType === "ICE" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-signal-amber/40 bg-panel-800/40 p-4"
    >
      <input type="hidden" name="id" value={vehicle.id} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Placa</span>
          <input
            type="text"
            name="plate"
            required
            defaultValue={vehicle.plate}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm uppercase text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Categoria</span>
          <select
            name="categoryId"
            required
            defaultValue={vehicle.category_id}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Energia</span>
          <select
            name="energyType"
            required
            value={energyType}
            onChange={(e) => setEnergyType(e.target.value as "ICE" | "PHEV" | "BEV")}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="ICE">Combustão (ICE)</option>
            <option value="PHEV">Híbrido plug-in (PHEV)</option>
            <option value="BEV">Elétrico (BEV)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Odômetro (km)
          </span>
          <input
            type="number"
            name="odometerKm"
            required
            min={0}
            defaultValue={vehicle.odometer_km}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Próxima revisão (km)
          </span>
          <input
            type="number"
            name="nextServiceOdometerKm"
            min={0}
            placeholder="Opcional"
            defaultValue={vehicle.next_service_odometer_km ?? ""}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Autonomia estimada (km)
          </span>
          <input
            type="number"
            name="estimatedRangeKm"
            required
            min={0}
            defaultValue={vehicle.estimated_range_km}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        {showFuel ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Combustível (%)
            </span>
            <input
              type="number"
              name="fuelLevelPercent"
              min={0}
              max={100}
              defaultValue={vehicle.fuel_level_percent ?? 100}
              className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
            />
          </label>
        ) : null}

        {showBattery ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Bateria (%)
            </span>
            <input
              type="number"
              name="batteryLevelPercent"
              min={0}
              max={100}
              defaultValue={vehicle.battery_level_percent ?? 100}
              className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Localização base
          </span>
          <select
            name="locationId"
            required
            defaultValue={vehicle.home_location_id ?? ""}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="">Selecionar…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-fog-600">
        Status e localização atual são controlados pelas operações do Painel (retirada,
        retorno, bloqueio) e não podem ser editados aqui.
      </p>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Salvar Alterações"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
