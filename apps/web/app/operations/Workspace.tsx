import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { FmShell } from "../carpool/FmShell";
import type { NavKey } from "../shellData";
import type { OperationalData } from "@/lib/operations/load";
import { executeOperation } from "./actions";
import { getDictionary } from "@/lib/i18n/getLocale";
import "./operations.css";
export const money = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const date = (value: string | null, time = false, locale = "pt-BR") =>
  !value
    ? "—"
    : new Intl.DateTimeFormat(locale, {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(
        new Date(value.length === 10 ? value + "T12:00:00-03:00" : value),
      );
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
  const t = (await getDictionary()).opsShell;
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
            {t.centralLink}
          </Link>
        </header>
        {error && (
          <p className="ow-banner ow-error" role="alert">
            {(t.errors as Record<string, string>)[error] ?? t.genericError}
          </p>
        )}
        {success && (
          <p className="ow-banner" role="status">
            {t.success}
          </p>
        )}
        {data.unavailable && (
          <p className="ow-banner ow-error" role="alert">
            {t.unavailable}{" "}
            {data.migrationUnavailable ? t.unavailableEnv : ""}
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
  ariaLabel = "Indicadores operacionais",
}: {
  ariaLabel?: string;
  items: {
    label: string;
    value: string | number | null;
    detail?: string;
    tone?: string;
  }[];
}) {
  return (
    <section className="ow-metrics" aria-label={ariaLabel}>
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
  labels = { vehicle: "Veículo", select: "Selecione" },
}: {
  data: OperationalData;
  name?: string;
  labels?: { vehicle: string; select: string };
}) {
  return (
    <label className="ow-field">
      <span>{labels.vehicle}</span>
      <select name={name} required>
        <option value="">{labels.select}</option>
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
