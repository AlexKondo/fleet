"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteCategory, updateCategory, type FleetActionState } from "./actions";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";

const initialState: FleetActionState = { status: "idle" };

export function CategoryRow({
  category,
}: {
  category: { id: string; name: string; passenger_capacity: number; supports_cargo: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateCategory, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCategory, initialState);

  useEffect(() => {
    if (updateState.status === "success") setEditing(false);
  }, [updateState]);

  if (editing) {
    return (
      <li className="flex flex-wrap items-end gap-3 rounded-sm border border-signal-amber/60 bg-panel-900/60 px-3 py-2">
        <form action={updateAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={category.id} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Nome</span>
            <input
              type="text"
              name="name"
              required
              defaultValue={category.name}
              autoFocus
              className="w-32 rounded-sm border border-line-800 bg-panel-800 px-2 py-1 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Passageiros</span>
            <input
              type="number"
              name="passengerCapacity"
              required
              min={0}
              max={60}
              defaultValue={category.passenger_capacity}
              className="w-20 rounded-sm border border-line-800 bg-panel-800 px-2 py-1 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-fog-400">
            <input
              type="checkbox"
              name="supportsCargo"
              defaultChecked={category.supports_cargo}
              className="h-4 w-4"
            />
            Carga
          </label>
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
      <span>
        {category.name}{" "}
        <span className="text-fog-600">
          · {category.passenger_capacity} passageiros{category.supports_cargo ? " · carga" : ""}
        </span>
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
      >
        Editar
      </button>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={category.id} />
        <ConfirmSubmitButton
          confirmMessage={`Excluir a categoria "${category.name}"?`}
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
