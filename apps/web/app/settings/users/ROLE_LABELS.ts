import type { Dictionary } from "../../../lib/i18n/dictionaries";

/** Fallback (pt-BR) labels, kept for non-localized call sites and as a safety net when a
 * role code has no dictionary entry. Prefer getRoleLabels(dict). */
export const ROLE_LABELS: Record<string, string> = {
  employee: "Colaborador",
  fleet_manager: "Gestor de Frota",
  security: "Segurança / Portaria",
  maintenance_operator: "Manutenção",
  administrator: "Administrador",
};

export const ROLE_KEYS = [
  "employee",
  "fleet_manager",
  "security",
  "maintenance_operator",
  "administrator",
] as const;

export function getRoleLabels(dict: Dictionary): Record<string, string> {
  return { ...ROLE_LABELS, ...dict.roles };
}

export function getRoleOptions(dict: Dictionary): { value: string; label: string }[] {
  const labels = getRoleLabels(dict);
  return ROLE_KEYS.map((value) => ({ value: value as string, label: labels[value] ?? value }));
}
