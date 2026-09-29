"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createVehicle, type FleetActionState } from "./actions";
import { FUEL_LEVEL_OPTIONS, VEHICLE_COLOR_OPTIONS } from "@/lib/domain/vehicleFieldOptions";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

// Same fix as TripRequestForm.tsx's draft (see its own comment for the full story): a
// duplicate-plate (or any other) error left every other typed field wiped, forcing a
// full re-fill just to fix the one field that was wrong. sessionStorage survives
// whatever causes the remount; cleared only once the vehicle is actually created.
const DRAFT_STORAGE_KEY = "fleet.vehicle-form-draft.v1";
const DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

interface VehicleFormDraft {
  savedAt: number;
  fields: Record<string, string>;
}

function readDraft(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const draft = JSON.parse(raw) as VehicleFormDraft;
    if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return {};
    return draft.fields ?? {};
  } catch {
    return {};
  }
}

function writeDraft(formData: FormData): void {
  try {
    const fields: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") fields[key] = value;
    }
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), fields }));
  } catch {
    // sessionStorage unavailable (private browsing, disabled) — just skip persistence.
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function VehicleForm({
  categories,
  locations,
  dict,
  onSaved,
}: {
  categories: { id: string; name: string; energyType: string }[];
  locations: { id: string; name: string }[];
  dict: Dictionary;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createVehicle, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Read once, on mount — restores whatever survived a remount after a failed submit.
  const [draft] = useState(readDraft);
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? "");

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setCategoryId("");
      clearDraft();
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Energy type is a property of the category (0026_move_energy_type_to_category.sql),
  // not something chosen per vehicle — which fuel/battery field to show follows whichever
  // category is currently selected.
  const energyType = categories.find((c) => c.id === categoryId)?.energyType;
  const showFuel = energyType === "ICE" || energyType === "HEV" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  if (categories.length === 0 || locations.length === 0) {
    return (
      <p className="text-sm text-fog-400">
        {dict.fleet.vehicleForm.prerequisite}
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => writeDraft(new FormData(e.currentTarget))}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.vehicleForm.plateLabel}</span>
          <input
            type="text"
            name="plate"
            required
            defaultValue={draft.plate ?? ""}
            placeholder={dict.fleet.vehicleForm.platePlaceholder}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm uppercase text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.common.name}</span>
          <input
            type="text"
            name="name"
            defaultValue={draft.name ?? ""}
            placeholder={dict.fleet.vehicleForm.namePlaceholder}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.vehicleForm.colorLabel}</span>
          <select
            name="color"
            defaultValue={draft.color ?? ""}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          >
            <option value="">{dict.common.optional}</option>
            {VEHICLE_COLOR_OPTIONS.map((color) => (
              <option key={color} value={color}>
                {dict.fleet.vehicleForm.colors[color]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.vehicleForm.photoLabel}</span>
          <input
            type="file"
            name="photo"
            accept="image/*"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-xs text-fog-400 outline-none file:mr-2 file:rounded-sm file:border-0 file:bg-line-800 file:px-2 file:py-1 file:text-xs file:text-paper-50 focus-visible:border-gwm-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {dict.fleet.vehicleForm.categoryLabel}
          </span>
          <select
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          >
            <option value="">{dict.fleet.vehicleForm.selectPlaceholder}</option>
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
            defaultValue={draft.odometerKm ?? ""}
            placeholder="0"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
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
            defaultValue={draft.nextServiceOdometerKm ?? ""}
            placeholder={dict.common.optional}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
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
            defaultValue={draft.estimatedRangeKm ?? 400}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>

        {showFuel ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {dict.fleet.vehicleForm.fuelLabel}
            </span>
            <select
              name="fuelLevelPercent"
              defaultValue={draft.fuelLevelPercent ?? 100}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            >
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
              defaultValue={draft.batteryLevelPercent ?? 100}
              className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {dict.fleet.vehicleForm.initialLocationLabel}
          </span>
          <select
            name="locationId"
            required
            defaultValue={draft.locationId ?? ""}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
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

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {errorLabel(dict, state.error)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-sm bg-gwm-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? dict.common.adding : `+ ${dict.fleet.addVehicle.label}`}
      </button>
    </form>
  );
}
