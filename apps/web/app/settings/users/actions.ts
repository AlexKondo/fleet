"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface UserActionState {
  status: "idle" | "success" | "error";
  error?: string;
}

const ROLES = ["employee", "fleet_manager", "security", "maintenance_operator", "administrator"] as const;
type Role = (typeof ROLES)[number];

/**
 * Team management (invite/role-change/remove) is restricted to 'administrator', one
 * notch narrower than the 'fleet_manager or administrator' gate used everywhere else in
 * this app (fleet/settings pages). Reason: this surface can grant a login
 * 'administrator' itself — letting a fleet_manager hand out admin rights would be a
 * privilege-escalation hole, so only an existing administrator can manage the roster.
 */
async function requireAdministrator() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { organizationId: null, actingUserId: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  const isAdministrator = profile?.role === "administrator";
  return {
    organizationId: isAdministrator ? (profile?.organization_id ?? null) : null,
    actingUserId: user.id,
  };
}


export async function inviteUser(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!fullName || !email || password.length < 8) {
    return { status: "error", error: "Preencha nome, e-mail e uma senha com pelo menos 8 caracteres." };
  }
  if (!ROLES.includes(role as Role)) {
    return { status: "error", error: "Selecione uma função válida." };
  }

  const admin = createSupabaseAdminClient();

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    const alreadyRegistered = /already.*registl?ered|already exists/i.test(authError?.message ?? "");
    return {
      status: "error",
      error: alreadyRegistered
        ? "Este e-mail já está cadastrado."
        : "Não foi possível criar o usuário agora. Tente novamente em instantes.",
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: authData.user.id,
    organization_id: organizationId,
    full_name: fullName,
    role: role as Role,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return { status: "error", error: "Não foi possível concluir o cadastro do usuário. Tente novamente." };
  }

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "user_invited",
    p_entity_type: "profile",
    p_entity_id: authData.user.id,
    p_after: { role },
  });

  revalidatePath("/settings/users");
  return { status: "success" };
}

export async function updateUserRole(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !ROLES.includes(role as Role)) {
    return { status: "error", error: "Seleção inválida." };
  }

  const admin = createSupabaseAdminClient();

  // update_member_role (0013_atomic_last_administrator_guard.sql) does the cross-tenant
  // check, the last-administrator guard, and the actual UPDATE in one transaction. A
  // plain select-then-update here (as this used to be) is two independent PostgREST
  // round-trips with no lock between them — two administrators demoting each other at
  // the same instant could both pass the count check before either write lands, leaving
  // the organization with zero administrators. Folding it into one RPC closes that race.
  const { error } = await admin.rpc("update_member_role", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_new_role: role as Role,
  });
  if (error) {
    const message = error.message.includes("would be left with none")
      ? "Não é possível remover o último administrador da organização."
      : error.message.includes("User not found")
        ? "Usuário não encontrado."
        : error.message;
    return { status: "error", error: message };
  }

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "user_role_changed",
    p_entity_type: "profile",
    p_entity_id: userId,
    p_after: { role },
  });

  revalidatePath("/settings/users");
  return { status: "success" };
}

/**
 * BR-004/GT-011: driver authorization + CNH validity, enforced server-side at checkout by
 * record_pickup (0014_driver_authorization.sql) — this is the admin surface that sets the
 * data that guard reads. Uses the admin client because profiles has no client-side UPDATE
 * RLS policy at all (see updateUserRole's comment on why role changes go through an RPC
 * instead) — manually re-scoped to the acting fleet_manager/administrator's own
 * organization since the admin client bypasses RLS entirely.
 */
export async function updateDriverAuthorization(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: "Usuário inválido." };

  const driverAuthorized = formData.get("driverAuthorized") === "on";
  const licenseNumber = String(formData.get("licenseNumber") ?? "").trim() || null;
  const licenseCategory = String(formData.get("licenseCategory") ?? "").trim() || null;
  const licenseExpirationRaw = String(formData.get("licenseExpiration") ?? "").trim();
  const licenseExpiration = licenseExpirationRaw || null;

  const admin = createSupabaseAdminClient();

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();
  if (!targetProfile || targetProfile.organization_id !== organizationId) {
    return { status: "error", error: "Usuário não encontrado." };
  }

  const { error } = await admin
    .from("profiles")
    .update({
      driver_authorized: driverAuthorized,
      drivers_license_number: licenseNumber,
      drivers_license_category: licenseCategory,
      drivers_license_expiration: licenseExpiration,
    })
    .eq("id", userId);
  if (error) return { status: "error", error: "Não foi possível salvar a habilitação agora." };

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "driver_authorization_changed",
    p_entity_type: "profile",
    p_entity_id: userId,
    p_after: {
      driver_authorized: driverAuthorized,
      drivers_license_expiration: licenseExpiration,
    },
  });

  revalidatePath("/settings/users");
  return { status: "success" };
}

export async function removeUser(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: "Usuário inválido." };
  if (userId === actingUserId) {
    return { status: "error", error: "Você não pode remover sua própria conta por aqui." };
  }

  const admin = createSupabaseAdminClient();

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("organization_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!targetProfile || targetProfile.organization_id !== organizationId) {
    return { status: "error", error: "Usuário não encontrado." };
  }

  // lock_and_require_multiple_administrators (0013_atomic_last_administrator_guard.sql)
  // narrows, but cannot fully close, the same last-administrator race updateUserRole has
  // — it takes a row lock and raises inside one transaction, so a concurrent call has to
  // wait for this one to commit before it can even count. But the actual removal below
  // (auth.admin.deleteUser) is a GoTrue Admin API call, not SQL, so it runs in a separate
  // transaction *after* this guard's lock is already released. Two administrators
  // removing each other at the exact same instant could still both pass this guard
  // before either deleteUser call completes. A fully atomic fix would need the org's
  // membership to support deactivation without deleting the auth.users row at all —
  // out of scope here; this is a known, documented residual risk, not a claimed fix.
  if (targetProfile.role === "administrator") {
    const { error: guardError } = await admin.rpc("lock_and_require_multiple_administrators", {
      p_organization_id: organizationId,
    });
    if (guardError) {
      return {
        status: "error",
        error: "Não é possível remover o último administrador da organização.",
      };
    }
  }

  // profiles.id references auth.users(id) on delete cascade (0001_init_schema.sql), so
  // deleting the auth user is enough — but trip_requests.requester_id references
  // profiles(id) with no cascade, by design (losing a trip's requester would corrupt
  // its own operational history). A user who has ever requested a trip therefore can't
  // be hard-deleted; changing their role (e.g. back to 'employee') is the way to revoke
  // their access without destroying that history.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // The most common cause here is trip_requests.requester_id blocking the cascade
    // (see comment above) — GoTrue's admin API doesn't reliably surface the underlying
    // Postgres error text, so this message names both the likely cause and the fix
    // instead of guessing from the raw error string.
    return {
      status: "error",
      error:
        "Não foi possível remover este usuário. Se ele já solicitou viagens no sistema, " +
        "altere a função dele para revogar o acesso em vez de excluir.",
    };
  }

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "user_removed",
    p_entity_type: "profile",
    p_entity_id: userId,
    p_before: { role: targetProfile.role },
  });

  revalidatePath("/settings/users");
  return { status: "success" };
}
