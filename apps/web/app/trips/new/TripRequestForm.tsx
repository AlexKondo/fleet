"use client";

import { useState, useTransition } from "react";
import { confirmTrip, planTrip, type PlanTripResult, type TripFormInput } from "./actions";

const REASON_LABELS: Record<string, string> = {
  compatible_trip_found: "Já existe uma viagem compatível — você pode pegar carona.",
  passenger_capacity_sufficient: "Capacidade de passageiros suficiente.",
  cargo_capable: "Veículo apto para transporte de carga.",
  energy_insufficient: "Autonomia atual insuficiente — será preparado antes da viagem.",
  cleaning_required: "Veículo será limpo antes da viagem.",
  no_candidates_available: "Nenhum veículo cadastrado está disponível no momento.",
  no_eligible_vehicle_for_trip_requirements: "Nenhum veículo elegível atende a esta viagem agora.",
  traffic_restriction_active: "Restrição de circulação aplicável a esta viagem (rodízio em São Paulo).",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TripRequestForm() {
  const [plan, setPlan] = useState<PlanTripResult | null>(null);
  const [formInput, setFormInput] = useState<TripFormInput | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isPlanning, startPlanning] = useTransition();
  const [isConfirming, startConfirming] = useTransition();

  function handlePlan(formData: FormData) {
    const input: TripFormInput = {
      departureAt: new Date(String(formData.get("departureAt"))).toISOString(),
      expectedReturnAt: new Date(String(formData.get("expectedReturnAt"))).toISOString(),
      origin: String(formData.get("origin")),
      destination: String(formData.get("destination")),
      distanceKm: Number(formData.get("distanceKm")),
      passengerCount: Number(formData.get("passengerCount")),
      requiresCargo: formData.get("requiresCargo") === "on",
      justification: String(formData.get("justification")),
    };
    setFormInput(input);
    setConfirmError(null);
    startPlanning(async () => {
      const result = await planTrip(input);
      setPlan(result);
    });
  }

  function handleConfirm() {
    if (!formInput || !plan) return;
    const targetId =
      plan.type === "carpool" ? plan.carpool?.reservationId : plan.vehicle?.vehicleId;
    if (!targetId || plan.type === "none") return;

    startConfirming(async () => {
      const result = await confirmTrip({ ...formInput, choice: plan.type as "carpool" | "vehicle", targetId });
      if (!result.success) {
        setConfirmError(result.error ?? "unknown_error");
      }
    });
  }

  const now = new Date();
  const defaultDeparture = toLocalInputValue(new Date(now.getTime() + 60 * 60 * 1000).toISOString());
  const defaultReturn = toLocalInputValue(new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString());

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        action={handlePlan}
        className="flex flex-col gap-4 rounded-md border border-line-800 bg-panel-900/60 p-6"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Saída</span>
            <input
              type="datetime-local"
              name="departureAt"
              required
              defaultValue={defaultDeparture}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Retorno previsto
            </span>
            <input
              type="datetime-local"
              name="expectedReturnAt"
              required
              defaultValue={defaultReturn}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Origem</span>
            <input
              name="origin"
              required
              defaultValue="Iracemápolis"
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Destino</span>
            <input
              name="destination"
              required
              placeholder="São Paulo"
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Distância estimada (km)
            </span>
            <input
              type="number"
              name="distanceKm"
              required
              min={1}
              defaultValue={100}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Passageiros
            </span>
            <input
              type="number"
              name="passengerCount"
              required
              min={1}
              defaultValue={1}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-fog-400">
          <input type="checkbox" name="requiresCargo" className="h-4 w-4" />
          Esta viagem envolve transporte de carga
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Justificativa
          </span>
          <textarea
            name="justification"
            required
            rows={3}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>

        <button
          type="submit"
          disabled={isPlanning}
          className="mt-2 rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPlanning ? "Buscando melhor opção…" : "Buscar recomendação"}
        </button>
      </form>

      <div className="rounded-md border border-line-800 bg-panel-900/60 p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Recomendação
        </h2>

        {!plan ? (
          <p className="text-sm text-fog-600">
            Preencha os dados da viagem para ver a melhor opção de mobilidade.
          </p>
        ) : plan.error ? (
          <p className="text-sm text-signal-red">Não foi possível calcular a recomendação agora.</p>
        ) : plan.type === "carpool" && plan.carpool ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-sm border border-signal-teal/40 bg-signal-teal/10 p-4">
              <p className="text-xs uppercase tracking-widest text-signal-teal">Carona disponível</p>
              <p className="mt-1 font-mono text-lg text-paper-50">{plan.carpool.vehiclePlate}</p>
              <p className="mt-1 text-sm text-fog-400">
                Você pode viajar aceitando os horários já reservados desta viagem.
              </p>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
            <button
              onClick={handleConfirm}
              disabled={isConfirming}
              className="rounded-sm bg-signal-teal px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isConfirming ? "Confirmando…" : "Aceitar carona"}
            </button>
          </div>
        ) : plan.type === "vehicle" && plan.vehicle ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-sm border border-signal-blue/40 bg-signal-blue/10 p-4">
              <p className="text-xs uppercase tracking-widest text-signal-blue">Veículo recomendado</p>
              <p className="mt-1 font-mono text-lg text-paper-50">{plan.vehicle.plate}</p>
              <p className="mt-1 text-sm text-fog-400">{plan.vehicle.categoryName}</p>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.vehicle.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
            {plan.vehicle.requiredPreparation && plan.vehicle.requiredPreparation.length > 0 ? (
              <p className="text-xs text-signal-amber">
                O veículo passará por preparação antes da retirada.
              </p>
            ) : null}
            {plan.vehicle.trafficRestriction?.restricted ? (
              <div className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 p-4">
                <p className="text-xs uppercase tracking-widest text-signal-amber">
                  Restrição de circulação
                </p>
                <p className="mt-1 text-sm text-fog-400">
                  Este veículo está sujeito ao rodízio de veículos em São Paulo no horário
                  desta viagem. Verifique a possibilidade de multa ou considere outro veículo
                  ou horário.
                </p>
              </div>
            ) : null}
            <button
              onClick={handleConfirm}
              disabled={isConfirming}
              className="rounded-sm bg-signal-blue px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isConfirming ? "Confirmando…" : "Solicitar reserva"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-signal-red">
              Nenhuma opção de mobilidade atende esta viagem no momento.
            </p>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
          </div>
        )}

        {confirmError ? (
          <p role="alert" className="mt-4 text-sm text-signal-red">
            Não foi possível confirmar a reserva ({confirmError}). Tente buscar novamente.
          </p>
        ) : null}
      </div>
    </div>
  );
}
