const TIME_ZONE = "America/Sao_Paulo";

/**
 * pt-BR date+time formatting pinned to Brasília time. Without an explicit timeZone,
 * toLocaleString falls back to the runtime's own zone — fine in the browser (matches the
 * viewer), wrong on Vercel's Node runtime (UTC), which showed every server-rendered
 * timestamp 3 hours ahead of what was actually entered/stored. Used everywhere (including
 * client components) so a viewer's device timezone never disagrees with the fleet's own.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: TIME_ZONE });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: TIME_ZONE });
}
