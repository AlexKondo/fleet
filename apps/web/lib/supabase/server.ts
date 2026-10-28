import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database, TypedSupabaseClient } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "./env";
import { getActingContext } from "@/lib/auth/actingUser";

/**
 * Server-side Supabase client for use in Server Components / Route Handlers. Reads the
 * session from cookies so RLS policies (supabase/migrations/0001_init_schema.sql) apply
 * as the signed-in user, never with elevated privileges.
 */
export async function createSupabaseServerClient(): Promise<TypedSupabaseClient> {
  // WhatsApp channel: inside runAsUser() the client already carries the identified member's own token (lib/auth/actingUser.ts)
  const acting = getActingContext();
  if (acting) return acting.client;
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component without a mutable response — safe to ignore
          // when session refresh is handled by middleware.
        }
      },
    },
  });
}
