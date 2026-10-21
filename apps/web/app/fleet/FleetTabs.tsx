"use client";

import { useRef, useState } from "react";

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
  const listRef = useRef<HTMLDivElement>(null);

  // WAI-ARIA tabs: arrows/Home/End move between tabs (automatic activation).
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.key === active);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null || !tabs[next]) return;
    event.preventDefault();
    setActive(tabs[next].key);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        onKeyDown={onKeyDown}
        className="mb-5 flex gap-1 border-b border-line-800"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`fleet-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`fleet-tabpanel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
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
        <div
          key={tab.key}
          role="tabpanel"
          id={`fleet-tabpanel-${tab.key}`}
          aria-labelledby={`fleet-tab-${tab.key}`}
          hidden={tab.key !== active}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
