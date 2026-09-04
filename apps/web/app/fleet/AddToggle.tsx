"use client";

import { useState } from "react";

/**
 * Generic "+ Adicionar X" reveal: the create form starts hidden and only appears once the
 * user asks for it, instead of always sitting open at the bottom of the list (which is
 * why "where do I add a vehicle?" was a real question — the form looked like leftover
 * page content, not an action). `render` gets an `onSaved` callback to auto-collapse back
 * to the button after a successful submit.
 */
export function AddToggle({
  label,
  render,
}: {
  label: string;
  render: (onSaved: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10"
      >
        + Adicionar {label}
      </button>
    );
  }

  return (
    <div className="rounded-sm border border-line-800 bg-panel-800/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          Adicionar {label}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red"
        >
          Fechar
        </button>
      </div>
      {render(() => setOpen(false))}
    </div>
  );
}
