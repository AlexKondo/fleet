import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * PKCE code exchange for Supabase Auth email links — today only password recovery
 * (forgot-password/actions.ts), but any future magic-link/invite flow would land here
 * too. This has to be a Route Handler, not a Server Component: only a Route Handler or
 * Server Action can actually persist the resulting session cookie on the response
 * (lib/supabase/server.ts's `setAll` silently no-ops when called from a Server Component
 * render, per its own comment) — a Server Component doing the exchange would authenticate
 * the request that renders it and then lose the session on the very next navigation.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("auth/callback: exchangeCodeForSession failed:", error.message);
    return NextResponse.redirect(`${origin}/login?authError=expired_link`);
  }

  return response;
}
