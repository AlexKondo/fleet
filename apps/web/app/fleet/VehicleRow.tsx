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
    <li className="flex flex-col gap-3 rounded-md border border-line-800 bg-panel-900/60 p-4">
      {vehicle.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={vehicle.photoUrl}
          alt={`Foto de ${vehicle.name ?? vehicle.plate}`}
          className="h-32 w-full rounded-sm border border-line-800 object-cover"
        />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg text-paper-50">{vehicle.name ?? vehicle.plate}</p>
          <p className="font-mono text-sm text-fog-400">{vehicle.plate}</p>
          <p className="text-xs text-fog-400">{categoryName}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          <span className={`text-xs uppercase tracking-widest ${meta.text}`}>{meta.label}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line-800 pt-3 text-xs">
        <div>
          <p className="uppercase tracking-widest text-fog-600">Odômetro</p>
          <p className="mt-1 font-mono tabular-nums text-fog-400">
            {vehicle.odometer_km.toLocaleString("pt-BR")} km
          </p>
        </div>
        <div>
          <p className="uppercase tracking-widest text-fog-600">Localização</p>
          <p className="mt-1 text-fog-400">{locationName}</p>
        </div>
        {vehicle.color ? (
          <div>
            <p className="uppercase tracking-widest text-fog-600">Cor</p>
            <p className="mt-1 text-fog-400">{vehicle.color}</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-t border-line-800 pt-3">
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

      {deleteState.status === "error" ? (
        <p role="alert" className="text-xs text-signal-red">
          {deleteState.error}
        </p>
      ) : null}

      {editing ? (
        <div className="border-t border-line-800 pt-3">
          <EditVehicleForm
            vehicle={vehicle}
            categories={categories}
            locations={locations}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
