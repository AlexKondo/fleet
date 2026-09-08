export const SAFETY_EQUIPMENT_OPTIONS = [
  { value: "triangulo", label: "Triângulo" },
  { value: "macaco", label: "Macaco" },
  { value: "chave_de_roda", label: "Chave de roda" },
] as const;

/**
 * Standardized photo evidence angles (fleet-car-saas.txt §10). Mirrors the Postgres
 * `photo_angle` enum (supabase/migrations/0002_operational_cycle.sql) exactly — every
 * value here must have a matching enum label, and vice versa.
 */
export type PhotoAngle =
  | "front"
  | "back"
  | "left_side"
  | "right_side"
  | "wheels"
  | "interior"
  | "damage";

// The six standard angles, shown alongside the "damage" angle only when the checklist's
// own damage checkbox is ticked — a no-damage pickup/return doesn't ask for photos at all.
export const STANDARD_PHOTO_ANGLES: { value: Exclude<PhotoAngle, "damage">; label: string }[] = [
  { value: "front", label: "Frente" },
  { value: "back", label: "Traseira" },
  { value: "left_side", label: "Lateral Esquerda" },
  { value: "right_side", label: "Lateral Direita" },
  { value: "wheels", label: "Rodas" },
  { value: "interior", label: "Interior" },
];

export const DAMAGE_PHOTO_ANGLE = { value: "damage", label: "Avaria" } as const;

export const ALL_PHOTO_ANGLES: PhotoAngle[] = [
  ...STANDARD_PHOTO_ANGLES.map((angle) => angle.value),
  DAMAGE_PHOTO_ANGLE.value,
];

export const PHOTO_ANGLE_LABELS: Record<PhotoAngle, string> = Object.fromEntries(
  [...STANDARD_PHOTO_ANGLES, DAMAGE_PHOTO_ANGLE].map((angle) => [angle.value, angle.label]),
) as Record<PhotoAngle, string>;
