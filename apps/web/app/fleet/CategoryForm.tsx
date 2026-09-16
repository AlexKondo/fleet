"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCategory, type FleetActionState } from "./actions";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

export function CategoryForm({ dict, onSaved }: { dict: Dictionary; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(createCategory, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.common.name}</span>
        <input
          type="text"
          name="name"
          required
          placeholder={dict.fleet.categoryForm.namePlaceholder}
          className="w-40 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          {dict.fleet.categoryForm.passengersLabel}
        </span>
        <input
          type="number"
          name="passengerCapacity"
          required
          min={0}
          max={60}
          defaultValue={5}
          className="w-24 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
      </label>
      <label className="flex items-center gap-2 pb-2.5 text-sm text-fog-400">
        <input type="checkbox" name="supportsCargo" className="h-4 w-4" />
        {dict.fleet.categoryForm.cargoLabel}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.categoryForm.energyLabel}</span>
        <select
          name="energyType"
          required
          defaultValue="ICE"
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        >
          <option value="ICE">{dict.fleet.categories.energy.ICE}</option>
          <option value="HEV">{dict.fleet.categories.energy.HEV}</option>
          <option value="PHEV">{dict.fleet.categories.energy.PHEV}</option>
          <option value="BEV">{dict.fleet.categories.energy.BEV}</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-sm border border-signal-amber px-3 py-2 text-xs font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10 disabled:opacity-50"
      >
        {pending ? dict.common.adding : `+ ${dict.common.add}`}
      </button>
      {state.status === "error" ? (
        <p role="alert" className="w-full text-xs text-signal-red">
          {errorLabel(dict, state.error)}
        </p>
      ) : null}
    </form>
  );
}
