"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "./dashboard/actions";
import { NotificationBell } from "./dashboard/NotificationBell";
import { ROLE_LABELS } from "./settings/users/ROLE_LABELS";
import {
  AnalyticsIcon,
  DashboardIcon,
  FleetIcon,
  LogoutIcon,
  SettingsIcon,
  TeamIcon,
  TripsIcon,
} from "./NavIcons";
import type { NavKey } from "./AppShell";

// Icon components are functions, which the AppShell server component can't pass down as
// props (React Server Components can only serialize data across that boundary) — this
// client component looks its own icon up by `key` instead.
const ICONS_BY_KEY: Record<NavKey, (props: { className?: string }) => React.ReactElement> = {
  dashboard: DashboardIcon,
  trips: TripsIcon,
  analytics: AnalyticsIcon,
  fleet: FleetIcon,
  team: TeamIcon,
  settings: SettingsIcon,
};

interface NavItem {
  key: NavKey;
  href: string;
  label: string;
}

/**
 * Mobile-only hamburger menu — replaces the old always-visible horizontal icon strip
 * (which just wrapped/scrolled awkwardly once there were 6 nav items) with a collapsed
 * toggle, the pattern users already expect from phone apps. Desktop keeps the sidebar in
 * AppShell.tsx untouched; this component renders nothing there (`md:hidden`).
 */
export function MobileNav({
  items,
  active,
  orgName,
  userName,
  role,
}: {
  items: NavItem[];
  active: NavKey;
  orgName: string;
  userName: string;
  role: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <div className="flex items-center justify-between border-b border-line-800 bg-panel-900/40 px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span>
          </p>
          <p className="max-w-[10rem] truncate text-[11px] uppercase tracking-widest text-fog-600">
            {orgName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell align="right" />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-1 rounded-sm border border-line-800 text-fog-400 hover:border-signal-amber hover:text-signal-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber"
          >
            <span
              className={`h-0.5 w-4 rounded-full bg-current transition-transform ${open ? "translate-y-1.5 rotate-45" : ""}`}
            />
            <span className={`h-0.5 w-4 rounded-full bg-current transition-opacity ${open ? "opacity-0" : ""}`} />
            <span
              className={`h-0.5 w-4 rounded-full bg-current transition-transform ${open ? "-translate-y-1.5 -rotate-45" : ""}`}
            />
          </button>
        </div>
      </div>

      {open ? (
        <div className="flex flex-col border-b border-line-800 bg-ink-950 px-4 py-4">
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const isActive = item.key === active;
              const Icon = ICONS_BY_KEY[item.key];
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm uppercase tracking-widest transition-colors ${
                    isActive
                      ? "bg-signal-amber/10 text-signal-amber"
                      : "text-fog-400 hover:bg-panel-800 hover:text-paper-50"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Link
            href="/trips/new"
            className="mt-4 flex items-center justify-center gap-2 rounded-sm bg-signal-amber px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90"
          >
            + Solicitar Viagem
          </Link>

          <div className="mt-4 flex items-center justify-between border-t border-line-800 pt-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-paper-50">{userName}</p>
              <p className="text-xs uppercase tracking-widest text-fog-600">
                {ROLE_LABELS[role] ?? role}
              </p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Sair"
                className="flex h-9 w-9 items-center justify-center rounded-sm border border-line-800 text-fog-400 hover:border-signal-red hover:text-signal-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-red"
              >
                <LogoutIcon className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
