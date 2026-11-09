/** Shown by "Próximas manutenções" and on the vehicle card, so "Precisa de Atenção" does not repeat it (and it does not count as needing attention). */
export const REVIEW_NEAR = "maintenance_due_soon";

/**
 * Does this vehicle need attention? The ONE rule behind the "Veículos que precisam de atenção" number, the "Precisa de Atenção" list and the orange glow
 * on the vehicle card, so the three always point at the same vehicles.
 */
export function needsAttention(reasons: readonly string[]): boolean {
  return reasons.some((reason) => reason !== REVIEW_NEAR);
}
