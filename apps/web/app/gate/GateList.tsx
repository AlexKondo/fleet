import Link from "next/link";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import type { GateMovementKey } from "@/lib/i18n/areas/gateMovement";
import { shortPersonName } from "@/lib/operations/gateOrder";
import { FmArrowInIcon, FmArrowOutIcon } from "../fmIcons";

export interface GateRow {
  id: string;
  plate: string;
  vehicleName: string | null;
  requesterName: string | null;
  route: string;
  /** what comes next for this reservation, and when */
  eventKind: "departure" | "return";
  eventAt: string;
  statusLabel: string;
  /** the full text when the label is the short one */
  statusHint?: string;
  statusClass: string;
  /** vehicles.status, drives the colour dot next to the label */
  status: string;
  action: "pickup" | "return" | "movement" | "arrival" | "waiting";
  /** the window ended and the vehicle never left (the car is released): shown as a status, with no action */
  notPickedUp?: boolean;
}

/**
 * SCR-SEC-001: the rows the gate has to act on, closest event first (page.tsx), one line each: the long texts are shortened and the
 * full one is on the tooltip. (No plate search and no filters: the list is a handful of reservations and the gate picks from it.)
 */
export function GateList({ rows, dict, T }: { rows: GateRow[]; dict: Dictionary; T: Record<GateMovementKey, string> }) {
  const g = dict.ops.gate;

  return (
    <div>
      {rows.length === 0 ? (
        <p className="fm-empty">{dict.gate.empty}</p>
      ) : (
        <ul className="gt-list">
          {rows.map((r) => (
            <li key={r.id} className="fm-card gt-row" data-testid="gate-row">
              <div className="gt-main">
                <span className="gt-icon" data-kind={r.eventKind === "return" ? "return" : "pickup"} aria-hidden="true">
                  {r.eventKind === "return" ? <FmArrowInIcon /> : <FmArrowOutIcon />}
                </span>
                <span className="gt-plate fm-mono">{r.plate}</span>
                {r.vehicleName ? <span className="gt-vehicle" title={r.vehicleName}>{r.vehicleName.split(" - ")[0]}</span> : null}
              </div>
              <div className="gt-info">
                <span className="gt-person" title={[r.requesterName, r.route].filter(Boolean).join(" · ")}>
                  {shortPersonName(r.requesterName) ?? "—"}
                  {r.route ? ` · ${r.route}` : ""}
                </span>
                <span className="gt-event tabular-nums">{r.eventKind === "return" ? T.eventReturn : T.eventDeparture}: {r.eventAt}</span>
                <span className="gt-status-cell">
                  <span className="fm-pill gt-status" title={r.statusHint} data-tone={r.notPickedUp ? "warn" : "neutral"} data-testid={r.notPickedUp ? "gate-not-picked-up" : undefined}>
                    <span className="fm-dot" data-s={r.status} aria-hidden="true" />
                    {r.statusLabel}
                  </span>
                </span>
              </div>
              <div className="gt-actions">
                <Link href={`/reservations/${r.id}`} className="fm-btn fm-btn-ghost">
                  {dict.gate.details}
                </Link>
                {r.action === "pickup" ? (
                  <Link href={`/reservations/${r.id}/pickup`} className="fm-btn fm-btn-primary">
                    {dict.gate.pickupAction}
                  </Link>
                ) : r.action === "return" ? (
                  <Link href={`/reservations/${r.id}/return`} className="fm-btn fm-btn-primary">
                    {dict.gate.returnAction}
                  </Link>
                ) : r.action === "movement" || r.action === "arrival" ? (
                  <Link href={`/gate/history?reservation=${r.id}&kind=${r.action === "arrival" ? "arrival" : "departure"}`} className="fm-btn fm-btn-primary">{r.action === "arrival" ? T.listArrival : T.listDeparture}</Link>
                ) : r.notPickedUp ? null : <span className="fm-muted">{g.waitingChecklist}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
