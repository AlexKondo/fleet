"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDictionary } from "@/lib/i18n/getLocale";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppUrl } from "@/lib/getAppUrl";
import { buildDriverUpdate, decideExpirationSource, isLicenseLockedError } from "./driverUpdate";

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
  const user = await getCurrentUser(supabase);
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

  const dict = await getDictionary();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!fullName || !email || password.length < 8) {
    return { status: "error", error: dict.errors.users.inviteRequiredFields };
  }
  if (!ROLES.includes(role as Role)) {
    return { status: "error", error: dict.errors.users.roleInvalid };
  }

  const admin = createSupabaseAdminClient();

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The admin picks this temporary password, not the member — force them to set their
    // own on first login. Lives in app_metadata (not profiles) so middleware can read it
    // straight off the already-fetched auth user with zero extra DB round trip.
    app_metadata: { must_change_password: true },
  });
  if (authError || !authData.user) {
    const alreadyRegistered = /already.*registl?ered|already exists/i.test(authError?.message ?? "");
    return {
      status: "error",
      error: alreadyRegistered
        ? dict.errors.users.emailAlreadyRegistered
        : dict.errors.users.userCreateFailed,
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: authData.user.id,
    organization_id: organizationId,
    full_name: fullName,
    role: role as Role,
  });
  if (profileError) {
    // Preserve failed provisioning identities too; do not delete an account.
    await admin.auth.admin.updateUserById(authData.user.id, { ban_duration: "876000h", app_metadata: { provisioning_failed: true, must_change_password: true } });
    return { status: "error", error: dict.errors.users.profileCreateFailed };
  }

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "user_invited",
    p_entity_type: "profile",
    p_entity_id: authData.user.id,
    p_after: { role },
  });

  // The account is created with a temporary password the admin chose (not the member) and
  // no way for the member to know it otherwise — createUser({email_confirm:true}) creates
  // the user silently, it does not send Supabase's own invite email. Best-effort: a failed
  // send here must not undo the account that already exists (the admin can always relay
  // the password out of band), so this never affects the action's own success result.
  const { html, text } = renderEmail({
    heading: "Você foi adicionado ao Fleet",
    bodyLines: [
      `Olá, ${fullName}.`,
      `Uma conta foi criada para você no Fleet, o sistema de gestão de frota da sua empresa.`,
      `<strong>Login:</strong> ${email}<br><strong>Senha temporária:</strong> ${password}`,
      `Por segurança, você vai precisar definir uma nova senha no primeiro acesso.`,
    ],
    ctaLabel: "Acessar o Fleet",
    ctaUrl: `${getAppUrl()}/login`,
  });
  const emailResult = await sendEmail({
    to: email,
    subject: "Você foi adicionado ao Fleet",
    html,
    text,
  });
  if (!emailResult.success) {
    console.error("inviteUser: welcome email failed to send:", emailResult.error);
  }

  revalidatePath("/settings/users");
  return { status: "success" };
}

export async function updateUserRole(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || !ROLES.includes(role as Role)) {
    return { status: "error", error: dict.errors.users.selectionInvalid };
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
      ? dict.errors.users.lastAdministrator
      : error.message.includes("User not found")
        ? dict.errors.users.userNotFound
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

/** "Local de trabalho" of a member (a corporate mobility point of the same organization, or none): the default origin of their trips. */
export async function updateWorkLocation(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const userId = String(formData.get("userId") ?? "");
  const raw = String(formData.get("workLocationId") ?? "");
  if (!userId) return { status: "error", error: dict.errors.users.userInvalid };
  const admin = createSupabaseAdminClient();

  const { data: target } = await admin.from("profiles").select("organization_id").eq("id", userId).maybeSingle();
  if (!target || target.organization_id !== organizationId) return { status: "error", error: dict.errors.users.userNotFound };

  let workLocationId: string | null = null;
  if (raw) {
    const { data: point } = await admin.from("corporate_mobility_points").select("id").eq("id", raw).eq("organization_id", organizationId).eq("is_active", true).maybeSingle();
    if (!point) return { status: "error", error: dict.errors.users.driverAuthorizationSaveFailed };
    workLocationId = point.id;
  }
  const { error } = await admin.from("profiles").update({ work_location_id: workLocationId }).eq("id", userId);
  if (error) return { status: "error", error: dict.errors.users.driverAuthorizationSaveFailed };

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "work_location_changed",
    p_entity_type: "profile",
    p_entity_id: userId,
    p_after: { work_location_id: workLocationId },
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

  const dict = await getDictionary();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: dict.errors.users.userInvalid };

  // M3: each form carries only the fields it edits; a field that is absent is never written (see driverUpdate.ts).
  const built = buildDriverUpdate(formData);
  if (!built.ok) return { status: "error", error: dict.errors.users.driverAuthorizationSaveFailed };

  const admin = createSupabaseAdminClient();

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("organization_id, drivers_license_expiration, drivers_license_expiration_source")
    .eq("id", userId)
    .maybeSingle();
  if (!targetProfile || targetProfile.organization_id !== organizationId) {
    return { status: "error", error: dict.errors.users.userNotFound };
  }

  // Anti-fraud (migration 0075): a CNH read by AI is locked. Refuse any license edit BEFORE writing (the DB trigger is the backstop).
  if (built.update && ("drivers_license_number" in built.update || "drivers_license_category" in built.update || "drivers_license_expiration" in built.update) && targetProfile.drivers_license_expiration_source === "ai") {
    return { status: "error", error: dict.errors.users.licenseLockedByAi };
  }

  // The expiration source is only written when the expiration itself changes (manual edit / cleared); an unrelated save never
  // rewrites it (decideExpirationSource returns undefined = leave the stored value alone).
  const update = { ...built.update };
  if ("drivers_license_expiration" in update) {
    const source = decideExpirationSource(targetProfile.drivers_license_expiration, update.drivers_license_expiration ?? null);
    if (source !== undefined) update.drivers_license_expiration_source = source;
  }

  const { error } = await admin
    .from("profiles")
    .update(update)
    .eq("id", userId);
  if (error) {
    return { status: "error", error: isLicenseLockedError(error) ? dict.errors.users.licenseLockedByAi : dict.errors.users.driverAuthorizationSaveFailed };
  }

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "driver_authorization_changed",
    p_entity_type: "profile",
    p_entity_id: userId,
    // Never log the license number itself (personal data); log only what the submission changed.
    p_after: {
      ...("driver_authorized" in built.update ? { driver_authorized: built.update.driver_authorized } : {}),
      ...("drivers_license_expiration" in built.update
        ? { drivers_license_expiration: built.update.drivers_license_expiration }
        : {}),
    },
  });

  revalidatePath("/settings/users");
  return { status: "success" };
}

