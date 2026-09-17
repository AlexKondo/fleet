import type { StatusIconKey, StatusMeta } from "../dashboard/statusMeta";

/**
 * Vehicle-status badge: colored dot + glyph + label. The glyph is the second visual
 * dimension that makes the color collisions readable (three blues, two yellows, two reds
 * across ten statuses — see dashboard/statusMeta.ts). Same outline style as NavIcons.tsx:
 * 24-unit viewBox, `stroke="currentColor"`, no fill, so the glyph inherits the status
 * color from the surrounding text class and stays legible at 12px.
 */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GLYPHS: Record<StatusIconKey, React.ReactNode> = {
  // available — check
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  // reserved — bookmark (held for someone)
  bookmark: <path d="M6.5 3.5h11v17l-5.5-4-5.5 4v-17Z" />,
  // awaiting_pickup — key (waiting at the gate to be collected)
  key: (
    <>
      <circle cx="7.5" cy="16.5" r="3.5" />
      <path d="M10 14 20 4" />
      <path d="M17 7l2.5 2.5" />
    </>
  ),
  // in_use — steering wheel (someone is driving it)
  steering: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3.5v6M4.2 15l5.6-2M19.8 15l-5.6-2" />
    </>
  ),
  // returning — u-turn back to base
  uturn: (
    <>
      <path d="M7 20V9a4.5 4.5 0 0 1 9 0v11" />
      <path d="M12.5 15.5 16 20l3.5-4.5" />
    </>
  ),
  // inspection — magnifier
  magnifier: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  // charging — bolt
  bolt: <path d="M13.5 2.5 5 13.5h6L10.5 21.5 19 10.5h-6l.5-8Z" />,
  // cleaning — droplet
  droplet: <path d="M12 3s6 6.4 6 10.4A6 6 0 0 1 6 13.4C6 9.4 12 3 12 3Z" />,
  // maintenance — wrench
  wrench: (
    <path d="M20 5.5a5 5 0 0 1-6.6 6.6L5.9 19.6a2.2 2.2 0 0 1-3.1-3.1l7.5-7.5A5 5 0 0 1 16.9 2.4l-3 3 1.9 3.8 3.8 1.9 1-2.6" />
  ),
  // blocked — ban
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18 18 6" />
    </>
  ),
};

export function StatusIcon({ icon }: { icon: StatusIconKey }) {
  return <Glyph>{GLYPHS[icon]}</Glyph>;
}

export function StatusBadge({ meta, className = "" }: { meta: StatusMeta; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 ${meta.text} ${className}`}
      title={meta.label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      <StatusIcon icon={meta.icon} />
      <span className="text-xs uppercase tracking-widest">{meta.label}</span>
    </span>
  );
}
