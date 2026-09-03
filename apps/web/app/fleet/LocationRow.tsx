"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteLocation, updateLocation, type FleetActionState } from "./actions";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";

const initialState: FleetActionState = { status: "idle" };

export function LocationRow({ location }: { location: { id: string; name: string } }) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateLocation, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteLocation, initialState);

  useEffect(() => {
    if (updateState.status === "success") setEditing(false);
  }, [updateState]);

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-sm border border-signal-amber/60 bg-panel-900/60 px-3 py-1.5">
        <form action={updateAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={location.id} />
          <input
            type="text"
            name="name"
            required
            defaultValue={location.name}
            autoFocus
            className="w-32 rounded-sm border border-line-800 bg-panel-800 px-2 py-1 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
          <button
            type="submit"
            disabled={updatePending}
            className="text-xs font-semibold uppercase tracking-widest text-signal-amber hover:underline disabled:opacity-50"
          >
            {updatePending ? "Salvando…" : "Salvar"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50"
        >
          Cancelar
        </button>
        {updateState.status === "error" ? (
          <p role="alert" className="w-full text-xs text-signal-red">
            {updateState.error}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-sm border border-line-800 bg-panel-900/60 px-3 py-1.5 text-sm text-paper-50">
      <span>{location.name}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
      >
        Editar
      </button>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={location.id} />
        <ConfirmSubmitButton
          confirmMessage={`Excluir a localização "${location.name}"?`}
          disabled={deletePending}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red disabled:opacity-50"
        >
          {deletePending ? "Excluindo…" : "Excluir"}
        </ConfirmSubmitButton>
      </form>
      {deleteState.status === "error" ? (
        <p role="alert" className="w-full text-xs text-signal-red">
          {deleteState.error}
        </p>
      ) : null}
    </li>
  );
}
