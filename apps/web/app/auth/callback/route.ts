import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Database } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * Handles Supabase Auth email links — password recovery (forgot-password/actions.ts)
 * today, any future magic-link/invite flow too. This has to be a Route Handler, not a
 * Server Component: only a Route Handler or Server Action can actually persist the
 * resulting session cookie on the response (lib/supabase/server.ts's `setAll` silently
 * no-ops when called from a Server Component render, per its own comment) — a Server
 * Component doing the exchange would authenticate the request that renders it and then
 * lose the session on the very next navigation.
 *
 * Two link shapes are handled, not just one:
 * - `?code=...` — PKCE. `exchangeCodeForSession` needs the `code_verifier` that
 *   `resetPasswordForEmail` stashed in a cookie in the SAME browser that requested the
 *   reset. That holds when someone clicks the email link back in the browser tab they
 *   requested it from, but breaks the moment they open the email in a different browser,
 *   a different device, or their mail app's own in-app browser — extremely common for a
 *   "forgot my password" flow specifically, since the whole point is the person may not
 *   be at the original browser anymore. That failure was silent here: exchange errors
 *   redirected to /login?authError=expired_link with no visible distinction from an
 *   actually-expired link, which is what a user reporting "the reset link sends me to
 *   login instead of the new-password screen" was actually hitting.
 * - `?token_hash=...&type=...` — OTP-style. `verifyOtp` validates the token itself and
 *   needs nothing pre-stored client-side, so it works from any browser/device. Supabase's
 *   own Next.js SSR guidance recommends handling both shapes in one callback route rather
 *   than assuming a single flow type, since which one actually reaches this route depends
 *   on the project's email-template configuration (Auth → Email Templates), not on
 *   anything this codebase controls.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code && !tokenHash) {
    return NextResponse.redirect(`${origin}/login?authError=missing_code`);
  }

  const { url, anonKey } = getSupabasePublicEnv();
  let response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.redirect(`${origin}${next}`);
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    : await supabase.auth.exchangeCodeForSession(code!);

  if (error) {
    console.error("auth/callback: session exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login?authError=expired_link`);
  }

  return response;
}
