"use client";

import { useActionState, useRef } from "react";
import { addSafetyEquipmentItem, removeSafetyEquipmentItem, type EquipmentActionState } from "./actions";
import type { Dictionary } from "../../lib/i18n/dictionaries";

const initialState: EquipmentActionState = { status: "idle" };

/**
 * Default checklist items (0041_safety_equipment_items.sql) cover the common case, but a
 * fleet's actual trunk kit varies — this is where a fleet_manager/administrator adds
 * whatever else their org's pickup/return checklist should ask about, without needing a
 * code change (the previous 3-item list was hardcoded in checklist.ts).
 */
export function SafetyEquipmentSection({
  dict,
  items,
}: {
  dict: Dictionary;
  items: { id: string; name: string }[];
}) {
  const t = dict.settings.safetyEquipment;
  const [state, formAction, pending] = useActionState(addSafetyEquipmentItem, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-8 border-t border-line-800 pt-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-paper-50">{t.heading}</h2>
      <p className="mb-4 text-xs text-fog-400">{t.description}</p>

      <ul className="mb-4 flex flex-col gap-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2 text-sm text-paper-50"
          >
            {item.name}
            <form action={removeSafetyEquipmentItem.bind(null, item.id)}>
              <button
                type="submit"
                className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red"
              >
                {dict.common.remove}
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form
        ref={formRef}
        action={async (formData) => {
          await formAction(formData);
          formRef.current?.reset();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.nameLabel}</span>
          <input
            type="text"
            name="name"
            required
            placeholder={t.namePlaceholder}
            className="w-56 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm border border-gwm-accent px-3 py-2 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10 disabled:opacity-50"
        >
          {pending ? dict.common.adding : t.addButton}
        </button>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-xs text-signal-red">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
