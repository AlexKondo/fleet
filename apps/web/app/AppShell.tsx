import Link from "next/link";
import { signOut } from "./dashboard/actions";
import { InactivityLogout } from "./InactivityLogout";
import { SessionBackupSync } from "./SessionBackupSync";
import { MobileNav } from "./MobileNav";
import { NotificationBell } from "./dashboard/NotificationBell";
import { getRoleLabels } from "./settings/users/ROLE_LABELS";
import { ThemeToggle } from "./ui/ThemeToggle";
import { LanguageToggle } from "./ui/LanguageToggle";
import { getLocale, getDictionary } from "../lib/i18n/getLocale";
import {
  AnalyticsIcon,
  DashboardIcon,
  FleetIcon,
  GateIcon,
  LogoutIcon,
  SettingsIcon,
  TeamIcon,
  TripsIcon,
} from "./NavIcons";

export type NavKey = "dashboard" | "trips" | "gate" | "analytics" | "fleet" | "team" | "settings";

/**
 * Shared left-sidebar shell for every authenticated screen — previously each page built
 * its own horizontal top-bar header independently (duplicated across 6+ page.tsx files),
 * which also meant the role label was never translated (raw "administrator" instead of
 * ROLE_LABELS' "Administrador", visible uppercased in the old header). One shell, one
 * source of truth for navigation, org identity, and sign-out.
 */
export async function AppShell({
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
  const locale = await getLocale();
  const dict = await getDictionary();
  const roleLabels = getRoleLabels(dict);

  // Derived from `role` (which every caller already passes) rather than taken as another
  // prop: the gatehouse nav item has to appear on every screen a security user can land
  // on — including /dashboard — without each page having to opt in.
  const isSecurity = role === "security";

  const items: { key: NavKey; href: string; label: string; icon: typeof DashboardIcon; visible: boolean }[] = [
    { key: "dashboard", href: "/dashboard", label: dict.nav.dashboard, icon: DashboardIcon, visible: true },
    { key: "trips", href: "/trips", label: dict.nav.trips, icon: TripsIcon, visible: true },
    {
      key: "gate",
      href: "/gate",
      label: dict.nav.gate,
      icon: GateIcon,
      visible: isSecurity || isFleetManager,
    },
    { key: "analytics", href: "/analytics", label: dict.nav.analytics, icon: AnalyticsIcon, visible: isFleetManager },
    { key: "fleet", href: "/fleet", label: dict.nav.fleet, icon: FleetIcon, visible: isFleetManager },
    { key: "team", href: "/settings/users", label: dict.nav.team, icon: TeamIcon, visible: isAdministrator },
    { key: "settings", href: "/settings", label: dict.nav.settings, icon: SettingsIcon, visible: isFleetManager },
  ];

  const visibleItems = items.filter((i) => i.visible);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <InactivityLogout />
      <SessionBackupSync />
      <MobileNav
        items={visibleItems.map(({ key, href, label }) => ({ key, href, label }))}
        active={active}
        orgName={orgName}
        userName={userName}
        role={role}
        dict={dict}
        locale={locale}
      />
      <aside className="hidden shrink-0 flex-col border-line-800 bg-panel-900/40 px-4 py-4 md:flex md:w-60 md:border-r md:py-5">
        <div className="px-1 md:mb-6">
          <p className="font-display text-xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-gwm-accent">.</span>
          </p>
          <p className="mt-0.5 max-w-[10rem] truncate text-xs uppercase tracking-widest text-fog-600">
            {orgName}
          </p>
        </div>

        <Link
          href="/trips/new"
          className="mb-5 flex items-center justify-center gap-2 rounded-sm bg-gwm-accent px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90"
        >
          {dict.chrome.requestTrip}
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {visibleItems.map((item) => {
            const isActive = item.key === active;
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-gwm-accent/10 text-gwm-accent"
                    : "text-fog-400 hover:bg-panel-800 hover:text-paper-50"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-y border-line-800 px-6 py-4">
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
            {title}
          </p>
          <div className="flex items-center gap-4">
            {headerActions}
            <div className="flex items-center gap-3">
              <LanguageToggle locale={locale} dict={dict} />
              <ThemeToggle dict={dict} />
            </div>
            <div className="hidden items-center gap-4 md:flex">
              <NotificationBell align="right" dict={dict} locale={locale} />
              <Link
                href="/account"
                className="hidden text-right lg:block"
                title={dict.chrome.accountLink}
              >
                <p className="truncate text-sm text-paper-50 hover:text-gwm-accent">{userName}</p>
                <p className="text-xs uppercase tracking-widest text-fog-600">
                  {roleLabels[role] ?? role}
                </p>
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  aria-label={dict.chrome.signOut}
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
