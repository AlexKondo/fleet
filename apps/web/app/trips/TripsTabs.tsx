"use client";
import { useState } from "react";

/**
 * The tabs of "Minhas viagens": the page is rendered ONCE with every panel (the server loads the data a single time) and a tab only shows its panels
 * here in the browser, so switching is instant instead of a new server round trip per click. The address is kept in sync (?tab=...) so a tab can still be
 * shared or reloaded; a middle-click / "open in a new tab" works because every tab is a real link.
 */
export function TripsTabs({
  tabs,
  initial,
  ariaLabel,
  children,
}: {
  tabs: { key: string; label: string; count: number }[];
  initial: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState(initial);
  const hrefOf = (k: string) => (k === "all" ? "/trips" : `/trips?tab=${k}`);
  return (
    <>
      <nav className="tp-tabs" aria-label={ariaLabel} data-testid="trips-tabs">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={hrefOf(t.key)}
            className="tp-tab"
            aria-current={t.key === tab ? "page" : undefined}
            data-tab={t.key}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              setTab(t.key);
              try { window.history.replaceState(null, "", hrefOf(t.key)); } catch { /* the tab still switches */ }
            }}
          >
            {t.label} <span className="tp-count">({t.count})</span>
          </a>
        ))}
      </nav>
      <div className="tp-panels" data-tab={tab}>{children}</div>
    </>
  );
}
