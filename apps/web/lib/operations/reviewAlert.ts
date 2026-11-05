/**
 * The triangle of "Próxima revisão": a vehicle within `dueSoonKm` of its review km (Configurações > Políticas), or already past it. `km` is how much is
 * left, or how far past it the vehicle went. No review km registered, no alert.
 */
export function reviewAlert(odometerKm: number, nextServiceKm: number | null | undefined, dueSoonKm: number): { km: number; overdue: boolean } | null {
  if (nextServiceKm === null || nextServiceKm === undefined) return null;
  const left = nextServiceKm - odometerKm;
  if (left > dueSoonKm) return null;
  return { km: Math.abs(left), overdue: left <= 0 };
}
