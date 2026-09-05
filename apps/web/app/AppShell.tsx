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

export type NavKey = "dashboard" | "trips" | "analytics" | "fleet" | "team" | "settings";

/**
 * Shared left-sidebar shell for every authenticated screen — previously each page built
 * its own horizontal top-bar header independently (duplicated across 6+ page.tsx files),
 * which also meant the role label was never translated (raw "administrator" instead of
 * ROLE_LABELS' "Administrador", visible uppercased in the old header). One shell, one
 * source of truth for navigation, org identity, and sign-out.
 */
export function AppShell({
  active,
  orgName,
  userName,
  role,
  isFleetManager,
  isAdministrator,
  title,
  headerActions,
  children,
}: {
  active: NavKey;
  orgName: string;
  userName: string;
  role: string;
  isFleetManager: boolean;
  isAdministrator: boolean;
  /** Page title, rendered in the shared top header alongside the corner controls
   * (notifications/user/sign-out) — pages no longer draw their own header. */
  title: string;
  /** Page-specific header controls (e.g. "+ Adicionar Usuário"), rendered to the left
   * of the shared corner controls, inside the same bordered header bar. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const items: { key: NavKey; href: string; label: string; icon: typeof DashboardIcon; visible: boolean }[] = [
    { key: "dashboard", href: "/dashboard", label: "Painel", icon: DashboardIcon, visible: true },
    { key: "trips", href: "/trips", label: "Minhas Viagens", icon: TripsIcon, visible: true },
    { key: "analytics", href: "/analytics", label: "Analytics", icon: AnalyticsIcon, visible: isFleetManager },
    { key: "fleet", href: "/fleet", label: "Frota", icon: FleetIcon, visible: isFleetManager },
    { key: "team", href: "/settings/users", label: "Equipe", icon: TeamIcon, visible: isAdministrator },
    { key: "settings", href: "/settings", label: "Configurações", icon: SettingsIcon, visible: isFleetManager },
  ];

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line-800 bg-panel-900/40 px-4 py-4 md:w-60 md:border-b-0 md:border-r md:py-5">
        <div className="flex items-center justify-between md:mb-6 md:block">
          <div className="px-1">
            <p className="font-display text-xl font-extrabold uppercase tracking-tight text-paper-50">
              Fleet<span className="text-signal-amber">.</span>
            </p>
            <p className="mt-0.5 max-w-[10rem] truncate text-xs uppercase tracking-widest text-fog-600">
              {orgName}
            </p>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <NotificationBell align="right" />
          </div>
        </div>

        <Link
          href="/trips/new"
          className="mb-5 hidden items-center justify-center gap-2 rounded-sm bg-signal-amber px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90 md:flex"
        >
          + Solicitar Viagem
        </Link>

        <nav className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-1 md:flex-col md:overflow-visible">
          {items
            .filter((i) => i.visible)
            .map((item) => {
              const isActive = item.key === active;
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-3 rounded-sm px-3 py-2.5 text-xs uppercase tracking-widest transition-colors md:text-sm md:normal-case md:tracking-normal ${
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

        <div className="mt-3 flex items-center justify-between md:hidden">
          <Link
            href="/trips/new"
            className="rounded-sm bg-signal-amber px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90"
          >
            + Solicitar Viagem
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-sm border border-line-800 px-3 py-1.5 text-xs uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-y border-line-800 px-6 py-4">
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
            {title}
          </p>
          <div className="flex items-center gap-4">
            {headerActions}
            <div className="hidden items-center gap-4 md:flex">
              <NotificationBell align="right" />
              <div className="hidden text-right lg:block">
                <p className="truncate text-sm text-paper-50">{userName}</p>
                <p className="text-xs uppercase tracking-widest text-fog-600">
                  {ROLE_LABELS[role] ?? role}
                </p>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  aria-label="Sair"
                  className="flex h-8 w-8 items-center justify-center rounded-sm border border-line-800 text-fog-400 hover:border-signal-red hover:text-signal-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-red"
                >
                  <LogoutIcon className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
