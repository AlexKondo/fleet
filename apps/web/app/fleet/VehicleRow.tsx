"use client";

import Link from "next/link";
import Image from "next/image";
import { useActionState, useState } from "react";
import { deleteVehicle, type FleetActionState } from "./actions";
import type { StatusMeta } from "../dashboard/statusMeta";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";
import { StatusBadge } from "../ui/StatusBadge";
import { EditVehicleForm, type EditableVehicle } from "./EditVehicleForm";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { VEHICLE_COLOR_OPTIONS, type VehicleColorValue } from "@/lib/domain/vehicleFieldOptions";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

/** vehicles.color stores the stable pt-BR value; free-text/legacy values pass through. */
function colorLabel(dict: Dictionary, color: string): string {
  return (VEHICLE_COLOR_OPTIONS as readonly string[]).includes(color)
    ? dict.fleet.vehicleForm.colors[color as VehicleColorValue]
    : color;
}

export function VehicleRow({
  vehicle,
  statusMeta,
  categoryName,
  locationName,
  categories,
  locations,
  dict,
  locale,
}: {
  vehicle: EditableVehicle;
  statusMeta: StatusMeta;
  categoryName: string;
  locationName: string;
  categories: { id: string; name: string; energyType: string }[];
  locations: { id: string; name: string }[];
  dict: Dictionary;
  locale: Locale;
}) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteVehicle, initialState);
  const meta = statusMeta;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-line-800 bg-panel-900/60 p-4">
      {vehicle.photoUrl ? (
        // next/image (not a bare <img>): these are raw phone-camera uploads served
        // straight from Supabase Storage at full resolution into a 128px-tall card. The
        // optimizer resizes and re-encodes to the actual displayed size, and `sizes`
        // describes the responsive grid below (1 / 2 / 3 columns) so it never fetches a
        // width wider than the column. Lazy loading is the default, so the cards below
        // the fold on a large fleet cost nothing until scrolled to.
        <div className="relative h-32 w-full overflow-hidden rounded-sm border border-line-800">
          <Image
            src={vehicle.photoUrl}
            alt={dict.fleet.vehicleForm.photoAlt.replace("{name}", vehicle.name ?? vehicle.plate)}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg text-paper-50">{vehicle.name ?? vehicle.plate}</p>
          <p className="font-mono text-sm text-fog-400">{vehicle.plate}</p>
          <p className="text-xs text-fog-400">{categoryName}</p>
        </div>
        <StatusBadge meta={meta} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line-800 pt-3 text-xs">
        <div>
          <p className="uppercase tracking-widest text-fog-600">{dict.fleet.vehicleRow.odometer}</p>
          <p className="mt-1 font-mono tabular-nums text-fog-400">
            {vehicle.odometer_km.toLocaleString(locale)} km
          </p>
        </div>
        <div>
          <p className="uppercase tracking-widest text-fog-600">{dict.fleet.vehicleRow.location}</p>
          <p className="mt-1 text-fog-400">{locationName}</p>
        </div>
        {vehicle.color ? (
          <div>
            <p className="uppercase tracking-widest text-fog-600">{dict.fleet.vehicleRow.color}</p>
            <p className="mt-1 text-fog-400">{colorLabel(dict, vehicle.color)}</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-t border-line-800 pt-3">
        <Link
          href={`/fleet/vehicles/${vehicle.id}`}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent"
        >
          {dict.fleet.vehicleRow.viewSchedule}
        </Link>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent"
        >
          {editing ? dict.common.close : dict.common.edit}
        </button>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={vehicle.id} />
          <ConfirmSubmitButton
            confirmMessage={dict.fleet.vehicleRow.deleteConfirm.replace("{plate}", vehicle.plate)}
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

      {editing ? (
        <div className="border-t border-line-800 pt-3">
          <EditVehicleForm
            vehicle={vehicle}
            categories={categories}
            locations={locations}
            dict={dict}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
