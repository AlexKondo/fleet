/**
 * A proportional bar for comparing a value against the largest value in its group —
 * same token palette and tabular-numeral discipline as EnergyGauge
 * (apps/web/app/dashboard/EnergyGauge.tsx), generalized past "fuel/battery percent" to
 * any labeled quantity (km, trip count, destination frequency, ...).
 */
export function StatBar({
  label,
  value,
  max,
  unit,
  colorClass = "bg-signal-teal",
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  colorClass?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate font-mono text-xs text-paper-50" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-[1px] bg-line-800">
        <div className={`h-full ${colorClass}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-fog-400">
        {value.toLocaleString("pt-BR")}
        {unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}
