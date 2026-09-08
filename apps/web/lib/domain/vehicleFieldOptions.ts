// Discrete fuel-gauge readings instead of a free-typed percentage — matches how a fuel
// gauge is actually read at a glance. "Reserva" maps to a low-but-nonzero value rather
// than 0, since a reserve light coming on doesn't mean the tank is literally empty.
export const FUEL_LEVEL_OPTIONS: { value: number; label: string }[] = [
  { value: 100, label: "Cheio" },
  { value: 75, label: "¾" },
  { value: 50, label: "½" },
  { value: 25, label: "¼" },
  { value: 10, label: "Reserva" },
];

// Fixed, consistent vocabulary rather than free text — a picker only helps someone spot
// their car in the lot if "Prata"/"Prateado"/"Cinza Prata" aren't three different colors.
export const VEHICLE_COLOR_OPTIONS: string[] = [
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
];
