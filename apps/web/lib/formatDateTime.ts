import type { Locale } from "./i18n/locales";

const TIME_ZONE = "America/Sao_Paulo";

/**
 * Localized date+time formatting pinned to Brasília time. Without an explicit timeZone,
 * toLocaleString falls back to the runtime's own zone — fine in the browser (matches the
 * viewer), wrong on Vercel's Node runtime (UTC), which showed every server-rendered
 * timestamp 3 hours ahead of what was actually entered/stored. Used everywhere (including
 * client components) so a viewer's device timezone never disagrees with the fleet's own.
 *
 * The `locale` argument controls only the *language/format conventions* (day-month order,
 * separators, digits) — the timeZone stays fixed at Brasília for every locale, because it
 * describes where the fleet physically is, not what language the viewer reads.
 */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale, { timeZone: TIME_ZONE });
}

export function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale, { timeZone: TIME_ZONE });
}

/** Short day/month label for the vehicle-schedule Gantt header. Same timeZone rule. */
export function formatDayMonth(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIME_ZONE,
  });
}
