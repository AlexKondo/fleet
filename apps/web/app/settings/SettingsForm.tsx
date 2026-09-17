"use client";

import { useActionState } from "react";
import { saveOrganizationSettings, type SettingsActionState } from "./actions";
import type { Dictionary } from "../../lib/i18n/dictionaries";

export interface SettingsFormValues {
  rangeSafetyBufferPercent: number;
  minChargeHoursBev: number;
  minRefuelHoursIceOrPhev: number;
  minCleaningHours: number;
  carpoolDepartureToleranceMinutes: number;
  carpoolReturnToleranceMinutes: number;
  maintenanceDueSoonDays: number;
  trafficRestrictionEnabled: boolean;
  bookingMode: "ai_recommended" | "user_choice" | "hybrid";
  earlyPickupGraceMinutes: number;
}

const BOOKING_MODE_VALUES: SettingsFormValues["bookingMode"][] = [
  "ai_recommended",
  "hybrid",
  "user_choice",
];

const initialState: SettingsActionState = { status: "idle" };

function errorLabel(dict: Dictionary, code?: string): string {
  const errors = dict.settings.form.errors;
  if (!code) return errors.generic;
  return (errors as Record<string, string>)[code] ?? code;
}

export function SettingsForm({
  dict,
  initialValues,
}: {
  dict: Dictionary;
  initialValues: SettingsFormValues;
}) {
  const [state, formAction, pending] = useActionState(saveOrganizationSettings, initialState);
  const t = dict.settings.form;

  return (
    <form
      action={formAction}
      className="flex max-w-2xl flex-col gap-6 rounded-md border border-line-800 bg-panel-900/60 p-6"
    >
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          {t.range.heading}
        </h2>
        <p className="mt-1 text-xs text-fog-600">{t.range.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.range.safetyBufferLabel}
          </span>
          <input
            type="number"
            name="rangeSafetyBufferPercent"
            required
            min={0}
            max={100}
            step={1}
            defaultValue={initialValues.rangeSafetyBufferPercent}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.range.minChargeHoursBevLabel}
          </span>
          <input
            type="number"
            name="minChargeHoursBev"
            required
            min={0}
            step={0.5}
            defaultValue={initialValues.minChargeHoursBev}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.range.minRefuelHoursLabel}
          </span>
          <input
            type="number"
            name="minRefuelHoursIceOrPhev"
            required
            min={0}
            step={0.5}
            defaultValue={initialValues.minRefuelHoursIceOrPhev}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.range.minCleaningHoursLabel}
          </span>
          <input
            type="number"
            name="minCleaningHours"
            required
            min={0}
            step={0.5}
            defaultValue={initialValues.minCleaningHours}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          {t.carpool.heading}
        </h2>
        <p className="mt-1 text-xs text-fog-600">{t.carpool.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.carpool.departureToleranceLabel}
          </span>
          <input
            type="number"
            name="carpoolDepartureToleranceMinutes"
            required
            min={0}
            step={1}
            defaultValue={initialValues.carpoolDepartureToleranceMinutes}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.carpool.returnToleranceLabel}
          </span>
          <input
            type="number"
            name="carpoolReturnToleranceMinutes"
            required
            min={0}
            step={1}
            defaultValue={initialValues.carpoolReturnToleranceMinutes}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          {t.booking.heading}
        </h2>
        <p className="mt-1 text-xs text-fog-600">{t.booking.description}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        {BOOKING_MODE_VALUES.map((value) => (
          <label
            key={value}
            className="flex items-start gap-2 rounded-sm border border-line-800 bg-panel-800 px-3 py-2"
          >
            <input
              type="radio"
              name="bookingMode"
              value={value}
              defaultChecked={initialValues.bookingMode === value}
              className="mt-0.5 h-4 w-4"
            />
            <span className="flex flex-col">
              <span className="text-sm text-paper-50">{t.booking.modes[value].label}</span>
              <span className="text-xs text-fog-600">{t.booking.modes[value].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          {t.maintenance.heading}
        </h2>
        <p className="mt-1 text-xs text-fog-600">{t.maintenance.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.maintenance.dueSoonDaysLabel}
          </span>
          <input
            type="number"
            name="maintenanceDueSoonDays"
            required
            min={0}
            step={1}
            defaultValue={initialValues.maintenanceDueSoonDays}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-fog-400">
          <input
            type="checkbox"
            name="trafficRestrictionEnabled"
            defaultChecked={initialValues.trafficRestrictionEnabled}
            className="h-4 w-4"
          />
          {t.maintenance.trafficRestrictionLabel}
        </label>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          {t.earlyPickup.heading}
        </h2>
        <p className="mt-1 text-xs text-fog-600">{t.earlyPickup.description}</p>
      </div>

      <label className="flex w-fit flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          {t.earlyPickup.graceMinutesLabel}
        </span>
        <input
          type="number"
          name="earlyPickupGraceMinutes"
          required
          min={0}
          step={1}
          defaultValue={initialValues.earlyPickupGraceMinutes}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
        />
      </label>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {errorLabel(dict, state.error)}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm text-signal-teal">
          {t.success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-fit rounded-sm bg-gwm-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? dict.common.saving : t.submit}
      </button>
    </form>
  );
}
