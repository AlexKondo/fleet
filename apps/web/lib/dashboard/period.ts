export const PERIODS = ["today", "7d", "30d", "month"] as const;
export type Period = (typeof PERIODS)[number];
export function dashboardPeriod(value?: string, now = new Date()) {
  const period: Period = PERIODS.includes(value as Period)
    ? (value as Period)
    : "today";
  // Brazil's fleet operates in São Paulo (UTC-03, no seasonal clock changes).
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${day}T00:00:00-03:00`);
  if (period === "7d") start.setUTCDate(start.getUTCDate() - 6);
  if (period === "30d") start.setUTCDate(start.getUTCDate() - 29);
  if (period === "month") start.setUTCDate(1);
  const end = new Date(`${day}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { period, from: start.toISOString(), to: end.toISOString() };
}
