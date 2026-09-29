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

// The six standard angles, always requested at pickup and return — a no-damage checklist
// still needs a photographic record. The "damage" angle below is shown alongside them only
// when the checklist's own damage checkbox is ticked.
// Values only — labels live in `dict.reservations.photos.angles`, keyed by these values.
export const STANDARD_PHOTO_ANGLES: { value: Exclude<PhotoAngle, "damage"> }[] = [
  { value: "front" },
  { value: "back" },
  { value: "left_side" },
  { value: "right_side" },
  { value: "wheels" },
  { value: "interior" },
];

export const DAMAGE_PHOTO_ANGLE = { value: "damage" } as const;

export const ALL_PHOTO_ANGLES: PhotoAngle[] = [
  ...STANDARD_PHOTO_ANGLES.map((angle) => angle.value),
  DAMAGE_PHOTO_ANGLE.value,
];
