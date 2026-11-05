/**
 * Where someone's own reservations are: an employee has them listed on Início. A manager's /dashboard is the fleet's, so their reservations are on Viagens.
 * The gate has no trips of its own.
 */
export function reservationsHomeFor(role: string | null | undefined): string {
  if (role === "employee") return "/dashboard";
  if (role === "security") return "/gate";
  return "/trips";
}
