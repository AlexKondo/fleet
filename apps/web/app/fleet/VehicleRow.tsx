"use client";

import { useActionState, useState } from "react";
import { deleteVehicle, type FleetActionState } from "./actions";
import { STATUS_META } from "../dashboard/statusMeta";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import { EditVehicleForm, type EditableVehicle } from "./EditVehicleForm";

const initialState: FleetActionState = { status: "idle" };

export function VehicleRow({
  vehicle,
  status,
  categoryName,
  locationName,
  categories,
  locations,
}: {
  vehicle: EditableVehicle;
  status: keyof typeof STATUS_META;
  categoryName: string;
  locationName: string;
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteVehicle, initialState);
  const meta = STATUS_META[status];

  return (
    <>
      <tr className="border-b border-line-800 last:border-0">
        <td className="px-4 py-3 font-mono tabular-nums text-paper-50">{vehicle.plate}</td>
        <td className="px-4 py-3 text-fog-400">{categoryName}</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            <span className={meta.text}>{meta.label}</span>
          </span>
        </td>
        <td className="px-4 py-3 font-mono tabular-nums text-fog-400">
          {vehicle.odometer_km.toLocaleString("pt-BR")} km
        </td>
        <td className="px-4 py-3 text-fog-400">{locationName}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
            >
              {editing ? "Fechar" : "Editar"}
            </button>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={vehicle.id} />
              <ConfirmSubmitButton
                confirmMessage={`Excluir o veículo ${vehicle.plate}? Isso só é possível se ele nunca teve reservas ou inspeções.`}
                disabled={deletePending}
                className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red disabled:opacity-50"
              >
                {deletePending ? "Excluindo…" : "Excluir"}
              </ConfirmSubmitButton>
            </form>
          </div>
        </td>
      </tr>
      {editing ? (
        <tr className="border-b border-line-800 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            <EditVehicleForm
              vehicle={vehicle}
              categories={categories}
              locations={locations}
              onSaved={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          </td>
        </tr>
      ) : null}
      {deleteState.status === "error" ? (
        <tr className="border-b border-line-800 last:border-0">
          <td colSpan={6} className="px-4 pb-3">
            <p role="alert" className="text-xs text-signal-red">
              {deleteState.error}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
