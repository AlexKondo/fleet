"use client";

import { useActionState } from "react";
import { saveOrganizationSettings, type SettingsActionState } from "./actions";

export interface SettingsFormValues {
  rangeSafetyBufferPercent: number;
  minChargeHoursBev: number;
  minRefuelHoursIceOrPhev: number;
  minCleaningHours: number;
  carpoolDepartureToleranceMinutes: number;
  carpoolReturnToleranceMinutes: number;
  maintenanceDueSoonDays: number;
  trafficRestrictionEnabled: boolean;
}

const initialState: SettingsActionState = { status: "idle" };

const ERROR_LABELS: Record<string, string> = {
  not_authenticated: "Sessão expirada — faça login novamente.",
  not_authorized: "Você não tem permissão para alterar estas configurações.",
  invalid_values:
    "Verifique os valores informados — todos devem ser números válidos e não negativos.",
};

function errorLabel(code?: string): string {
  if (!code) return "Não foi possível salvar as configurações agora.";
  return ERROR_LABELS[code] ?? code;
}

export function SettingsForm({ initialValues }: { initialValues: SettingsFormValues }) {
  const [state, formAction, pending] = useActionState(saveOrganizationSettings, initialState);

  return (
    <form
      action={formAction}
      className="flex max-w-2xl flex-col gap-6 rounded-md border border-line-800 bg-panel-900/60 p-6"
    >
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          Autonomia &amp; Preparação de Veículos
        </h2>
        <p className="mt-1 text-xs text-fog-600">
          Parâmetros usados pelo Mobility Decision Engine para avaliar se um veículo está
          pronto para uma viagem específica (§7, §8).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Margem de segurança de autonomia (%)
          </span>
          <input
            type="number"
            name="rangeSafetyBufferPercent"
            required
            min={0}
            max={100}
            step={1}
            defaultValue={initialValues.rangeSafetyBufferPercent}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Horas mín. de recarga (BEV)
          </span>
          <input
            type="number"
            name="minChargeHoursBev"
            required
            min={0}
            step={0.5}
            defaultValue={initialValues.minChargeHoursBev}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Horas mín. de abastecimento (ICE/PHEV)
          </span>
          <input
            type="number"
            name="minRefuelHoursIceOrPhev"
            required
            min={0}
            step={0.5}
            defaultValue={initialValues.minRefuelHoursIceOrPhev}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Horas mín. de limpeza
          </span>
          <input
            type="number"
            name="minCleaningHours"
            required
            min={0}
            step={0.5}
            defaultValue={initialValues.minCleaningHours}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          Corporate Carpooling
        </h2>
        <p className="mt-1 text-xs text-fog-600">
          Tolerância de horário para considerar uma viagem existente compatível com uma nova
          solicitação de carona (§4).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Tolerância de saída (min)
          </span>
          <input
            type="number"
            name="carpoolDepartureToleranceMinutes"
            required
            min={0}
            step={1}
            defaultValue={initialValues.carpoolDepartureToleranceMinutes}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Tolerância de retorno (min)
          </span>
          <input
            type="number"
            name="carpoolReturnToleranceMinutes"
            required
            min={0}
            step={1}
            defaultValue={initialValues.carpoolReturnToleranceMinutes}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">
          Manutenção Preditiva &amp; Restrição de Circulação
        </h2>
        <p className="mt-1 text-xs text-fog-600">
          Janela de aviso de revisão (§12) e alerta de rodízio de veículos em São Paulo (§15).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Janela de revisão &quot;em breve&quot; (dias)
          </span>
          <input
            type="number"
            name="maintenanceDueSoonDays"
            required
            min={0}
            step={1}
            defaultValue={initialValues.maintenanceDueSoonDays}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-fog-400">
          <input
            type="checkbox"
            name="trafficRestrictionEnabled"
            defaultChecked={initialValues.trafficRestrictionEnabled}
            className="h-4 w-4"
          />
          Alertar sobre rodízio de veículos em São Paulo
        </label>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {errorLabel(state.error)}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm text-signal-teal">
          Configurações salvas.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-fit rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar Configurações"}
      </button>
    </form>
  );
}
