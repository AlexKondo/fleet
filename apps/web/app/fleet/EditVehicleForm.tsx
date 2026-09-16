"use client";

import { useActionState, useEffect, useState } from "react";
import { updateVehicle, type FleetActionState } from "./actions";
import { FUEL_LEVEL_OPTIONS, VEHICLE_COLOR_OPTIONS } from "@/lib/domain/vehicleFieldOptions";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

export interface EditableVehicle {
  id: string;
  plate: string;
  name: string | null;
  color: string | null;
  photoUrl: string | null;
  category_id: string;
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
  dict,
  onSaved,
  onCancel,
}: {
  vehicle: EditableVehicle;
  categories: { id: string; name: string; energyType: string }[];
  locations: { id: string; name: string }[];
  dict: Dictionary;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateVehicle, initialState);
  const [categoryId, setCategoryId] = useState(vehicle.category_id);

  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state, onSaved]);

  // Energy type is a property of the category (0026_move_energy_type_to_category.sql),
  // not something chosen per vehicle — which fuel/battery field to show follows whichever
  // category is currently selected.
  const energyType = categories.find((c) => c.id === categoryId)?.energyType;
  const showFuel = energyType === "ICE" || energyType === "HEV" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-signal-amber/40 bg-panel-800/40 p-4"
    >
      <input type="hidden" name="id" value={vehicle.id} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.vehicleForm.plateLabel}</span>
          <input
            type="text"
            name="plate"
            required
            defaultValue={vehicle.plate}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm uppercase text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.common.name}</span>
          <input
            type="text"
            name="name"
            placeholder={dict.fleet.vehicleForm.namePlaceholder}
            defaultValue={vehicle.name ?? ""}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.vehicleForm.colorLabel}</span>
          <select
            name="color"
            defaultValue={vehicle.color ?? ""}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="">{dict.common.optional}</option>
            {vehicle.color && !(VEHICLE_COLOR_OPTIONS as readonly string[]).includes(vehicle.color) ? (
              <option value={vehicle.color}>
                {dict.fleet.vehicleForm.colorCurrent.replace("{color}", vehicle.color)}
              </option>
            ) : null}
            {VEHICLE_COLOR_OPTIONS.map((color) => (
              <option key={color} value={color}>
                {dict.fleet.vehicleForm.colors[color]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {vehicle.photoUrl
              ? dict.fleet.vehicleForm.changePhotoLabel
              : dict.fleet.vehicleForm.photoLabel}
          </span>
          {vehicle.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={vehicle.photoUrl}
              alt={dict.fleet.vehicleForm.photoAlt.replace("{name}", vehicle.plate)}
              className="h-16 w-24 rounded-sm border border-line-800 object-cover"
            />
          ) : null}
          <input
            type="file"
            name="photo"
            accept="image/*"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-xs text-fog-400 outline-none file:mr-2 file:rounded-sm file:border-0 file:bg-line-800 file:px-2 file:py-1 file:text-xs file:text-paper-50 focus-visible:border-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.vehicleForm.categoryLabel}</span>
          <select
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
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
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {dict.fleet.vehicleForm.odometerLabel}
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
            {dict.fleet.vehicleForm.nextServiceLabel}
          </span>
          <input
            type="number"
            name="nextServiceOdometerKm"
            min={0}
            placeholder={dict.common.optional}
            defaultValue={vehicle.next_service_odometer_km ?? ""}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {dict.fleet.vehicleForm.estimatedRangeLabel}
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
              {dict.fleet.vehicleForm.fuelLabel}
            </span>
            <select
              name="fuelLevelPercent"
              defaultValue={vehicle.fuel_level_percent ?? 100}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            >
              {vehicle.fuel_level_percent != null &&
              !FUEL_LEVEL_OPTIONS.some((opt) => opt.value === vehicle.fuel_level_percent) ? (
                <option value={vehicle.fuel_level_percent}>
                  {dict.fleet.vehicleForm.fuelCurrent.replace(
                    "{percent}",
                    String(vehicle.fuel_level_percent),
                  )}
                </option>
              ) : null}
              {FUEL_LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {dict.fleet.vehicleForm.fuelLevels[`${opt.value}`]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {showBattery ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {dict.fleet.vehicleForm.batteryLabel}
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
            {dict.fleet.vehicleForm.homeLocationLabel}
          </span>
          <select
            name="locationId"
            required
            defaultValue={vehicle.home_location_id ?? ""}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="">{dict.fleet.vehicleForm.selectPlaceholder}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-fog-600">
        {dict.fleet.vehicleForm.statusNote}
      </p>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {errorLabel(dict, state.error)}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? dict.common.saving : dict.common.saveChanges}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50"
        >
          {dict.common.cancel}
        </button>
      </div>
    </form>
  );
}
