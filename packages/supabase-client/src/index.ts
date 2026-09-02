import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type { Database } from "./database.types";
export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Plain (non-SSR) typed client. Safe for use with a public URL + anon key on the
 * browser — RLS (supabase/migrations/0001_init_schema.sql) is what actually enforces
 * tenant isolation, not this client.
 */
export function createSupabaseClient(url: string, anonKey: string): TypedSupabaseClient {
  return createClient<Database>(url, anonKey);
}
