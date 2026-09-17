"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import { Field, Input } from "../ui/Input";

export interface GateRow {
  id: string;
  plate: string;
  vehicleName: string | null;
  requesterName: string | null;
  route: string;
  startAt: string;
  statusLabel: string;
  statusClass: string;
  action: "pickup" | "return";
}

/**
 * Plate search is a pure client-side filter over the already-fetched rows: the actionable
 * set at any moment is at most a handful of reservations per org, so a server round-trip
 * per keystroke would cost more than it saves.
 */
export function GateList({ rows, dict }: { rows: GateRow[]; dict: Dictionary }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s-]/g, "");
    if (!q) return rows;
    return rows.filter((r) => r.plate.toLowerCase().replace(/[\s-]/g, "").includes(q));
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
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

      {rows.length === 0 ? (
        <p className="text-sm text-fog-400">{dict.gate.empty}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-fog-400">{dict.gate.noResults}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-800 bg-panel-900/60 p-4"
            >
              <div className="min-w-0">
                <p className="font-mono text-lg text-paper-50">
                  {r.plate}
                  {r.vehicleName ? (
                    <span className="ml-2 font-sans text-xs text-fog-600">{r.vehicleName}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-fog-400">{r.route}</p>
                <p className="mt-1 text-xs text-fog-600">
                  {r.requesterName ?? "—"} ·{" "}
                  <span className="font-mono tabular-nums">{r.startAt}</span> ·{" "}
                  <span className={r.statusClass}>{r.statusLabel}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/reservations/${r.id}`}
                  className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-gwm-accent hover:text-gwm-accent"
                >
                  {dict.gate.details}
                </Link>
                {r.action === "pickup" ? (
                  <Link
                    href={`/reservations/${r.id}/pickup`}
                    className="rounded-sm border border-signal-blue px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-blue hover:bg-signal-blue/10"
                  >
                    {dict.gate.pickupAction}
                  </Link>
                ) : (
                  <Link
                    href={`/reservations/${r.id}/return`}
                    className="rounded-sm border border-gwm-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10"
                  >
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
