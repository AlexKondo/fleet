"use client";

import { useState } from "react";

export interface FleetTab {
  key: string;
  label: string;
  count: number;
  content: React.ReactNode;
}

/**
 * Tabs replace three stacked sections (Locations/Categories/Vehicles) that used to all be
 * visible — and visually indistinguishable from each other — at once. Every tab's content
 * stays mounted (toggled with `hidden`, not conditionally rendered) so switching tabs
 * never re-fetches or drops in-progress form input in a tab the user isn't looking at.
 */
export function FleetTabs({ tabs }: { tabs: FleetTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div>
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line-800">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm uppercase tracking-widest transition-colors ${
                isActive
                  ? "border-gwm-accent text-gwm-accent"
                  : "border-transparent text-fog-400 hover:text-paper-50"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-sm px-1.5 py-0.5 font-mono text-xs ${
                  isActive ? "bg-gwm-accent/10" : "bg-panel-800 text-fog-600"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div key={tab.key} hidden={tab.key !== active}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
