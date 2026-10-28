import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "./env";
import { LICENSE_MISSING_HEADER, VERIFIED_USER_EMAIL_HEADER, VERIFIED_USER_ID_HEADER } from "../auth/headers";
import { getOwnLicense, canDrive } from "../auth/ownLicense";
import { accountEnabled } from "../auth/accountAccess";

const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  // /reset-password is reachable pre-session on purpose — auth/callback is what actually
  // establishes the session (from the recovery email's code), and the page itself
  // redirects to /forgot-password if it's ever hit without one (reset-password/page.tsx).
  "/reset-password",
  "/auth/callback",
  // Vercel cron (vercel.json) calls /api/cron/* with NO user session - only an
  // `Authorization: Bearer $CRON_SECRET` header, which each route handler verifies itself. Without
  // this entry the session check below redirected every cron request to /login (307), so none of
  // the cron jobs (license reminders, chat cleanup, carpool expiry + reconcile sweep) ever ran.
  "/api/cron/",
  // n8n forwards the manager's WhatsApp answer (Aprovar / Recusar) with NO user session; the route verifies an HMAC signature itself
  // (N8N_APPROVAL_SECRET) and the decision is authorized inside the database (migration 0229). Fails closed without the secret.
  "/api/whatsapp/",
];

const MANAGEMENT_ROLES = ["fleet_manager", "administrator", "maintenance_operator"];
const ADMINISTRATIVE_PREFIXES = ["/fleet", "/settings", "/maintenance", "/admin", "/analytics", "/dashboard", "/gate"];

export function isManagementRole(role: string | null | undefined): boolean {
  return MANAGEMENT_ROLES.includes(role ?? "");
}

/**
 * Administrative / management workspaces that never drive a vehicle. Each page still enforces its own
 * role authorization (e.g. a maintenance operator opening /admin is redirected by the page); this list only
 * decides that the CNH gate does not apply. "/" is the per-role landing redirector, and the reservation
 * detail (exact path) is where managers approve and regularize - its /pickup subroute stays gated.
 */
export function isAdministrativePath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (/^\/reservations\/[^/]+\/?$/.test(pathname)) return true;
  return ADMINISTRATIVE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Strips any client-supplied copy of the verified-identity headers. These are set below
 * from `supabase.auth.getUser()` and trusted downstream by lib/auth/currentUser.ts, so
 * they must never survive from an inbound request — every matched route passes through
 * here, and every path through this function either deletes or overwrites them.
 */
function sanitizedHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete(VERIFIED_USER_ID_HEADER);
  headers.delete(VERIFIED_USER_EMAIL_HEADER);
  headers.delete(LICENSE_MISSING_HEADER);
  return headers;
}

/**
 * Refreshes the Supabase auth session cookie on every request and redirects
 * unauthenticated visitors away from protected routes. Runs in middleware.ts.
 *
 * `supabase.auth.getUser()` is a real network round trip to Supabase's auth API. It used
 * to run here *and* again in every single page.tsx, so each authenticated page load paid
 * for the identity check twice back-to-back. The verified id/email are now forwarded to
 * the render as request headers, so pages resolve the caller for free
 * (lib/auth/currentUser.ts). Public routes skip the call entirely — the login screen had
 * no reason to wait on an auth round trip it then ignores.
 */
