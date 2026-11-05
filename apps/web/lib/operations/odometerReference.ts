/**
 * The number under the return form's odometer field, which is also the lowest value it accepts: the km typed at the departure, never below what the
 * vehicle already has (record_return refuses less). The vehicle's own km only moves when a trip closes, so it alone would show the km of the previous trip.
 */
export function returnOdometerReference(vehicleKm: number, pickupKms: readonly (number | null)[]): { km: number; fromPickup: boolean } {
  const typed = pickupKms.filter((km): km is number => km !== null);
  if (typed.length === 0) return { km: vehicleKm, fromPickup: false };
  return { km: Math.max(vehicleKm, ...typed), fromPickup: true };
}
