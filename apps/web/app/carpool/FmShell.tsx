import Link from "next/link";
import { cookies } from "next/headers";
import { SidebarResizer } from "./SidebarResizer";
import { parseSidebarWidth, sidebarCookieName } from "@/lib/ui/sidebarWidth";
import { signOut } from "../dashboard/actions";
import { InactivityLogout } from "../InactivityLogout";
import { SessionBackupSync } from "../SessionBackupSync";
import { ChatWidget } from "../ChatWidget";
import { MobileNav } from "../MobileNav";
import { NavFeedback } from "./NavFeedback";
import { NotificationBell } from "../dashboard/NotificationBell";
import { UserMenu } from "../UserMenu";
import { AssistantPanel } from "./AssistantPanel";
import { formatDate } from "@/lib/formatDateTime";
import { LanguageToggle } from "../ui/LanguageToggle";
import { ThemeToggle } from "../ui/ThemeToggle";
import { FindRideIcon, LogoutIcon, TripsIcon } from "../NavIcons";
import { buildBaseNavItems, loadShellContext, type NavKey } from "../shellData";
import "./fm-theme.css";
import "./fm-shared.css";
import "../fm-ops.css";

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
  title,
  subtitle,
  headerActions,
  legacy = false,
  wide = false,
  commandCenter = false,
  workspace,
  searchContent,
  nonDrivingWorkspace = false,
  children,
}: {
  orgName: string;
  userName: string;
  role: string;
  isFleetManager: boolean;
  isAdministrator: boolean;
  /** Which nav item is the current page. */
  active?: NavKey;
  /** Group B (manager/security/admin screens): page title row rendered at the top of the content. */
  title?: string;
  subtitle?: string;
  /** Page-specific header controls (hidden while the license gate is active, like the old AppShell). */
  headerActions?: React.ReactNode;
  /** Content still uses the legacy Tailwind markup: restyled by fm-ops.css under `.fm-legacy`. */
  legacy?: boolean;
  /** Wider content column (dashboards, tables). */
  wide?: boolean;
  commandCenter?: boolean;
  workspace?: "manager" | "operations";
  searchContent?: React.ReactNode;
  /** Only the authorized local-custody page: custody does not require a CNH. */
  nonDrivingWorkspace?: boolean;
  children: React.ReactNode;
}) {
  const {
    userId,
    locale,
    dict,
    roleLabels,
    licenseMissing,
    avatarUrl,
    licenseGateActive: driverLicenseGateActive,
    chatInitialState,
    canKeyCustody,
    canBudgetApproval,
    canReservationApproval,
  } = await loadShellContext(role);
  const licenseGateActive=driverLicenseGateActive && !(nonDrivingWorkspace && (canKeyCustody||canBudgetApproval||canReservationApproval||isFleetManager||role==="maintenance_operator"));

  // the width this person chose for the side menu (cookie named after the user): the page is drawn at it from the first paint
  let sidebarWidth = parseSidebarWidth(undefined);
  try {
    sidebarWidth = parseSidebarWidth((await cookies()).get(sidebarCookieName(userId))?.value);
  } catch {
    // no request scope (a render outside a request): the default width
  }

  // "Hoje, dd/mm/aaaa" in Brasília time (the fleet's time zone, whatever the server runtime's zone is).
  const todayText = dict.chrome.todayPill.replace(
    "{date}",
    formatDate(new Date().toISOString(), locale),
  );

  const base = buildBaseNavItems(dict, {
    role,
    isFleetManager,
    isAdministrator,
    canKeyCustody,
    canBudgetApproval,
    canReservationApproval,
  });
  // The employee's Home (SCR-USR-001) lives at /dashboard; managers keep "Painel" there.
  if (role === "employee")
    base[0] = {
      ...base[0]!,
      label: dict.dashboard.home.navHome,
      visible: true,
    };
  const extra: {
    key: NavKey;
    href: string;
    label: string;
    icon: typeof FindRideIcon;
    visible: boolean;
  }[] = [
    {
      key: "carpool" as NavKey,
      href: isFleetManager ? "/fleet/carpools" : "/carpool",
      label: isFleetManager ? dict.navExtra.carpoolManagement : dict.carpool.buscar.navFind,
      icon: FindRideIcon,
      visible: true,
    },
    {
      key: "book" as NavKey,
      href: "/trips/new",
      label: dict.trips.reservar.navBook,
      icon: TripsIcon,
      visible: true,
    },
  ];
  extra.push({
    key: "myCarpools",
    href: "/carpool/mine",
    label: dict.navExtra.myCarpools,
    icon: FindRideIcon,
    visible: true,
  });
  // dashboard first, then the two rider destinations, then the shared items
  const unordered = [base[0]!, ...extra, ...base.slice(1)].filter((i) => i.visible);
  // Fleet managers: the manager destinations come first (reference order: home, fleet, trips/carpools, maintenance,
  // energy, drivers, users, reports, settings), the personal "rider" items (book, my carpools, my trips) are
  // grouped at the end behind a divider. Same keys, same routes, same visibility: nothing is removed.
  const personalKeys: NavKey[] = ["book", "myCarpools", "trips"];
  const managerOrder: NavKey[] = [
    "dashboard", "fleet", "carpool", "gate", "maintenance", "planning", "orders", "vehicleHistory", "energy",
    "drivers", "team", "incidents", "gateExceptions", "gateHistory", "keyManagement", "budgetApprovals", "reservationApprovals", "keys",
    "analytics", "admin", "settings",
  ];
  const rank = (k: NavKey, list: NavKey[]) => {
    const i = list.indexOf(k);
    return i === -1 ? list.length : i;
  };
  const items = isFleetManager
    ? [
        ...unordered
          .filter((i) => !personalKeys.includes(i.key))
          .sort((a, b) => rank(a.key, managerOrder) - rank(b.key, managerOrder)),
        ...unordered
          .filter((i) => personalKeys.includes(i.key))
          .sort((a, b) => rank(a.key, personalKeys) - rank(b.key, personalKeys)),
      ]
    : unordered;
  const firstPersonalKey = isFleetManager
    ? items.find((i) => personalKeys.includes(i.key))?.key
    : undefined;
  // the bottom bar only fits the main destinations; the hamburger menu (MobileNav) lists everything
  // (employees: home + rider destinations; operations roles: their own working screens)
  const isOps = role !== "employee";
  const bottomKeys: NavKey[] = isOps
    ? ["dashboard", "gate", "fleet", "trips", "carpool"]
    : ["dashboard", "carpool", "book", "trips"];
  const bottomItems = bottomKeys
    .map((k) => items.find((i) => i.key === k))
    .filter((i): i is (typeof items)[number] => Boolean(i));

  const link = ({ key, href, label, icon: Icon }: (typeof items)[number]) => (
    <Link
      key={key}
      href={href}
      aria-current={key === active ? "page" : undefined}
      data-nav-group={key === firstPersonalKey ? "personal-start" : undefined}
    >
      <Icon className="" />
      <span>{label}</span>
    </Link>
  );

  return (
    <div
      className={
        commandCenter
          ? "fm-theme fm-command"
          : workspace
            ? `fm-theme fm-workspace fm-workspace-${workspace}`
            : "fm-theme"
      }
      data-testid="fm-theme"
    >
      <a
        href="#fleetmind-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-white focus:px-4 focus:py-3 focus:text-black focus:shadow-lg"
      >
        {dict.navExtra.skipToContent}
      </a>
      <NavFeedback />
      <InactivityLogout />
      <SessionBackupSync />
      {licenseGateActive ? null : (
        <div className="fm-chat">
          <ChatWidget dict={dict} locale={locale} initialState={chatInitialState} embedded />
        </div>
      )}
      {licenseGateActive ? null : (
        <aside className="fm-sidebar" style={{ "--fm-sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}>
          <SidebarResizer userId={userId} initialWidth={sidebarWidth} label={dict.chrome.resizeMenu} />
          <div className="fm-brand">
            <p className="fm-brand-name">FleetMind</p>
            <p className="fm-brand-org">{dict.chrome.brandTagline}</p>
          </div>
          <Link href="/trips/new" className="fm-cta">
            {dict.chrome.requestTrip}
          </Link>
          <nav className="fm-nav" aria-label={dict.carpool.buscar.navMain}>
            {items.map(link)}
          </nav>
          <AssistantPanel dict={dict} />
        </aside>
      )}

      <div className="fm-main">
        <header className="fm-topbar">
          <p className="fm-topbar-brand">FleetMind</p>
          {licenseGateActive ? null : searchContent}
          <div className="fm-topbar-right">
            <LanguageToggle locale={locale} dict={dict} />
            {/* the light/dark toggle is on EVERY screen (the FleetMind look has a dark theme: `:root[data-theme="dark"] .fm-theme` in fm-theme.css) */}
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
                assistantLabel={dict.chrome.assistantTitle}
              />
            </div>
          )}
            <div className="fm-topbar-desktop">
              <span className="fm-tbpill fm-tbpill-date" data-testid="fm-today">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
                  <path d="M8 3v4M16 3v4M3.5 10h17" />
                </svg>
                {todayText}
              </span>
              {orgName && orgName !== "—" ? (
                <span
                  className="fm-tbpill fm-tbpill-org"
                  data-testid="fm-org"
                  title={dict.chrome.organizationLabel}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
                    <circle cx="12" cy="10" r="2.3" />
                  </svg>
                  <span className="fm-tbpill-text">{orgName}</span>
                </span>
              ) : null}
              {licenseGateActive ? null : (
                <NotificationBell
                  align="right"
                  dict={dict}
                  locale={locale}
                  licenseMissing={licenseMissing}
                />
              )}
              <UserMenu
                userName={userName}
                roleLabel={roleLabels[role] ?? role}
                avatarUrl={avatarUrl}
                dict={dict}
              />
              <div className="fm-user" data-testid="fm-user">
                <span className="fm-user-name">{userName}</span>
                <span className="fm-user-role">{roleLabels[role] ?? role}</span>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="fm-icon-btn"
                  aria-label={dict.chrome.signOut}
                >
                  <LogoutIcon className="" />
                </button>
              </form>
            </div>
          </div>
        </header>
        {licenseGateActive ? (
          <p
            role="alert"
            className="fm-banner"
            style={{ margin: "16px 16px 0" }}
          >
            {dict.chrome.licenseGateNotice}
            {canKeyCustody ? <Link href="/account/keys" className="fm-btn fm-btn-ghost">{dict.navExtra.openKeyCustody}</Link> : null}{canBudgetApproval ? <Link href="/account/maintenance-approvals" className="fm-btn fm-btn-ghost">{dict.navExtra.openBudgetApprovals}</Link> : null}
          </p>
        ) : null}
        <main
          id="fleetmind-main"
          tabIndex={-1}
          className={wide ? "fm-content fm-content-wide" : "fm-content"}
        >
          {title ? (
            <div className="fm-ops-head">
              <div className="fm-ops-head-text">
                <h1 className="fm-title">{title}</h1>
                {subtitle ? <p className="fm-subtitle">{subtitle}</p> : null}
              </div>
              {headerActions && !licenseGateActive ? (
                <div className="fm-ops-actions fm-legacy">{headerActions}</div>
              ) : null}
            </div>
          ) : null}
          {legacy ? <div className="fm-legacy">{children}</div> : children}
        </main>
      </div>

      {licenseGateActive ? null : (
        <nav className="fm-bottom-nav" aria-label={dict.carpool.buscar.navMain}>
          {bottomItems.map(link)}
        </nav>
      )}
    </div>
  );
}
