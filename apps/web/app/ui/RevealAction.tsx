"use client";

import { useState, type ReactNode } from "react";

/**
 * Renders a trigger button first; the (potentially option-heavy) form content only
 * mounts once clicked. Fixes audit finding #4's DOM-cost half: a table with N rows each
 * offering "swap vehicle" / "transfer" used to mount a full <select> with every vehicle
 * or every org member on every row, on every render, whether or not anyone ever used it.
 * Now that cost is paid only for the row actually being acted on.
 */
export function RevealAction({ trigger, children }: { trigger: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-line-800 px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-gwm-accent hover:text-gwm-accent"
      >
        {trigger}
      </button>
    );
  }

  return <>{children}</>;
}
