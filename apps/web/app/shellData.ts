import { headers } from "next/headers";
import { getLocale, getDictionary } from "../lib/i18n/getLocale";
import { getCurrentUser } from "../lib/auth/currentUser";
import {
  getOwnLicense,
  canDrive,
  licenseMissingFromHeader,
} from "../lib/auth/ownLicense";
import { LICENSE_MISSING_HEADER } from "../lib/auth/headers";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { loadLatestChatState } from "./chat/queries";
import type { ChatState } from "./chat/actions";
import { getRoleLabels } from "./settings/users/ROLE_LABELS";
import type { Dictionary } from "../lib/i18n/dictionaries";
import {
  AnalyticsIcon,
  DashboardIcon,
  FleetIcon,
  GateIcon,
  SettingsIcon,
  TeamIcon,
  TripsIcon,
} from "./NavIcons";

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
  | "book"
  | "maintenance"
  | "planning"
  | "orders"
  | "vehicleHistory"
  | "energy"
  | "drivers"
  | "incidents"
  | "gateExceptions"
  | "gateHistory"
  | "admin"
  | "myCarpools"
  | "keys"
  | "keyManagement"
  | "budgetApprovals"
  | "reservationApprovals";

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
  {
    role,
    isFleetManager,
    isAdministrator,
    canKeyCustody = false,
    canBudgetApproval = false,
    canReservationApproval = false,
  }: { role: string; isFleetManager: boolean; isAdministrator: boolean; canKeyCustody?: boolean;canBudgetApproval?:boolean;canReservationApproval?:boolean },
): ShellNavItem[] {
  const isSecurity = role === "security";
  return [
    // "Painel" (fleet-wide approvals/active-reservations/tasks) is a plain employee's
    // nothing-to-do-here screen, same reasoning as hiding it for them — and a security/gate
    // user's whole job is pickup/return checklists on "Movimentações", nothing on Painel
    // is theirs to approve or manage either, so it's hidden for pure security too (not for
    // fleet_manager/administrator, who also carry security's own gate duties sometimes).
    {
      key: "dashboard",
      href: isFleetManager ? "/dashboard/command-center" : "/dashboard",
      label: dict.nav.dashboard,
      icon: DashboardIcon,
      visible: isFleetManager,
    },
    {
      key: "trips",
      href: "/trips",
      label: dict.nav.trips,
      icon: TripsIcon,
      visible: true,
    },
    {
      key: "gate",
      href: "/gate",
      label: dict.nav.gate,
      icon: GateIcon,
      visible: isSecurity || isFleetManager,
    },
    {
      key: "analytics",
      href: "/analytics",
      label: dict.nav.analytics,
      icon: AnalyticsIcon,
      visible: isFleetManager,
    },
    {
      key: "fleet",
      href: "/fleet",
      label: dict.nav.fleet,
      icon: FleetIcon,
      visible: isFleetManager,
    },
    {
      key: "team",
      href: "/settings/users",
      label: dict.nav.team,
      icon: TeamIcon,
      visible: isAdministrator,
    },
    {
      key: "maintenance",
      href: isFleetManager ? "/fleet/maintenance" : "/maintenance",
      label: dict.navExtra.maintenance,
      icon: FleetIcon,
      visible: isFleetManager || role === "maintenance_operator",
    },
    {
      key: "planning",
      href: "/maintenance/planning",
      label: dict.navExtra.planning,
      icon: DashboardIcon,
      visible: isFleetManager || role === "maintenance_operator",
    },
    {
      key: "orders",
      href: "/maintenance/work-orders",
      label: dict.navExtra.workOrders,
      icon: TripsIcon,
      visible: isFleetManager || role === "maintenance_operator",
    },
    {
      key: "vehicleHistory",
      href: "/maintenance/vehicles",
      label: dict.navExtra.vehicleRecord,
      icon: FleetIcon,
      visible: isFleetManager || role === "maintenance_operator",
    },
    {
      key: "energy",
      href: "/fleet/energy",
      label: dict.navExtra.energy,
      icon: AnalyticsIcon,
      visible: isFleetManager,
    },
    {
      key: "drivers",
      href: "/fleet/drivers",
      label: dict.navExtra.drivers,
      icon: TeamIcon,
      visible: isFleetManager,
    },
    {
      key: "incidents",
      href: "/fleet/incidents",
      label: dict.navExtra.incidents,
      icon: GateIcon,
      visible: isFleetManager,
    },
    {
      key: "gateExceptions",
      href: "/gate/exceptions",
      label: dict.navExtra.gateExceptions,
      icon: GateIcon,
      visible: isSecurity || isFleetManager,
    },
    {
      key: "gateHistory",
      href: "/gate/history",
      label: dict.navExtra.gateHistory,
      icon: TripsIcon,
      visible: isSecurity || isFleetManager,
    },
    {
      key: "keys",href:"/account/keys",label:dict.navExtra.keyCustody,icon:GateIcon,visible:canKeyCustody,
    },
    {key:"budgetApprovals",href:"/account/maintenance-approvals",label:dict.navExtra.budgetApprovals,icon:TripsIcon,visible:canBudgetApproval||isFleetManager},
    {key:"reservationApprovals",href:"/approvals",label:dict.navExtra.reservationApprovals,icon:TripsIcon,visible:canReservationApproval},
    {key:"keyManagement",href:"/fleet/keys",label:dict.navExtra.keyTracking,icon:GateIcon,visible:isFleetManager},
    {
      key: "admin",
      href: "/admin",
      label: dict.navExtra.admin,
      icon: SettingsIcon,
      visible: isAdministrator,
    },
    {
      key: "settings",
      href: "/settings",
      label: dict.nav.settings,
      icon: SettingsIcon,
      visible: isFleetManager,
    },
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
  let canKeyCustody = false;
  let canBudgetApproval = false;
  let canReservationApproval = false;
  if (currentUser) {
    try {
      const result=await supabase.rpc("fm_has_key_custody");
      canKeyCustody=!result.error && result.data===true;
    } catch { canKeyCustody=false; }
    try{const result=await supabase.rpc("fm_has_budget_approval_assignment");canBudgetApproval=!result.error&&result.data===true;}catch{canBudgetApproval=false;}
    // direct manager of at least one person (migration 0229): shows "Aprovar reservas"; false (hidden) if the function does not exist yet
    try{const result=await supabase.rpc("fm_has_direct_reports");canReservationApproval=!result.error&&result.data===true;}catch{canReservationApproval=false;}
    // License columns are not directly readable since 0063: get_my_license() answers for the caller only.
    // L6: middleware already read it for this request (one RPC per request, not two); only when it did not
    // (/account routes skip the gate, or the read failed there) does the shell read it itself.
    const fromMiddleware = licenseMissingFromHeader(
      (await headers()).get(LICENSE_MISSING_HEADER),
    );
    const [{ data: ownProfile }, ownLicense] = await Promise.all([
      supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", currentUser.id)
        .maybeSingle(),
      fromMiddleware === null ? getOwnLicense(supabase) : Promise.resolve(null),
    ]);
    // Failed license lookup denies driving; non-driving administrative work remains reachable.
    licenseMissing =
      fromMiddleware !== null
        ? fromMiddleware
        : ownLicense
          ? !canDrive(ownLicense)
          : true;
    avatarUrl = ownProfile?.avatar_url ?? null;
  }

  // The gatehouse nav item has to appear on every screen a security user can land on.
  const isSecurity = role === "security";

  // The actual navigation block lives in middleware.ts (redirects any other route to /account/license before it
  // ever renders) — this only decides what the one page that survives that redirect looks like.
  const licenseGateActive = false; // Driving routes and RPCs enforce CNH; passenger/admin navigation remains accessible.

  const chatInitialState: ChatState = currentUser
    ? await loadLatestChatState(supabase, currentUser.id)
    : { status: "idle", messages: [] };

  return {
    userId: currentUser?.id ?? null,
    locale,
    dict,
    roleLabels,
    licenseMissing,
    avatarUrl,
    licenseGateActive,
    chatInitialState,
    canKeyCustody,
    canBudgetApproval,
    canReservationApproval,
  };
}
