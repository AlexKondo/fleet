"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { PlaceAutocomplete } from "../../carpool/PlaceAutocomplete";
import {
  createMobilityPoint,
  deactivateMobilityPoint,
  deleteMobilityPoint,
  updateMobilityPoint,
  type MobilityPointActionState,
} from "./actions";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import type { CorporateMobilityPoint } from "@/lib/geospatial/corporateMobilityPoints";

const initialState: MobilityPointActionState = { status: "idle" };

const EDIT_INPUT = "w-56 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none";
const NEW_INPUT = "w-60 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none";

/** The address field: the same Google suggestions the reservation form shows (the coordinates are found from the chosen address when saving). */
function AddressField({ id, initial, dict, className }: { id: string; initial: string; dict: Dictionary; className: string }) {
  const [value, setValue] = useState(initial);
  return <PlaceAutocomplete id={id} name="addressLabel" value={value} onChange={setValue} dict={dict} required className={className} maxLength={300} />;
}

/** Minimal CRUD screen (list / create / edit / deactivate) for Corporate Mobility Points —
 * deliberately no map picker or place-search autocomplete wiring in this phase (that's the
 * matching engine's job, Phase C3+); the coordinates come from the address (geocoded when saving). */
export function MobilityPointsSection({
  dict,
  points,
}: {
  dict: Dictionary;
  points: CorporateMobilityPoint[];
}) {
  const t = dict.mobilityPoints;
  const [createState, createAction, creating] = useActionState(createMobilityPoint, initialState);
  const [updateState, updateAction, updating] = useActionState(updateMobilityPoint, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // the form (and the address field) is emptied only when the point was really saved, so a wrong address is not lost
  const [addressKey, setAddressKey] = useState(0);
  useEffect(() => {
    if (createState.status === "success") {
      formRef.current?.reset();
      setAddressKey((k) => k + 1);
    }
  }, [createState]);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <p className="mb-4 text-xs text-fog-400">{t.description}</p>

      <ul className="mb-6 flex flex-col gap-1.5">
        {points.map((point) =>
          editingId === point.id ? (
            <li
              key={point.id}
              className="rounded-sm border border-line-800 bg-panel-900/60 px-3 py-3 text-sm text-paper-50"
            >
              <form action={updateAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={point.id} />
                <input
                  name="name"
                  defaultValue={point.name}
                  required
                  className="w-40 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
                />
                <AddressField id={`mp-address-${point.id}`} initial={point.addressLabel} dict={dict} className={EDIT_INPUT} />
                <input
                  name="category"
                  defaultValue={point.category ?? ""}
                  placeholder={t.categoryPlaceholder}
                  className="w-32 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
                />
                <input
                  name="aliases"
                  defaultValue={point.aliases.join(", ")}
                  placeholder={t.aliasesPlaceholder}
                  aria-label={t.aliasesLabel}
                  className="w-52 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
                />
                <button
                  type="submit"
                  disabled={updating}
                  className="rounded-sm border border-gwm-accent px-2 py-1.5 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10 disabled:opacity-50"
                  onClick={() => setEditingId(null)}
                >
                  {dict.common.save}
                </button>
                <button
                  type="button"
                  className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50"
                  onClick={() => setEditingId(null)}
                >
                  {dict.common.cancel}
                </button>
              </form>
            </li>
          ) : (
            <li
              key={point.id}
              className="flex items-center justify-between rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2 text-sm text-paper-50"
            >
              <div>
                <span className={point.isActive ? "" : "text-fog-600 line-through"}>{point.name}</span>
                <span className="ml-2 text-xs text-fog-400">{point.addressLabel}</span>
                {point.aliases.length > 0 ? (
                  <span className="ml-2 text-xs text-fog-400" data-testid="mp-aliases">
                    · {t.aliasesLabel}: {point.aliases.join(", ")}
                  </span>
                ) : null}
                {!point.isActive ? (
                  <span className="ml-2 text-xs uppercase tracking-widest text-fog-600">{t.inactiveLabel}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50"
                  onClick={() => setEditingId(point.id)}
                >
                  {dict.common.edit}
                </button>
                {point.isActive ? (
                  <form action={deactivateMobilityPoint.bind(null, point.id)}>
                    <button
                      type="submit"
                      className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red"
                    >
                      {t.deactivateAction}
                    </button>
                  </form>
                ) : null}
                <form
                  action={deleteMobilityPoint.bind(null, point.id)}
                  onSubmit={(e) => {
                    if (!window.confirm(t.deleteConfirm)) e.preventDefault();
                  }}
                >
                  <button type="submit" className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red">
                    {t.deleteAction}
                  </button>
                </form>
              </div>
            </li>
          ),
        )}
        {points.length === 0 ? <li className="text-xs text-fog-400">{t.empty}</li> : null}
      </ul>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-paper-50">{t.addHeading}</h2>
      <form
        ref={formRef}
        action={createAction}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.nameLabel}</span>
          <input
            name="name"
            required
            className="w-44 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.addressLabel}</span>
          <AddressField key={addressKey} id="mp-address-new" initial="" dict={dict} className={NEW_INPUT} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.categoryLabel}</span>
          <input
            name="category"
            placeholder={t.categoryPlaceholder}
            className="w-32 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.aliasesLabel}</span>
          <input
            name="aliases"
            placeholder={t.aliasesPlaceholder}
            className="w-52 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="rounded-sm border border-gwm-accent px-3 py-2 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10 disabled:opacity-50"
        >
          {creating ? dict.common.adding : t.addButton}
        </button>
      </form>
      {createState.status === "error" ? (
        <p role="alert" className="mt-2 text-xs text-signal-red">
          {createState.error}
        </p>
      ) : null}
      {updateState.status === "error" ? (
        <p role="alert" className="mt-2 text-xs text-signal-red">
          {updateState.error}
        </p>
      ) : null}
    </div>
  );
}
