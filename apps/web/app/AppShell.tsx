import Link from "next/link";
import { signOut } from "./dashboard/actions";
import { InactivityLogout } from "./InactivityLogout";
import { SessionBackupSync } from "./SessionBackupSync";
import { ChatWidget } from "./ChatWidget";
import { MobileNav } from "./MobileNav";
import { NotificationBell } from "./dashboard/NotificationBell";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ui/ThemeToggle";
import { LanguageToggle } from "./ui/LanguageToggle";
import { LogoutIcon } from "./NavIcons";
import { buildBaseNavItems, loadShellContext, type NavKey } from "./shellData";

export type { NavKey };

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
  const { locale, dict, roleLabels, licenseMissing, avatarUrl, licenseGateActive, chatInitialState, canKeyCustody } =
    await loadShellContext(role);

  const items = buildBaseNavItems(dict, { role, isFleetManager, isAdministrator, canKeyCustody });

  const visibleItems = items.filter((i) => i.visible);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a href="#fleetmind-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-white focus:px-4 focus:py-3 focus:text-black focus:shadow-lg">
        Ir para o conteúdo principal
      </a>
      <InactivityLogout />
      <SessionBackupSync />
      {licenseGateActive ? null : (
        <ChatWidget dict={dict} locale={locale} initialState={chatInitialState} />
      )}
      {licenseGateActive ? null : (
        <MobileNav
          items={visibleItems.map(({ key, href, label }) => ({ key, href, label }))}
          active={active}
          orgName={orgName}
          userName={userName}
          role={role}
          dict={dict}
          locale={locale}
        />
      )}
      {licenseGateActive ? null : (
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
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-y border-line-800 px-6 py-4">
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
            {title}
          </p>
          <div className="flex items-center gap-4">
            {licenseGateActive ? null : headerActions}
            <div className="flex items-center gap-3">
              <LanguageToggle locale={locale} dict={dict} />
              <ThemeToggle dict={dict} />
            </div>
            <div className="hidden items-center gap-4 md:flex">
              {/* The bell's own "CNH pendente" item just links back to this exact page, so
                  it stays hidden during the gate — but the user menu is worth keeping: it's
                  how someone reaches "Trocar senha" without the CNH upload blocking that. */}
              {licenseGateActive ? null : (
                <NotificationBell align="right" dict={dict} locale={locale} licenseMissing={licenseMissing} />
              )}
              <UserMenu userName={userName} roleLabel={roleLabels[role] ?? role} avatarUrl={avatarUrl} dict={dict} />
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
        {licenseGateActive ? (
          <p
            role="alert"
            className="mx-6 mt-4 rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 px-4 py-3 text-sm text-gwm-accent"
          >
            {dict.chrome.licenseGateNotice}
            {canKeyCustody ? <Link href="/account/keys">Abrir custódia de chaves (não exige CNH)</Link> : null}
          </p>
        ) : null}
        <main id="fleetmind-main" tabIndex={-1} className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
