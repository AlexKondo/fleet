import Link from "next/link";
import { signOut } from "../dashboard/actions";
import { InactivityLogout } from "../InactivityLogout";
import { SessionBackupSync } from "../SessionBackupSync";
import { ChatWidget } from "../ChatWidget";
import { MobileNav } from "../MobileNav";
import { NotificationBell } from "../dashboard/NotificationBell";
import { UserMenu } from "../UserMenu";
import { LanguageToggle } from "../ui/LanguageToggle";
import { ThemeToggle } from "../ui/ThemeToggle";
import { FindRideIcon, LogoutIcon, TripsIcon } from "../NavIcons";
import { buildBaseNavItems, loadShellContext, type NavKey } from "../shellData";
import "./fm-theme.css";
import "./fm-shared.css";

/**
 * Scoped shell of the new FleetMind look (SCR-USR-003 / SCR-USR-002): navy sidebar on desktop, bottom navigation
 * plus the shared hamburger menu on mobile. It carries EVERYTHING AppShell carries for the same role (the data
 * comes from the same loader, the widgets are the same components): chat assistant, every nav item the role may
 * see, the "Solicitar viagem" CTA, theme/language toggles, the bell with the license notice, the user menu, the
 * license gate. Everything is under `.fm-theme`.
 */
export async function FmShell({
  orgName,
  userName,
  role,
  isFleetManager,
  isAdministrator,
  active = "carpool",
  children,
}: {
  orgName: string;
  userName: string;
  role: string;
  isFleetManager: boolean;
  isAdministrator: boolean;
  /** Which nav item is the current page. */
  active?: NavKey;
  children: React.ReactNode;
}) {
  const { locale, dict, roleLabels, licenseMissing, avatarUrl, licenseGateActive, chatInitialState } =
    await loadShellContext(role);

  const base = buildBaseNavItems(dict, { role, isFleetManager, isAdministrator });
  // The employee's Home (SCR-USR-001) lives at /dashboard; managers keep "Painel" there.
  if (role === "employee") base[0] = { ...base[0]!, label: dict.dashboard.home.navHome, visible: true };
  const extra = [
    { key: "carpool" as NavKey, href: "/carpool", label: dict.carpool.buscar.navFind, icon: FindRideIcon, visible: true },
    { key: "book" as NavKey, href: "/trips/new", label: dict.trips.reservar.navBook, icon: TripsIcon, visible: true },
  ];
  // dashboard first, then the two rider destinations, then the shared items
  const items = [base[0]!, ...extra, ...base.slice(1)].filter((i) => i.visible);
  // the bottom bar only fits the main destinations; the hamburger menu (MobileNav) lists everything
  const bottomKeys: NavKey[] = ["dashboard", "carpool", "book", "trips"];
  const bottomItems = items.filter((i) => bottomKeys.includes(i.key));

  const link = ({ key, href, label, icon: Icon }: (typeof items)[number]) => (
    <Link key={key} href={href} aria-current={key === active ? "page" : undefined}>
      <Icon className="" />
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="fm-theme" data-testid="fm-theme">
      <InactivityLogout />
      <SessionBackupSync />
      {licenseGateActive ? null : (
        <div className="fm-chat">
          <ChatWidget dict={dict} locale={locale} initialState={chatInitialState} />
        </div>
      )}
      {licenseGateActive ? null : (
        <aside className="fm-sidebar">
          <div className="fm-brand">
            <p className="fm-brand-name">FleetMind</p>
            <p className="fm-brand-org">{orgName}</p>
          </div>
          <Link href="/trips/new" className="fm-cta">
            {dict.chrome.requestTrip}
          </Link>
          <nav className="fm-nav" aria-label={dict.carpool.buscar.navMain}>
            {items.map(link)}
          </nav>
        </aside>
      )}

      <div className="fm-main">
        <header className="fm-topbar">
          <p className="fm-topbar-brand">FleetMind</p>
          <div className="fm-topbar-right">
            <LanguageToggle locale={locale} dict={dict} />
            <ThemeToggle dict={dict} />
          {licenseGateActive ? null : (
            <div className="fm-mobilenav">
              <MobileNav
                compact
                items={items.map(({ key, href, label }) => ({ key, href, label }))}
                active={active}
                orgName={orgName}
                userName={userName}
                role={role}
                dict={dict}
                locale={locale}
              />
            </div>
          )}
            <div className="fm-topbar-desktop">
              {licenseGateActive ? null : (
                <NotificationBell align="right" dict={dict} locale={locale} licenseMissing={licenseMissing} />
              )}
              <UserMenu userName={userName} roleLabel={roleLabels[role] ?? role} avatarUrl={avatarUrl} dict={dict} />
              <form action={signOut}>
                <button type="submit" className="fm-icon-btn" aria-label={dict.chrome.signOut}>
                  <LogoutIcon className="" />
                </button>
              </form>
            </div>
          </div>
        </header>
        {licenseGateActive ? (
          <p role="alert" className="fm-banner" style={{ margin: "16px 16px 0" }}>
            {dict.chrome.licenseGateNotice}
          </p>
        ) : null}
        <main className="fm-content">{children}</main>
      </div>

      {licenseGateActive ? null : (
        <nav className="fm-bottom-nav" aria-label={dict.carpool.buscar.navMain}>
          {bottomItems.map(link)}
        </nav>
      )}
    </div>
  );
}
