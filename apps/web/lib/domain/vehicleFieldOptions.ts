// Discrete fuel-gauge readings instead of a free-typed percentage — matches how a fuel
// gauge is actually read at a glance. "Reserva" maps to a low-but-nonzero value rather
// than 0, since a reserve light coming on doesn't mean the tank is literally empty.
//
// The numeric values are the stable keys: they are what gets stored in
// vehicles.fuel_level_percent, and they key `dict.fleet.vehicleForm.fuelLevels` for the
// user-visible label. No label lives here — render via the dictionary.
export const FUEL_LEVEL_VALUES = [100, 75, 50, 25, 10] as const;

export type FuelLevelValue = (typeof FUEL_LEVEL_VALUES)[number];

export const FUEL_LEVEL_OPTIONS: { value: FuelLevelValue }[] = FUEL_LEVEL_VALUES.map((value) => ({
  value,
}));

// Fixed, consistent vocabulary rather than free text — a picker only helps someone spot
// their car in the lot if "Prata"/"Prateado"/"Cinza Prata" aren't three different colors.
//
// These pt-BR strings are the stable stored values (vehicles.color holds them verbatim,
// including for rows written before i18n existed), NOT display labels — they key
// `dict.fleet.vehicleForm.colors` for the user-visible label.
export const VEHICLE_COLOR_OPTIONS = [
  "Branco",
  "Prata",
  "Cinza",
  "Preto",
  "Vermelho",
  "Azul",
  "Verde",
  "Amarelo",
  "Laranja",
  "Marrom",
  "Bege",
  "Dourado",
] as const;

export type VehicleColorValue = (typeof VEHICLE_COLOR_OPTIONS)[number];
