"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import type { GateMovementKey } from "@/lib/i18n/areas/gateMovement";
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
  statusClass: string;
  /** vehicles.status, drives the colour dot next to the label */
  status: string;
  action: "pickup" | "return" | "movement" | "arrival" | "waiting";
  /** the window ended and the vehicle never left (the car is released): shown as a status, with no action */
  notPickedUp?: boolean;
}

type View = "all" | "pickup" | "return";

/**
 * SCR-SEC-001: the rows the gate has to act on, grouped by what comes next (departures x returns) with the real counts; nothing here is invented.
 * (The plate search was removed: the list is a handful of reservations and the gate picks the vehicle from it.)
 */
export function GateList({ rows, dict, capped = false, T }: { rows: GateRow[]; dict: Dictionary; capped?: boolean; T: Record<GateMovementKey, string> }) {
  const [view, setView] = useState<View>("all");
  const g = dict.ops.gate;

  const counts = useMemo(
    () => ({
      all: rows.length,
      pickup: rows.filter((r) => r.action === "pickup").length,
      return: rows.filter((r) => r.action === "return").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => view === "all" || r.action === view);
  }, [rows, view]);

  const tab = (key: View, label: string) => (
    <button
      key={key}
      type="button"
      className="gt-tab"
      aria-pressed={view === key}
      onClick={() => setView(key)}
      data-testid={`gate-tab-${key}`}
    >
      {label}
      <span className="gt-count">{counts[key]}{capped ? "+" : ""}</span>
    </button>
  );

  return (
    <div>
      <div className="gt-tabs" role="group" aria-label={g.viewLabel}>
        {tab("all", g.tabAll)}
        {tab("pickup", g.tabPickup)}
        {tab("return", g.tabReturn)}
      </div>

      {rows.length === 0 ? (
        <p className="fm-empty">{dict.gate.empty}</p>
      ) : filtered.length === 0 ? (
        <p className="fm-empty">{g.noneInView}</p>
      ) : (
        <ul className="gt-list">
          {filtered.map((r) => (
            <li key={r.id} className="fm-card gt-row" data-testid="gate-row">
              <div className="gt-main">
                <span className="gt-icon" data-kind={r.action} aria-hidden="true">
                  {r.action === "pickup" ? <FmArrowOutIcon /> : <FmArrowInIcon />}
                </span>
                <div>
                  <p className="gt-plate fm-mono">{r.plate}</p>
                  {r.vehicleName ? <p className="gt-vehicle">{r.vehicleName}</p> : null}
                </div>
              </div>
              <div className="gt-info">
                {r.route ? <p className="gt-route">{r.route}</p> : null}
                <p className="gt-meta">
                  {r.requesterName ?? "—"} · <span className="tabular-nums">{r.eventKind === "return" ? T.eventReturn : T.eventDeparture}: {r.eventAt}</span>
                </p>
                <p className="gt-meta">
                  <span className="fm-pill" data-tone={r.notPickedUp ? "warn" : "neutral"} style={{ gap: 8 }} data-testid={r.notPickedUp ? "gate-not-picked-up" : undefined}>
                    <span className="fm-dot" data-s={r.status} aria-hidden="true" />
                    {r.statusLabel}
                  </span>
                </p>
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
