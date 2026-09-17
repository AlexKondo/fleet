"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteLocation, updateLocation, type FleetActionState } from "./actions";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

export function LocationRow({
  location,
  dict,
}: {
  location: { id: string; name: string };
  dict: Dictionary;
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateLocation, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteLocation, initialState);

  useEffect(() => {
    if (updateState.status === "success") setEditing(false);
  }, [updateState]);

  if (editing) {
    return (
      <li className="flex flex-col gap-3 rounded-md border border-gwm-accent/60 bg-panel-900/60 p-4">
        <form action={updateAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={location.id} />
          <input
            type="text"
            name="name"
            required
            defaultValue={location.name}
            autoFocus
            className="rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
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
      <p className="text-sm text-paper-50">{location.name}</p>
      <div className="flex items-center gap-3 border-t border-line-800 pt-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent"
        >
          {dict.common.edit}
        </button>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={location.id} />
          <ConfirmSubmitButton
            confirmMessage={dict.fleet.locations.deleteConfirm.replace("{name}", location.name)}
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
