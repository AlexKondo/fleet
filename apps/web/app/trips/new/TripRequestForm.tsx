"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { confirmTrip, planTripAction, type PlanTripResult, type TripFormInput } from "./actions";
import { formatDateTime } from "@/lib/formatDateTime";

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

const DRAFT_STORAGE_KEY = "fleet.trip-request-draft.v1";
// Only worth restoring if it's from moments ago (e.g. a stray remount right after
// submitting) — an old abandoned draft from a prior visit shouldn't reappear.
const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;

interface TripRequestDraft {
  savedAt: number;
  fields: Record<string, string>;
}

function readDraft(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const draft = JSON.parse(raw) as TripRequestDraft;
    if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return {};
    return draft.fields ?? {};
  } catch {
    return {};
  }
}

function writeDraft(formData: FormData): void {
  try {
    const fields: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") fields[key] = value;
    }
    const draft: TripRequestDraft = { savedAt: Date.now(), fields };
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable (private browsing, disabled) — just skip persistence.
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function TripRequestForm() {
  const [plan, planAction, isPlanning] = useActionState<PlanTripResult | null, FormData>(
    planTripAction,
    null,
  );
  const [formInput, setFormInput] = useState<TripFormInput | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isConfirming, startConfirming] = useTransition();
  // Read once, on mount — see writeDraft/readDraft: a defensive backstop against a stray
  // client-side remount losing whatever the user had just typed (matches feedback: form
  // fields reverting to today's date right after clicking "Buscar recomendação").
  const [draft] = useState(readDraft);

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    const formData = new FormData(e.currentTarget);
    writeDraft(formData);
    setFormInput({
      departureAt: new Date(String(formData.get("departureAt"))).toISOString(),
      expectedReturnAt: new Date(String(formData.get("expectedReturnAt"))).toISOString(),
      origin: String(formData.get("origin")),
      destination: String(formData.get("destination")),
      distanceKm: Number(formData.get("distanceKm")),
      passengerCount: Number(formData.get("passengerCount")),
      requiresCargo: formData.get("requiresCargo") === "on",
      justification: String(formData.get("justification")),
    });
    setConfirmError(null);
  }

  function handleConfirm(targetId?: string) {
    if (!formInput || !plan) return;
    const resolvedTargetId = targetId ?? (plan.type === "vehicle" ? plan.vehicle?.vehicleId : undefined);
    if (!resolvedTargetId || plan.type === "none") return;

    startConfirming(async () => {
      const result = await confirmTrip({
        ...formInput,
        choice: plan.type as "carpool" | "vehicle",
        targetId: resolvedTargetId,
      });
      // On success confirmTrip redirects server-side, so this line is rarely reached —
      // best-effort only, the 5-minute TTL in readDraft is the real backstop.
      if (result.success) {
        clearDraft();
      } else {
        setConfirmError(result.error ?? "unknown_error");
      }
    });
  }

  const now = new Date();
  const defaultDeparture =
    draft.departureAt ?? toLocalInputValue(new Date(now.getTime() + 60 * 60 * 1000).toISOString());
  const defaultReturn =
    draft.expectedReturnAt ?? toLocalInputValue(new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString());

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        action={planAction}
        onSubmit={handleFormSubmit}
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
              defaultValue={draft.origin ?? "Iracemápolis"}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Destino</span>
            <input
              name="destination"
              required
              defaultValue={draft.destination}
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
              defaultValue={draft.distanceKm ?? 100}
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
              defaultValue={draft.passengerCount ?? 1}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-fog-400">
          <input
            type="checkbox"
            name="requiresCargo"
            defaultChecked={draft.requiresCargo === "on"}
            className="h-4 w-4"
          />
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
            defaultValue={draft.justification}
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
        ) : plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-widest text-signal-teal">
              {plan.carpoolOptions.length > 1
                ? `${plan.carpoolOptions.length} caronas compatíveis`
                : "Carona disponível"}
            </p>
            {plan.carpoolOptions.length > 1 ? (
              <p className="text-xs text-fog-600">
                O destino é comparado de forma aproximada (sem acentuação/maiúsculas e
                lugares mais específicos contam como o mesmo destino) — confira cada opção
                antes de aceitar.
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {plan.carpoolOptions.map((option) => (
                <li
                  key={option.reservationId}
                  className="rounded-sm border border-signal-teal/40 bg-signal-teal/10 p-4"
                >
                  <p className="font-mono text-lg text-paper-50">{option.vehiclePlate}</p>
                  <p className="mt-1 text-sm text-fog-400">
                    Saída {formatDateTime(option.departureAt)} · Retorno{" "}
                    {formatDateTime(option.expectedReturnAt)}
                  </p>
                  <button
                    onClick={() => handleConfirm(option.reservationId)}
                    disabled={isConfirming}
                    className="mt-3 rounded-sm bg-signal-teal px-4 py-2 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {isConfirming ? "Confirmando…" : "Aceitar esta carona"}
                  </button>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
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
              onClick={() => handleConfirm(plan.vehicle!.vehicleId)}
              disabled={isConfirming}
              className="rounded-sm bg-signal-blue px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isConfirming ? "Confirmando…" : "Solicitar reserva"}
            </button>

            {plan.vehicle.alternatives.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-line-800 pt-4">
                <p className="text-xs uppercase tracking-widest text-fog-400">
                  {plan.bookingMode === "user_choice"
                    ? "Outros veículos elegíveis"
                    : "Prefere outro veículo elegível?"}
                </p>
                <ul className="flex flex-col gap-2">
                  {plan.vehicle.alternatives.map((alt) => (
                    <li
                      key={alt.vehicleId}
                      className="flex items-center justify-between gap-3 rounded-sm border border-line-800 bg-panel-800 px-3 py-2.5"
                    >
                      <div>
                        <p className="font-mono text-sm text-paper-50">{alt.plate}</p>
                        <p className="text-xs text-fog-600">{alt.categoryName}</p>
                      </div>
                      <button
                        onClick={() => handleConfirm(alt.vehicleId)}
                        disabled={isConfirming}
                        className="shrink-0 rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-blue hover:text-signal-blue disabled:opacity-50"
                      >
                        Escolher
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
            {confirmError === "RESERVATION_CONFLICT"
              ? "Esse veículo acabou de ser reservado por outra pessoa nesse mesmo horário. Busque novamente para ver as opções atualizadas."
              : `Não foi possível confirmar a reserva (${confirmError}). Tente buscar novamente.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
