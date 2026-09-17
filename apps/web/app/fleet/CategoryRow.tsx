"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteCategory, updateCategory, type FleetActionState } from "./actions";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

export function CategoryRow({
  category,
  dict,
}: {
  dict: Dictionary;
  category: {
    id: string;
    name: string;
    passenger_capacity: number;
    supports_cargo: boolean;
    energy_type: string;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateCategory, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCategory, initialState);

  useEffect(() => {
    if (updateState.status === "success") setEditing(false);
  }, [updateState]);

  if (editing) {
    return (
      <li className="flex flex-col gap-3 rounded-md border border-gwm-accent/60 bg-panel-900/60 p-4">
        <form action={updateAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={category.id} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.common.name}</span>
            <input
              type="text"
              name="name"
              required
              defaultValue={category.name}
              autoFocus
              className="rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.categoryForm.passengersLabel}</span>
            <input
              type="number"
              name="passengerCapacity"
              required
              min={0}
              max={60}
              defaultValue={category.passenger_capacity}
              className="w-20 rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-fog-400">
            <input
              type="checkbox"
              name="supportsCargo"
              defaultChecked={category.supports_cargo}
              className="h-4 w-4"
            />
            {dict.fleet.categoryForm.cargoLabel}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{dict.fleet.categoryForm.energyLabel}</span>
            <select
              name="energyType"
              required
              defaultValue={category.energy_type}
              className="rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            >
              <option value="ICE">{dict.fleet.categories.energy.ICE}</option>
              <option value="HEV">{dict.fleet.categories.energy.HEV}</option>
              <option value="PHEV">{dict.fleet.categories.energy.PHEV}</option>
              <option value="BEV">{dict.fleet.categories.energy.BEV}</option>
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={updatePending}
              className="text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:underline disabled:opacity-50"
            >
              {updatePending ? dict.common.saving : dict.common.save}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50"
            >
              {dict.common.cancel}
            </button>
          </div>
        </form>
        {updateState.status === "error" ? (
          <p role="alert" className="text-xs text-signal-red">
            {errorLabel(dict, updateState.error)}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-line-800 bg-panel-900/60 p-4">
      <p className="text-sm text-paper-50">{category.name}</p>
      <p className="text-xs text-fog-600">
        {dict.fleet.categories.passengers.replace("{count}", String(category.passenger_capacity))}
        {category.supports_cargo ? dict.fleet.categories.cargoSuffix : ""}
      </p>
      <p className="text-xs text-fog-600">
        {dict.fleet.categories.energy[
          category.energy_type as keyof typeof dict.fleet.categories.energy
        ] ?? category.energy_type}
      </p>
      <div className="flex items-center gap-3 border-t border-line-800 pt-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent"
        >
          {dict.common.edit}
        </button>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={category.id} />
          <ConfirmSubmitButton
            confirmMessage={dict.fleet.categories.deleteConfirm.replace("{name}", category.name)}
            disabled={deletePending}
            className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red disabled:opacity-50"
          >
            {deletePending ? dict.common.deleting : dict.common.delete}
          </ConfirmSubmitButton>
        </form>
      </div>
      {deleteState.status === "error" ? (
        <p role="alert" className="text-xs text-signal-red">
          {errorLabel(dict, deleteState.error)}
        </p>
      ) : null}
    </li>
  );
}
