"use client";

import { useState } from "react";
import { VehicleForm } from "./VehicleForm";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * "+ Adicionar Veículo" reveal — the create form starts hidden and only appears once
 * asked for, instead of always sitting open (which is why "where do I add a vehicle?"
 * was a real question). Deliberately its own client component rather than a generic
 * "AddToggle" taking a render-prop function: fleet/page.tsx (a Server Component) can't
 * pass a function prop to a Client Component — only plain, serializable data — so the
 * toggle-open state and the onSaved-closes-it wiring both have to live in one client
 * component that owns VehicleForm directly.
 */
export function AddVehicleSection({
  categories,
  locations,
  dict,
}: {
  categories: { id: string; name: string; energyType: string }[];
  locations: { id: string; name: string }[];
  dict: Dictionary;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-gwm-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10"
      >
        + {dict.fleet.addVehicle.label}
      </button>
    );
  }

  return (
    <div className="rounded-sm border border-line-800 bg-panel-800/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          {dict.fleet.addVehicle.label}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red"
        >
          {dict.common.close}
        </button>
      </div>
      <VehicleForm
        categories={categories}
        locations={locations}
        dict={dict}
        onSaved={() => setOpen(false)}
      />
    </div>
  );
}
