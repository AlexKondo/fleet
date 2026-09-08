import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "./env";

/**
 * Refreshes the Supabase auth session cookie on every request and redirects
 * unauthenticated visitors away from protected routes. Runs in middleware.ts.
 */
export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  // TEMP DEBUG (remove after root-causing the /trips/new session-clear bug): surface
  // exactly what middleware saw for this request, since the redirect below is
  // indistinguishable at the network level from any other code path that might redirect
  // to /login.
  const debugHeaders: [string, string][] = [
    ["x-debug-mw-ran", "1"],
    ["x-debug-mw-had-user", user ? "1" : "0"],
    ["x-debug-mw-method", request.method],
    ["x-debug-mw-path", request.nextUrl.pathname],
  ];
  if (getUserError) debugHeaders.push(["x-debug-mw-error", getUserError.message.slice(0, 200)]);
  for (const [k, v] of debugHeaders) response.headers.set(k, v);

  // /reset-password is reachable pre-session on purpose — auth/callback is what actually
  // establishes the session (from the recovery email's code), and the page itself
  // redirects to /forgot-password if it's ever hit without one (reset-password/page.tsx).
  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup") ||
    request.nextUrl.pathname.startsWith("/forgot-password") ||
    request.nextUrl.pathname.startsWith("/reset-password") ||
    request.nextUrl.pathname.startsWith("/auth/callback");

  if (!user && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    const redirectResponse = NextResponse.redirect(loginUrl);
    for (const [k, v] of debugHeaders) redirectResponse.headers.set(k, v);
    return redirectResponse;
  }

  return response;
}
