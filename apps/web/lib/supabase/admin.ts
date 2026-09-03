import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@fleet/supabase-client";

/**
 * Service-role Supabase client — bypasses RLS entirely. Used ONLY for organization
 * signup (lib/domain/signUpOrganization.ts), the one operation that legitimately has no
 * tenant context yet to scope a normal RLS-respecting client to (there is no
 * organization row for the new user to belong to until this flow creates one). Never
 * import this into a client component; the `server-only` import above makes that a
 * build error if it happens by mistake.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing required env var(s) for the admin client: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
