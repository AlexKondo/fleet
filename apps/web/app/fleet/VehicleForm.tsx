"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createVehicle, type FleetActionState } from "./actions";

const initialState: FleetActionState = { status: "idle" };

export function VehicleForm({
  categories,
  locations,
  onSaved,
}: {
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createVehicle, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [energyType, setEnergyType] = useState<"ICE" | "PHEV" | "BEV">("ICE");

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setEnergyType("ICE");
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const showFuel = energyType === "ICE" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  if (categories.length === 0 || locations.length === 0) {
    return (
      <p className="text-sm text-fog-400">
        Cadastre pelo menos uma categoria e uma localização nas abas &quot;Categorias&quot;
        e &quot;Localizações&quot; antes de adicionar um veículo.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Placa</span>
          <input
            type="text"
            name="plate"
            required
            placeholder="ABC1D23"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm uppercase text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Categoria
          </span>
          <select
            name="categoryId"
            required
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="">Selecionar…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Energia
          </span>
          <select
            name="energyType"
            required
            value={energyType}
            onChange={(e) => setEnergyType(e.target.value as "ICE" | "PHEV" | "BEV")}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="ICE">Combustão (ICE)</option>
            <option value="PHEV">Híbrido plug-in (PHEV)</option>
            <option value="BEV">Elétrico (BEV)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Odômetro (km)
          </span>
          <input
            type="number"
            name="odometerKm"
            required
            min={0}
            defaultValue={0}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Próxima revisão (km)
          </span>
          <input
            type="number"
            name="nextServiceOdometerKm"
            min={0}
            placeholder="Opcional"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Autonomia estimada (km)
          </span>
          <input
            type="number"
            name="estimatedRangeKm"
            required
            min={0}
            defaultValue={400}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>

        {showFuel ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Combustível (%)
            </span>
            <input
              type="number"
              name="fuelLevelPercent"
              min={0}
              max={100}
              defaultValue={100}
              className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
            />
          </label>
        ) : null}

        {showBattery ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Bateria (%)
            </span>
            <input
              type="number"
              name="batteryLevelPercent"
              min={0}
              max={100}
              defaultValue={100}
              className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Localização inicial
          </span>
          <select
            name="locationId"
            required
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            <option value="">Selecionar…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Adicionando…" : "+ Adicionar Veículo"}
      </button>
    </form>
  );
}
