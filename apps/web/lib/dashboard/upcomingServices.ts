interface ServiceRow {
  odometer_km: number;
  next_service_odometer_km: number | null;
}

/** "Próximas manutenções" of the Painel: the vehicles closest to their review km, the ones past it first. */
export function upcomingServices<V extends ServiceRow>(vehicles: readonly V[], limit = 5): (V & { kmLeft: number; reached: boolean })[] {
  return vehicles
    .flatMap((v) => {
      if (v.next_service_odometer_km === null) return [];
      const left = v.next_service_odometer_km - v.odometer_km;
      return [{ ...v, left, kmLeft: Math.max(0, left), reached: left <= 0 }];
    })
    .sort((a, b) => a.left - b.left)
    .slice(0, limit)
    .map(({ left: _left, ...v }) => v as unknown as V & { kmLeft: number; reached: boolean });
}

/** The location filter of the Painel only accepts a location that exists; anything else means every location. */
export function selectedLocation(requested: string | undefined, locations: readonly { id: string }[]): string {
  return requested && locations.some((l) => l.id === requested) ? requested : "all";
}
