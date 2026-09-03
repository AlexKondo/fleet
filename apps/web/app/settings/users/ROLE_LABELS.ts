export const ROLE_LABELS: Record<string, string> = {
  employee: "Colaborador",
  fleet_manager: "Gestor de Frota",
  security: "Segurança / Portaria",
  maintenance_operator: "Manutenção",
  administrator: "Administrador",
};

export const ROLE_OPTIONS = [
  { value: "employee", label: ROLE_LABELS.employee },
  { value: "fleet_manager", label: ROLE_LABELS.fleet_manager },
  { value: "security", label: ROLE_LABELS.security },
  { value: "maintenance_operator", label: ROLE_LABELS.maintenance_operator },
  { value: "administrator", label: ROLE_LABELS.administrator },
] as const;
