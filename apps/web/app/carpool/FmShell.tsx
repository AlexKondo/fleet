import Link from "next/link";
import { signOut } from "../dashboard/actions";
import { InactivityLogout } from "../InactivityLogout";
import { SessionBackupSync } from "../SessionBackupSync";
import { NotificationBell } from "../dashboard/NotificationBell";
import { LanguageToggle } from "../ui/LanguageToggle";
import { getRoleLabels } from "../settings/users/ROLE_LABELS";
import { DashboardIcon, LogoutIcon, TripsIcon } from "../NavIcons";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import "./fm-theme.css";

/**
 * Scoped shell of the new FleetMind look (SCR-USR-003): navy sidebar on desktop, bottom navigation on mobile.
 * Only destinations that exist today are listed (nothing decorative). Everything is under `.fm-theme`.
 */
function FindRideIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

export function FmShell({
  dict,
  locale,
  orgName,
  userName,
  role,
  isFleetManager,
  children,
}: {
  dict: Dictionary;
  locale: Locale;
  orgName: string;
  userName: string;
  role: string;
  isFleetManager: boolean;
  children: React.ReactNode;
}) {
  const roleLabels = getRoleLabels(dict);
  const items: { key: string; href: string; label: string; Icon: typeof TripsIcon; visible: boolean }[] = [
    { key: "dashboard", href: "/dashboard", label: dict.nav.dashboard, Icon: DashboardIcon, visible: isFleetManager },
    { key: "carpool", href: "/carpool", label: dict.carpool.buscar.navFind, Icon: FindRideIcon, visible: true },
    { key: "book", href: "/trips/new", label: dict.chrome.requestTrip.replace(/^\+\s*/, ""), Icon: TripsIcon, visible: true },
    { key: "trips", href: "/trips", label: dict.nav.trips, Icon: TripsIcon, visible: true },
  ];
  const visible = items.filter((i) => i.visible);

  const renderLinks = () =>
    visible.map(({ key, href, label, Icon }) => (
      <Link key={key} href={href} aria-current={key === "carpool" ? "page" : undefined}>
        <Icon className="" />
        <span>{label}</span>
      </Link>
    ));

  return (
    <div className="fm-theme" data-testid="fm-theme">
      <InactivityLogout />
      <SessionBackupSync />
      <aside className="fm-sidebar">
        <div className="fm-brand">
          <p className="fm-brand-name">FleetMind</p>
          <p className="fm-brand-org">{orgName}</p>
        </div>
        <nav className="fm-nav" aria-label={dict.carpool.buscar.navMain}>
          {renderLinks()}
        </nav>
      </aside>

      <div className="fm-main">
        <header className="fm-topbar">
          <p className="fm-topbar-brand">FleetMind</p>
          <div className="fm-topbar-right">
            <LanguageToggle locale={locale} dict={dict} />
            <NotificationBell align="right" dict={dict} locale={locale} />
            <Link href="/account" className="fm-user" title={dict.chrome.accountLink}>
              <p className="fm-user-name">{userName}</p>
              <p className="fm-user-role">{roleLabels[role] ?? role}</p>
            </Link>
            <form action={signOut}>
              <button type="submit" className="fm-icon-btn" aria-label={dict.chrome.signOut}>
                <LogoutIcon className="" />
              </button>
            </form>
          </div>
        </header>
        <main className="fm-content">{children}</main>
      </div>

      <nav className="fm-bottom-nav" aria-label={dict.carpool.buscar.navMain}>
        {renderLinks()}
      </nav>
    </div>
  );
}
