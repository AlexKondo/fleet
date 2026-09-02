const SEGMENTS = 5;

export function EnergyGauge({
  percent,
  kind,
}: {
  percent: number | null;
  kind: "fuel" | "battery";
}) {
  if (percent === null) {
    return <span className="font-mono text-xs text-fog-600">—</span>;
  }

  const filled = Math.round((percent / 100) * SEGMENTS);
  const isLow = percent <= 20;

  return (
    <div className="flex items-center gap-2">
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
      <span
        className={`font-mono text-xs tabular-nums ${isLow ? "text-signal-red" : "text-fog-400"}`}
      >
        {percent}%{kind === "battery" ? " bat." : ""}
      </span>
    </div>
  );
}
