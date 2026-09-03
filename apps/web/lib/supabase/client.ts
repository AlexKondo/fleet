"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database, TypedSupabaseClient } from "@fleet/supabase-client";
import { getSupabasePublicEnv } from "./env";

/**
 * Browser-side Supabase client for use in Client Components. Mirrors server.ts's
 * pattern but reads/writes the session via document cookies instead of Next's
 * `cookies()`; RLS (supabase/migrations/0001_init_schema.sql) is what actually enforces
 * tenant isolation, same as the server client.
 */
export function createSupabaseBrowserClient(): TypedSupabaseClient {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
