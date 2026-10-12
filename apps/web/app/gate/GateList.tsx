"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import { Field, Input } from "../ui/Input";
import { FmArrowInIcon, FmArrowOutIcon } from "../fmIcons";

export interface GateRow {
  id: string;
  plate: string;
  vehicleName: string | null;
  requesterName: string | null;
  route: string;
  startAt: string;
  statusLabel: string;
  statusClass: string;
  /** vehicles.status, drives the colour dot next to the label */
  status: string;
  action: "pickup" | "return";
}

type View = "all" | "pickup" | "return";

/**
 * Plate search is a pure client-side filter over the already-fetched rows: the actionable
 * set at any moment is at most a handful of reservations per org, so a server round-trip
 * per keystroke would cost more than it saves. SCR-SEC-001: the same rows, grouped by what the gate has to do next
 * (departures x returns) with the real counts; nothing here is invented.
 */
export function GateList({ rows, dict, capped = false }: { rows: GateRow[]; dict: Dictionary; capped?: boolean }) {
  const [query, setQuery] = useState("");
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
    const q = query.trim().toLowerCase().replace(/[\s-]/g, "");
    return rows.filter((r) => {
      if (view !== "all" && r.action !== view) return false;
      return !q || r.plate.toLowerCase().replace(/[\s-]/g, "").includes(q);
    });
  }, [rows, query, view]);

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
      <section className="fm-panel gt-search" aria-labelledby="gt-search-title">
        <h2 id="gt-search-title" className="fm-h2">{g.searchTitle}</h2>
        <p className="fm-muted" style={{ marginBottom: 12 }}>{dict.gate.description}</p>
        <div className="max-w-md">
          <Field label={dict.gate.searchLabel} htmlFor="gate-plate-search">
            <Input
              id="gate-plate-search"
              type="search"
              inputMode="text"
              autoComplete="off"
              placeholder={dict.gate.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="font-mono uppercase"
            />
          </Field>
        </div>
      </section>

      <div className="gt-tabs" role="group" aria-label={g.viewLabel}>
        {tab("all", g.tabAll)}
        {tab("pickup", g.tabPickup)}
        {tab("return", g.tabReturn)}
      </div>

      {rows.length === 0 ? (
        <p className="fm-empty">{dict.gate.empty}</p>
      ) : filtered.length === 0 ? (
        <p className="fm-empty">{query.trim() ? dict.gate.noResults : g.noneInView}</p>
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
                <p className="gt-route">{r.route}</p>
                <p className="gt-meta">
                  {r.requesterName ?? "—"} · <span className="tabular-nums">{r.startAt}</span>
                </p>
                <p className="gt-meta">
                  <span className="fm-pill" data-tone="neutral" style={{ gap: 8 }}>
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
                ) : (
                  <Link href={`/reservations/${r.id}/return`} className="fm-btn fm-btn-primary">
                    {dict.gate.returnAction}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
