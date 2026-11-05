import { donutSegments } from "@/lib/fleet/donutSegments";

const RADIUS = 38;
const STROKE = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2;

/**
 * Vehicles by propulsion. The hole stays empty: the total is on the card beside it. Keep the parts in the order the page gives them: the colours were
 * validated for colour-blind readers with those neighbours on the ring (see --ev-* in vehicle-workspace.css).
 */
export function EnergyDonut({ title, parts }: { title: string; parts: { key: string; label: string; value: number }[] }) {
  const segments = donutSegments(parts, CIRCUMFERENCE, GAP);
  if (segments.length === 0) return null;
  const labelOf = (key: string) => parts.find((p) => p.key === key)?.label ?? key;
  const describe = (s: (typeof segments)[number]) => `${labelOf(s.key)}: ${s.value} (${Math.round(s.share * 100)}%)`;
  return (
    <div className="fm-kpi fleet-energy" data-testid="fleet-kpi-energy">
      <svg className="fleet-donut" viewBox="0 0 100 100" role="img" aria-label={`${title}. ${segments.map(describe).join("; ")}`}>
        {segments.map((s) => (
          <circle
            key={s.key}
            data-e={s.key}
            cx={50}
            cy={50}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
            strokeDashoffset={-s.offset}
            transform="rotate(-90 50 50)"
          >
            <title>{describe(s)}</title>
          </circle>
        ))}
      </svg>
      <div className="fleet-energy-body">
        <p className="fm-kpi-label">{title}</p>
        <ul className="fm-legend">
          {segments.map((s) => (
            <li key={s.key}>
              <span className="fm-dot" data-e={s.key} aria-hidden="true" />
              <span>{labelOf(s.key)}</span>
              <strong>{s.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
