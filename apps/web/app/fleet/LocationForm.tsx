"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLocation, type FleetActionState } from "./actions";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: FleetActionState = { status: "idle" };

export function LocationForm({ dict, onSaved }: { dict: Dictionary; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(createLocation, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex items-end gap-3">
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          {dict.fleet.locations.newLabel}
        </span>
        <input
          type="text"
          name="name"
          required
          placeholder={dict.fleet.locations.placeholder}
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-sm border border-signal-amber px-3 py-2 text-xs font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10 disabled:opacity-50"
      >
        {pending ? dict.common.adding : `+ ${dict.common.add}`}
      </button>
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-signal-red">
          {errorLabel(dict, state.error)}
        </p>
      ) : null}
    </form>
  );
}
