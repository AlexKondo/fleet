import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * profiles has no email column (0001_init_schema.sql) — email lives on auth.users, which
 * only the service-role client can read for anyone other than yourself. Same pattern
 * already used by settings/users/page.tsx: list member ids with the caller's own
 * RLS-scoped client (safe, org-scoped), then resolve emails with the admin client.
 */
export async function getFleetManagerEmails(
  supabase: TypedSupabaseClient,
  organizationId: string,
): Promise<string[]> {
  const { data: managers } = await supabase
    .from("profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .in("role", ["fleet_manager", "administrator"]);
  if (!managers || managers.length === 0) return [];

  const admin = createSupabaseAdminClient();
  const emails = await Promise.all(
    managers.map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.id);
      return data.user?.email ?? null;
    }),
  );
  return emails.filter((e): e is string => Boolean(e));
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}
