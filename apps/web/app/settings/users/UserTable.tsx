"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface SearchableMember {
  id: string;
  fullName: string | null;
  email: string;
  /** The already-built <UserRow /> element (it renders its own <tr>). */
  node: React.ReactNode;
}

/**
 * Member table + client-side search by name or email. Same reasoning as the fleet grid's
 * filter: an org's member list is small enough that filtering in the browser beats a
 * server round-trip, and it keeps the page a plain Server Component.
 */
export function UserTable({
  members,
  dict,
}: {
  members: SearchableMember[];
  dict: Dictionary;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => (m.fullName ?? "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict.team.search.placeholder}
          aria-label={dict.team.search.placeholder}
          className="min-w-[16rem] flex-1 rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
        />
        <p className="text-xs text-fog-600">
          {dict.team.search.resultCount
            .replace("{shown}", String(filtered.length))
            .replace("{total}", String(members.length))}
        </p>
      </div>

      <div className="mb-6 overflow-x-auto rounded-md border border-line-800">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
              <th className="px-4 py-3 font-medium">{dict.team.columns.member}</th>
              <th className="px-4 py-3 font-medium">{dict.team.columns.role}</th>
              <th className="px-4 py-3 font-medium">{dict.team.columns.authorized}</th>
              <th className="px-4 py-3 font-medium">{dict.team.columns.license}</th>
              <th className="px-4 py-3 font-medium text-right">{dict.team.columns.action}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((m) => m.node)
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-fog-400">
                  {dict.team.search.noMatches}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