export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  // /api/geo/* (route map + address autocomplete) are JSON endpoints: they need a session but must answer 401 JSON (never a
  // redirect to the login page) and are not subject to the UI gates below (password change / CNH) - they only serve typing aids.
  const isGeoApi = pathname.startsWith("/api/geo/");
  const isPublicRoute = PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isPublicRoute) {
    return NextResponse.next({ request: { headers: sanitizedHeaders(request) } });
  }

  const { url, anonKey } = getSupabasePublicEnv();
  let responseHeaders = sanitizedHeaders(request);
  let response = NextResponse.next({ request: { headers: responseHeaders } });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        responseHeaders = sanitizedHeaders(request);
        response = NextResponse.next({ request: { headers: responseHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // The middleware may run far from the database (edge location nearest the user vs the Supabase region), so every sequential
  // call costs a full round trip. The identity check, the account check and the gate reads do not depend on each other's
  // result (all use the caller's own token; decisions are still taken in the same order below), so they go out together:
  // one round trip instead of three. The auth client serializes a token refresh internally, so this cannot double-refresh.
  const returnOrEvidence = /^\/reservations\/[^/]+\/(?:return|evidence\/[^/]+)\/?$/.test(pathname);
  const nonDrivingDocuments = returnOrEvidence || pathname === "/fleet/archive" || pathname === "/fleet/equipment" || pathname === "/documents" || pathname.startsWith("/documents/") || pathname.startsWith("/api/exports/");
  const needsGateReads = !pathname.startsWith("/account") && !isGeoApi && !nonDrivingDocuments;
  // The own-profile read needs the caller's id BEFORE getUser answers: read it from the session cookie (local, no network). It is
  // only a filter: the query itself runs with the caller's token under RLS, and the identity used for every decision below is
  // still the one verified by getUser().
  const sessionUserId = needsGateReads ? (await supabase.auth.getSession()).data.session?.user.id : undefined;
  const [userResult, enabled, gateReads] = await Promise.all([
    supabase.auth.getUser(),
    accountEnabled(supabase),
    needsGateReads && sessionUserId
      ? Promise.all([supabase.from("profiles").select("role").eq("id", sessionUserId).maybeSingle(), getOwnLicense(supabase)])
      : Promise.resolve(null),
  ]);
  const user = userResult.data.user;

  if (!user && isGeoApi) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!enabled) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "account_unavailable" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("access", "unavailable");
    return NextResponse.redirect(loginUrl);
  }

  // Admin-created accounts (InviteUserForm) start with a temporary password the admin
  // chose, not the member — every route except /account itself redirects there until
  // they set their own. Read off the JWT's app_metadata (already fetched above by
  // getUser(), which the client can't forge) instead of a second DB round trip to
  // profiles for every request.
  if (user.app_metadata?.must_change_password && !pathname.startsWith("/account") && !isGeoApi) {
    const accountUrl = new URL("/account", request.url);
    accountUrl.searchParams.set("forcePasswordChange", "1");
    return NextResponse.redirect(accountUrl);
  }

  // Driver's license gate: a driver who hasn't uploaded their CNH yet must not be able to
  // reach any other screen just by typing a URL — AppShell hiding the nav links isn't
  // enough on its own, since the routes themselves were still reachable directly (the
  // gap the user found: clicking a link the sidebar doesn't even show). Checked here,
  // same place/pattern as the must_change_password gate above, so it can't be bypassed by
  // navigating straight to a route AppShell never rendered a link for.
  // "security" is exempt — gate staff record vehicle movements, they don't drive. /account
  // (change password, personal data) stays reachable too — the user menu is visible during
  // this gate specifically so those two screens don't need the CNH uploaded first.
  if (gateReads) {
    // 0063: the license columns are revoked from `authenticated`; get_my_license() is the own-row reader.
    const [{ data: ownProfile }, ownLicense] = gateReads;
    // Driving requires a successful license read; administrative workspaces remain separate
    // (approved rule: the CNH blocks DRIVING - pickup, keys for driving, departure - never the
    // administrative access of a manager/administrator/maintenance operator). The driving routes
    // (/trips*, /carpool*, /reservations/[id]/pickup) and every other role keep the CNH gate; the
    // driving ACTIONS stay blocked server-side (RPCs) regardless of this routing decision, and the
    // CNH notice keeps showing (LICENSE_MISSING_HEADER below).
    const drivingPath=pathname === "/trips/new" || pathname.startsWith("/trips/new/") || /^\/reservations\/[^/]+\/pickup\/?$/.test(pathname);
    const explicitManagerWorkspace = isManagementRole(ownProfile?.role) && isAdministrativePath(pathname);
    if (ownProfile?.role !== "security" && !explicitManagerWorkspace && drivingPath && !canDrive(ownLicense)) {
      return NextResponse.redirect(new URL("/account/license", request.url));
    }
    // L6: hand the result to the render so AppShell does not repeat the same RPC for this request.
    if (ownLicense) responseHeaders.set(LICENSE_MISSING_HEADER, canDrive(ownLicense) ? "0" : "1");
  }

  responseHeaders.set(VERIFIED_USER_ID_HEADER, user.id);
  if (user.email) {
    responseHeaders.set(VERIFIED_USER_EMAIL_HEADER, user.email);
  }
  const forwarded = NextResponse.next({ request: { headers: responseHeaders } });
  for (const cookie of response.cookies.getAll()) {
    forwarded.cookies.set(cookie);
  }
  return forwarded;
}
