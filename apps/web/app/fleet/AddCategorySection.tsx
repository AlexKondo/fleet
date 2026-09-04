"use client";

import { useState } from "react";
import { CategoryForm } from "./CategoryForm";

/** See AddVehicleSection.tsx for why this is its own client component, not a shared
 * render-prop toggle. */
export function AddCategorySection() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10"
      >
        + Adicionar Categoria
      </button>
    );
  }

  return (
    <div className="rounded-sm border border-line-800 bg-panel-800/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          Adicionar Categoria
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red"
        >
          Fechar
        </button>
      </div>
      <CategoryForm onSaved={() => setOpen(false)} />
    </div>
  );
}
