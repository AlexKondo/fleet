"use client";

import { useActionState, useRef, useState } from "react";
import {
  createMobilityPoint,
  deactivateMobilityPoint,
  updateMobilityPoint,
  type MobilityPointActionState,
} from "./actions";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import type { CorporateMobilityPoint } from "@/lib/geospatial/corporateMobilityPoints";

const initialState: MobilityPointActionState = { status: "idle" };

/** Minimal CRUD screen (list / create / edit / deactivate) for Corporate Mobility Points —
 * deliberately no map picker or place-search autocomplete wiring in this phase (that's the
 * matching engine's job, Phase C3+); latitude/longitude are entered directly. */
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
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-paper-50">{t.title}</h1>
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
                <input
                  name="addressLabel"
                  defaultValue={point.addressLabel}
                  required
                  className="w-56 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
                />
                <input
                  name="latitude"
                  type="number"
                  step="any"
                  defaultValue={point.latitude}
                  required
                  className="w-28 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
                />
                <input
                  name="longitude"
                  type="number"
                  step="any"
                  defaultValue={point.longitude}
                  required
                  className="w-28 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
                />
                <input
                  name="category"
                  defaultValue={point.category ?? ""}
                  placeholder={t.categoryPlaceholder}
                  className="w-32 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none"
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
              </div>
            </li>
          ),
        )}
        {points.length === 0 ? <li className="text-xs text-fog-400">{t.empty}</li> : null}
      </ul>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-paper-50">{t.addHeading}</h2>
      <form
        ref={formRef}
        action={async (formData) => {
          await createAction(formData);
          formRef.current?.reset();
        }}
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
          <input
            name="addressLabel"
            required
            className="w-60 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.latitudeLabel}</span>
          <input
            name="latitude"
            type="number"
            step="any"
            required
            className="w-28 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.longitudeLabel}</span>
          <input
            name="longitude"
            type="number"
            step="any"
            required
            className="w-28 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none"
          />
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
