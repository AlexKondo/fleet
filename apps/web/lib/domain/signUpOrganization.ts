import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Single-tenant: every signup joins this one pre-seeded organization
// (0027_single_tenant_seed.sql) instead of creating a new one. This is a stand-in
// registration screen until SSO login is wired up — see ADR-009.
const SINGLE_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

export interface SignUpOrganizationInput {
  fullName: string;
  email: string;
  password: string;
}

export type SignUpOrganizationError =
  | "email_already_registered"
  | "user_creation_failed"
  | "profile_creation_failed";

export interface SignUpOrganizationResult {
  success: boolean;
  error?: SignUpOrganizationError;
}

/**
 * Registers a new user into the single shared organization. Uses the service-role
 * client because, like the old per-tenant bootstrap, there's no session yet for RLS
 * to scope this to.
 */
export async function signUpOrganization(
  input: SignUpOrganizationInput,
): Promise<SignUpOrganizationResult> {
  const admin = createSupabaseAdminClient();

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    const alreadyRegistered = /already.*registl?ered|already exists/i.test(authError?.message ?? "");
    return { success: false, error: alreadyRegistered ? "email_already_registered" : "user_creation_failed" };
  }

  // Every self-registered user is an administrator: there's no SSO/invite flow yet to
  // hand out lesser roles, and the org is a single trusted team until that lands.
  const { error: profileError } = await admin.from("profiles").insert({
    id: authData.user.id,
    organization_id: SINGLE_ORGANIZATION_ID,
    full_name: input.fullName,
    role: "administrator",
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return { success: false, error: "profile_creation_failed" };
  }

  return { success: true };
}
