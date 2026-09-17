"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface FilterableVehicle {
  id: string;
  plate: string;
  name: string | null;
  status: string;
  categoryName: string;
  /** The already-built <VehicleRow /> element — kept in the Server Component so this
   * client wrapper only needs the few plain fields it actually filters on. */
  node: React.ReactNode;
}

/**
 * Plate/name search + status and category filters over the vehicle card grid. Filtering is
 * client-side on the full list: this app's fleets are tens of vehicles, not thousands, so
 * a server round-trip (and pagination) per keystroke would be strictly worse. No state
 * library — plain useState, same as every other client component here.
 */
export function VehicleFilterGrid({
  vehicles,
  statusOptions,
  dict,
}: {
  vehicles: FilterableVehicle[];
  statusOptions: { value: string; label: string }[];
  dict: Dictionary;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");

  const categoryOptions = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.categoryName))).sort((a, b) => a.localeCompare(b)),
    [vehicles],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (status && v.status !== status) return false;
      if (category && v.categoryName !== category) return false;
      if (!q) return true;
      return (
        v.plate.toLowerCase().includes(q) || (v.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [vehicles, query, status, category]);

  const selectClass =
    "rounded-sm border border-line-800 bg-panel-900 px-2 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict.fleet.filters.searchPlaceholder}
          aria-label={dict.fleet.filters.searchPlaceholder}
          className="min-w-[14rem] flex-1 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={dict.common.status}
          className={selectClass}
        >
          <option value="">{dict.fleet.filters.statusAll}</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {categoryOptions.length > 1 ? (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={dict.fleet.tabs.categories}
            className={selectClass}
          >
            <option value="">{dict.fleet.filters.categoryAll}</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
        {query || status || category ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStatus("");
              setCategory("");
            }}
            className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent"
          >
            {dict.fleet.filters.clear}
          </button>
        ) : null}
      </div>

      <p className="text-xs text-fog-600">
        {dict.fleet.filters.resultCount
          .replace("{shown}", String(filtered.length))
          .replace("{total}", String(vehicles.length))}
      </p>

      {filtered.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {/* Each node is a <VehicleRow />, which renders its own <li> and carries its
              own key from fleet/page.tsx. */}
          {filtered.map((v) => v.node)}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-line-800 px-6 py-8 text-center text-sm text-fog-400">
          {dict.fleet.filters.noMatches}
        </p>
      )}
    </div>
  );
}
