import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "./env";
import { VERIFIED_USER_EMAIL_HEADER, VERIFIED_USER_ID_HEADER } from "../auth/headers";

const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  // /reset-password is reachable pre-session on purpose — auth/callback is what actually
  // establishes the session (from the recovery email's code), and the page itself
  // redirects to /forgot-password if it's ever hit without one (reset-password/page.tsx).
  "/reset-password",
  "/auth/callback",
];

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-created accounts (InviteUserForm) start with a temporary password the admin
  // chose, not the member — every route except /account itself redirects there until
  // they set their own. Read off the JWT's app_metadata (already fetched above by
  // getUser(), which the client can't forge) instead of a second DB round trip to
  // profiles for every request.
  if (user.app_metadata?.must_change_password && !pathname.startsWith("/account")) {
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
  // "security" is exempt — gate staff record vehicle movements, they don't drive.
  if (!pathname.startsWith("/account/license")) {
    const { data: ownProfile } = await supabase
      .from("profiles")
      .select("drivers_license_number, role")
      .eq("id", user.id)
      .maybeSingle();
    if (ownProfile && ownProfile.role !== "security" && !ownProfile.drivers_license_number) {
      const licenseUrl = new URL("/account/license", request.url);
      return NextResponse.redirect(licenseUrl);
    }
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
