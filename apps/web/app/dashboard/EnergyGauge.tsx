import type { Dictionary } from "../../lib/i18n/dictionaries";
import type { Locale } from "../../lib/i18n/locales";
import { dashboardMiscTexts } from "../../lib/i18n/areas/dashboardMisc";
import { normalizeEnergyPercent, energySegments } from "./energyGaugeModel";

const SEGMENTS = 5;

/**
 * Shared fleet energy indicator. Invalid or unavailable telemetry is never displayed
 * as a real zero. Segment graphics are decorative; the numerical value is announced once.
 */
export function EnergyGauge({
  percent,
  kind,
  dict,
  locale,
}: {
  percent: number | null;
  kind: "fuel" | "battery";
  dict: Dictionary;
  locale: Locale;
}) {
  const T = dashboardMiscTexts[locale] ?? dashboardMiscTexts["pt-BR"];
  const value = normalizeEnergyPercent(percent);
  if (value === null) {
    return <span className="font-mono text-xs text-fog-600" aria-label={T.energyUnavailable}>—</span>;
  }

  const filled = energySegments(value, SEGMENTS);
  const isLow = value <= 20;
  const suffix = kind === "battery" ? ` ${dict.dashboard.vehicles.batterySuffix}` : "";

  return (
    <div className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={kind === "battery" ? T.battery : T.fuel}>
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-1.5 rounded-[1px] ${
              i < filled ? (isLow ? "bg-signal-red" : "bg-signal-teal") : "bg-line-800"
            }`}
          />
        ))}
      </div>
      <span aria-hidden="true" className={`font-mono text-xs tabular-nums ${isLow ? "text-signal-red" : "text-fog-400"}`}>
        {value}%{suffix}
      </span>
    </div>
  );
}
