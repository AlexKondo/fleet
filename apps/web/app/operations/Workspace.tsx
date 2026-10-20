import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { FmShell } from "../carpool/FmShell";
import type { NavKey } from "../shellData";
import type { OperationalData } from "@/lib/operations/load";
import { executeOperation } from "./actions";
import "./operations.css";
export const money = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const date = (value: string | null, time = false) =>
  !value
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(
        new Date(value.length === 10 ? value + "T12:00:00-03:00" : value),
      );
const errors: Record<string, string> = {
 SELF_APPROVAL_DENIED:"Quem criou ou lançou o orçamento não pode aprová-lo. Encaminhe ao superior autorizado.",
 SUPERIOR_APPROVAL_REQUIRED:"Este orçamento exige aprovação de outro gestor superior designado para a unidade.",
 APPROVER_NOT_AUTHORIZED:"O aprovador deve estar ativo, autorizado para a unidade e previsto na política.",
 BUDGET_APPROVAL_PENDING:"A revisão do orçamento aguarda aprovação independente.",
  NOT_AUTHORIZED: "Seu perfil não pode executar esta ação.",
  NOT_FOUND: "Registro não encontrado no seu escopo.",
  INVALID_INPUT: "Confira os campos informados.",
  INVALID_STATE_TRANSITION: "Esta ação não é válida para o estado atual.",
  CONCURRENT_UPDATE:
    "O registro mudou. Recarregue a página e confira os dados antes de tentar novamente.",
  IDEMPOTENCY_CONFLICT:
    "O identificador desta solicitação já foi utilizado com outros dados. Recarregue a página.",
  MAINTENANCE_CONFLICT:
    "Existe manutenção programada para esse veículo neste intervalo.",
  RESERVATION_CONFLICT:
    "O horário conflita com uma reserva ativa. Ajuste o planejamento.",
  POWERTRAIN_MISMATCH: "O tipo de registro não é compatível com a motorização.",
  APPROVED_BUDGET_EXCEEDED:
    "O custo efetivo ultrapassa o orçamento aprovado. Solicite revisão antes de concluir.",
  DEPARTURE_BLOCKED: "Saída impedida. Confira reserva, veículo e bloqueios.",
  CHECKLIST_REQUIRED:
    "Os checklists independentes do colaborador e da portaria precisam estar concluídos.",
  OUTSIDE_RESERVATION_WINDOW: "A saída está fora da janela da reserva.",
  OUTSIDE_MAINTENANCE_WINDOW:
    "A manutenção ainda não está na janela programada.",
  LEGACY_ARRIVAL_REASON_REQUIRED:
    "Informe a justificativa para chegada de uma viagem sem saída registrada neste módulo.",
  VEHICLE_NOT_READY: "O estado atual do veículo impede o início da manutenção.",
  IMMUTABLE_VIN: "O VIN já registrado é imutável.",
};
export async function Workspace({
  data,
  title,
  subtitle,
  active,
  children,
  error,
  success,
  managerView = false,
}: {
  data: OperationalData;
  title: string;
  subtitle: string;
  active: NavKey;
  children: ReactNode;
  error?: string;
  success?: string;
  managerView?: boolean;
}) {
  const p = data.profile;
  return (
    <FmShell
      orgName={p.organization?.name ?? "—"}
      userName={p.full_name}
      role={p.role}
      isFleetManager={data.manager}
      isAdministrator={p.role === "administrator"}
      active={active}
      wide
      workspace={managerView ? "manager" : "operations"}
    >
      <div className="ow">
        <header className="ow-heading">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <Link
            href={managerView ? "/dashboard/command-center" : "/maintenance"}
            className="ow-link"
          >
            Central de Comando →
          </Link>
        </header>
        {error && (
          <p className="ow-banner ow-error" role="alert">
            {errors[error] ??
              "Não foi possível concluir a operação. Confira o ambiente e tente novamente."}
          </p>
        )}
        {success && (
          <p className="ow-banner" role="status">
            Operação registrada e auditada.
          </p>
        )}
        {data.unavailable && (
          <p className="ow-banner ow-error" role="alert">
            Algumas fontes estão indisponíveis. Campos sem fonte confirmada
            aparecem como “—”.{" "}
            {data.migrationUnavailable
              ? "Consulte a equipe responsável pelo ambiente."
              : ""}
          </p>
        )}
        {children}
      </div>
    </FmShell>
  );
}
export function Panel({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ow-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
export function Metrics({
  items,
}: {
  items: {
    label: string;
    value: string | number | null;
    detail?: string;
    tone?: string;
  }[];
}) {
  return (
    <section className="ow-metrics" aria-label="Indicadores operacionais">
      {items.map((i) => (
        <div className="ow-panel ow-metric" key={i.label}>
          <span
            className={`ow-metric-symbol ${i.tone ?? ""}`}
            aria-hidden="true"
          >
            ◇
          </span>
          <div>
            <strong>{i.value === null ? "—" : i.value}</strong>
            <span>{i.label}</span>
            {i.detail && <small>{i.detail}</small>}
          </div>
        </div>
      ))}
    </section>
  );
}
export function Empty({
  children = "Nenhum registro neste filtro.",
}: {
  children?: ReactNode;
}) {
  return <p className="ow-empty">{children}</p>;
}
export function Tag({
  children,
  tone = "blue",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`ow-tag ${tone}`}>{children}</span>;
}
export function OperationForm({
  command,
  returnTo,
  values = {},
  children,
  className = "ow-form",
}: {
  command: string;
  returnTo: string;
  values?: Record<string, string | number>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form action={executeOperation} className={className}>
      <input type="hidden" name="command" value={command} />
      <input type="hidden" name="request_id" value={randomUUID()} />
      <input type="hidden" name="return_to" value={returnTo} />
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  value,
  required = false,
  min,
  step,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  min?: number;
  step?: string;
  maxLength?: number;
}) {
  return (
    <label className="ow-field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        min={min}
        step={step}
        maxLength={maxLength}
      />
    </label>
  );
}
export function VehicleSelect({
  data,
  name = "vehicle_id",
}: {
  data: OperationalData;
  name?: string;
}) {
  return (
    <label className="ow-field">
      <span>Veículo</span>
      <select name={name} required>
        <option value="">Selecione</option>
        {data.vehicles?.map((v) => (
          <option key={v.id} value={v.id}>
            {v.plate} · {v.name ?? v.category?.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Submit({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="submit" className="ow-button" disabled={disabled}>
      {children}
    </button>
  );
}
