import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface SignUpOrganizationInput {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
}

export type SignUpOrganizationError =
  | "email_already_registered"
  | "org_creation_failed"
  | "settings_creation_failed"
  | "location_creation_failed"
  | "user_creation_failed"
  | "profile_creation_failed";

export interface SignUpOrganizationResult {
  success: boolean;
  error?: SignUpOrganizationError;
}

/**
 * Bootstraps a brand-new tenant: there is no organization for a first-time signup to
 * belong to yet, so this is the one place in the app that legitimately needs the
 * service-role client (RLS has nothing to scope this to). The new user becomes
 * 'administrator' of their own organization — the first member of a fresh tenant always
 * needs full rights to invite/manage the rest of their team.
 *
 * Each step can fail independently (separate REST/Admin API calls, not one DB
 * transaction), so failures roll back what was already created rather than leaving an
 * orphaned organization or auth user behind.
 */
export async function signUpOrganization(
  input: SignUpOrganizationInput,
): Promise<SignUpOrganizationResult> {
  const admin = createSupabaseAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: input.organizationName })
    .select("id")
    .single();
  if (orgError || !org) {
    return { success: false, error: "org_creation_failed" };
  }

  const { error: settingsError } = await admin
    .from("organization_settings")
    .insert({ organization_id: org.id });
  if (settingsError) {
    await admin.from("organizations").delete().eq("id", org.id);
    return { success: false, error: "settings_creation_failed" };
  }

  // §14 Current Vehicle Location: the return checklist requires picking a
  // vehicle_locations row, and nothing in the app lets anyone create one yet — a
  // brand-new organization with zero locations could never complete a single vehicle
  // return. Every organization starts with one, renameable later.
  const { error: locationError } = await admin
    .from("vehicle_locations")
    .insert({ organization_id: org.id, name: "Sede" });
  if (locationError) {
    await admin.from("organizations").delete().eq("id", org.id);
    return { success: false, error: "location_creation_failed" };
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    // organization_settings cascades on organizations delete (0001_init_schema.sql).
    await admin.from("organizations").delete().eq("id", org.id);
    const alreadyRegistered = /already.*registl?ered|already exists/i.test(authError?.message ?? "");
    return { success: false, error: alreadyRegistered ? "email_already_registered" : "user_creation_failed" };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: authData.user.id,
    organization_id: org.id,
    full_name: input.fullName,
    role: "administrator",
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("organizations").delete().eq("id", org.id);
    return { success: false, error: "profile_creation_failed" };
  }

  return { success: true };
}