/**
 * Administrator-only reset of an AI-locked CNH (migration 0075 reset_ai_license, service_role only): clears number / category /
 * expiration / source and un-authorizes the member, who is sent to /account/license by the CNH gate on the next navigation and must
 * send a new photo. Audited (who reset whose CNH, when); no CNH values are logged.
 */
export async function resetMemberLicense(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { organizationId, actingUserId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };

  const dict = await getDictionary();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: dict.errors.users.userInvalid };

  // An administrator can NOT reset their own AI-locked CNH (anti-fraud: someone else must do it), and every reset needs a short reason.
  if (userId === actingUserId) return { status: "error", error: dict.errors.users.licenseResetSelf };
  const reason = String(formData.get("reason") ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < 5 || reason.length > 200) return { status: "error", error: dict.errors.users.licenseResetReasonInvalid };

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("organization_id, drivers_license_expiration_source")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.organization_id !== organizationId) {
    return { status: "error", error: dict.errors.users.userNotFound };
  }
  // only a locked (AI-read) record needs a reset; everything else is directly editable
  if (target.drivers_license_expiration_source !== "ai") {
    return { status: "error", error: dict.errors.users.licenseResetFailed };
  }

  const { error } = await admin.rpc("reset_ai_license", { p_user_id: userId });
  if (error) return { status: "error", error: dict.errors.users.licenseResetFailed };

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "driver_license_reset",
    p_entity_type: "profile",
    p_entity_id: userId,
    p_after: { reset: true, driver_authorized: false, reason },
  });

  revalidatePath("/settings/users");
  return { status: "success" };
}

/** Compatibility entry point: removing access now deactivates, never deletes. */
export async function removeUser(previous: UserActionState, form: FormData): Promise<UserActionState> {
  return changeMemberAccess(previous, form, false);
}
export async function reactivateUser(previous: UserActionState, form: FormData): Promise<UserActionState> {
  return changeMemberAccess(previous, form, true);
}
async function changeMemberAccess(
  _previous: UserActionState, form: FormData, enabled: boolean,
): Promise<UserActionState> {
  const { organizationId } = await requireAdministrator();
  if (!organizationId) return { status: "error", error: "not_authorized" };
  const db = await createSupabaseServerClient();
  const version = String(form.get("accessVersion") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const userId = String(form.get("userId") ?? "");
  const requestId = String(form.get("requestId") ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(userId) || !uuid.test(requestId) || !/^\d+$/.test(version) || !Number.isSafeInteger(Number(version)) || reason.length < 3 || reason.length > 1000)
    return { status: "error", error: "Confira o usuário, a versão e a justificativa." };
  const { error } = await db.rpc("fm_member_access_command", {
    p_user_id: userId, p_enabled: enabled, p_version: Number(version), p_reason: reason, p_request_id: requestId,
  });
  if (error) {
    const code = ["NOT_AUTHORIZED", "NOT_FOUND", "CANNOT_DEACTIVATE_SELF", "CONCURRENT_UPDATE", "LAST_ACTIVE_ADMINISTRATOR", "IDEMPOTENCY_CONFLICT"].find(c=>error.message.includes(c));
    const messages: Record<string,string> = {
      NOT_AUTHORIZED: "Seu perfil não pode alterar este acesso.",
      NOT_FOUND: "Usuário não encontrado na sua organização.",
      CANNOT_DEACTIVATE_SELF: "Você não pode desativar o próprio acesso.",
      CONCURRENT_UPDATE: "O acesso foi alterado. Recarregue a página antes de tentar novamente.",
      LAST_ACTIVE_ADMINISTRATOR: "É necessário manter ao menos um administrador ativo.",
      IDEMPOTENCY_CONFLICT: "Recarregue a página para iniciar uma nova solicitação.",
    };
    return { status: "error", error: code ? messages[code] : "Não foi possível alterar o acesso. Nenhuma conta foi excluída." };
  }
  revalidatePath("/settings/users");
  revalidatePath("/admin");
  return { status: "success" };
}
