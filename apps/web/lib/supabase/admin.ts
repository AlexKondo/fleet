import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@fleet/supabase-client";
import { MissingEnvVarError } from "./env";

/**
 * Service-role Supabase client — bypasses RLS entirely. Used only for auth.users
 * lifecycle operations that a normal RLS-respecting client cannot perform at all
 * (creating/deleting a login, reading another member's email): organization signup
 * (lib/domain/signUpOrganization.ts), which has no tenant context yet to scope to since
 * no organization row exists until that flow creates one; team member management
 * (app/settings/users/actions.ts), which manages *other* users' auth.users rows; and
 * resolving recipient email addresses for outbound notification email
 * (lib/email/recipients.ts) — profiles has no email column, so reading anyone's email but
 * your own requires this client no matter what the caller's own role is. Because it
 * bypasses RLS, every caller MUST resolve the acting
 * user's own organization_id and role from a normal RLS-respecting client first and
 * scope every query by that value explicitly — never trust a client-supplied
 * organization_id or user id without checking it belongs to the caller's own tenant.
 * Never import this into a client component; the `server-only` import above makes that
 * a build error if it happens by mistake.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter((v): v is string => Boolean(v));
    throw new MissingEnvVarError(missing);
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
