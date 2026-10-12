import { headers } from "next/headers";
import { getLocale, getDictionary } from "../lib/i18n/getLocale";
import { getCurrentUser } from "../lib/auth/currentUser";
import { getOwnLicense, licenseMissingFromHeader } from "../lib/auth/ownLicense";
import { LICENSE_MISSING_HEADER } from "../lib/auth/headers";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { loadLatestChatState } from "./chat/queries";
import type { ChatState } from "./chat/actions";
import { getRoleLabels } from "./settings/users/ROLE_LABELS";
import type { Dictionary } from "../lib/i18n/dictionaries";
import { AnalyticsIcon, DashboardIcon, FleetIcon, GateIcon, SettingsIcon, TeamIcon, TripsIcon } from "./NavIcons";

/** "carpool" / "book" are the destinations the scoped FleetMind v2.0 shell (FmShell) adds. */
export type NavKey =
  | "dashboard"
  | "trips"
  | "gate"
  | "analytics"
  | "fleet"
  | "team"
  | "settings"
  | "carpool"
  | "book";

export interface ShellNavItem {
  key: NavKey;
  href: string;
  label: string;
  icon: typeof DashboardIcon;
  visible: boolean;
}

/** The shared navigation items (same order and visibility rules for every shell). */
export function buildBaseNavItems(
  dict: Dictionary,
  { role, isFleetManager, isAdministrator }: { role: string; isFleetManager: boolean; isAdministrator: boolean },
): ShellNavItem[] {
  const isSecurity = role === "security";
  return [
    // "Painel" (fleet-wide approvals/active-reservations/tasks) is a plain employee's
    // nothing-to-do-here screen, same reasoning as hiding it for them — and a security/gate
    // user's whole job is pickup/return checklists on "Movimentações", nothing on Painel
    // is theirs to approve or manage either, so it's hidden for pure security too (not for
    // fleet_manager/administrator, who also carry security's own gate duties sometimes).
    { key: "dashboard", href: "/dashboard", label: dict.nav.dashboard, icon: DashboardIcon, visible: isFleetManager },
    { key: "trips", href: "/trips", label: dict.nav.trips, icon: TripsIcon, visible: true },
    { key: "gate", href: "/gate", label: dict.nav.gate, icon: GateIcon, visible: isSecurity || isFleetManager },
    { key: "analytics", href: "/analytics", label: dict.nav.analytics, icon: AnalyticsIcon, visible: isFleetManager },
    { key: "fleet", href: "/fleet", label: dict.nav.fleet, icon: FleetIcon, visible: isFleetManager },
    { key: "team", href: "/settings/users", label: dict.nav.team, icon: TeamIcon, visible: isAdministrator },
    { key: "settings", href: "/settings", label: dict.nav.settings, icon: SettingsIcon, visible: isFleetManager },
  ];
}

/**
 * Everything the app shells (AppShell and the scoped FmShell) need besides their own markup: locale/dictionary,
 * the license-gate state that drives the bell and the locked-down layout, the avatar and the chat assistant's
 * initial state. One loader so the two shells can never drift apart.
 */
export async function loadShellContext(role: string) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const roleLabels = getRoleLabels(dict);

  // Drives the bell's shake animation + the injected "CNH not uploaded" notice
  // (dashboard/NotificationBell.tsx) — fetched here, once, so every page using a shell gets it for free.
  const supabase = await createSupabaseServerClient();
  const currentUser = await getCurrentUser(supabase);
  let licenseMissing = false;
  let avatarUrl: string | null = null;
  if (currentUser) {
    // License columns are not directly readable since 0063: get_my_license() answers for the caller only.
    // L6: middleware already read it for this request (one RPC per request, not two); only when it did not
    // (/account routes skip the gate, or the read failed there) does the shell read it itself.
    const fromMiddleware = licenseMissingFromHeader((await headers()).get(LICENSE_MISSING_HEADER));
    const [{ data: ownProfile }, ownLicense] = await Promise.all([
      supabase.from("profiles").select("avatar_url").eq("id", currentUser.id).maybeSingle(),
      fromMiddleware === null ? getOwnLicense(supabase) : Promise.resolve(null),
    ]);
    // null = the read failed: do not lock the UI down on a transient error (the middleware gate fails open too).
    licenseMissing = fromMiddleware !== null ? fromMiddleware : ownLicense ? !ownLicense.number : false;
    avatarUrl = ownProfile?.avatar_url ?? null;
  }

  // The gatehouse nav item has to appear on every screen a security user can land on.
  const isSecurity = role === "security";

  // The actual navigation block lives in middleware.ts (redirects any other route to /account/license before it
  // ever renders) — this only decides what the one page that survives that redirect looks like.
  const licenseGateActive = licenseMissing && !isSecurity;

  const chatInitialState: ChatState = currentUser
    ? await loadLatestChatState(supabase, currentUser.id)
    : { status: "idle", messages: [] };

  return { locale, dict, roleLabels, licenseMissing, avatarUrl, licenseGateActive, chatInitialState };
}
