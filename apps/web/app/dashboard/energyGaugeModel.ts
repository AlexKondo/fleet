/** Keep telemetry anomalies distinct from a measured empty tank/battery. */
export function normalizeEnergyPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value);
}

export function energySegments(value: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const percent = normalizeEnergyPercent(value);
  return percent === null ? 0 : Math.round((percent / 100) * Math.floor(count));
}
