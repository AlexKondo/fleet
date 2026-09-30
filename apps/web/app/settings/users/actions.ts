"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDictionary } from "@/lib/i18n/getLocale";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppUrl } from "@/lib/getAppUrl";

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
    await admin.auth.admin.deleteUser(authData.user.id);
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
    return { status: "error", error: dict.errors.users.userNotFound };
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
  if (error) return { status: "error", error: dict.errors.users.driverAuthorizationSaveFailed };

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

  const dict = await getDictionary();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { status: "error", error: dict.errors.users.userInvalid };
  if (userId === actingUserId) {
    return { status: "error", error: dict.errors.users.cannotRemoveSelf };
  }

  const admin = createSupabaseAdminClient();

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("organization_id, role, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (!targetProfile || targetProfile.organization_id !== organizationId) {
    return { status: "error", error: dict.errors.users.userNotFound };
  }

  // Fetched before the delete below removes the auth.users row (and the email address
  // along with it) — needed only for the notification email, so no point holding it if
  // that lookup itself fails.
  const { data: targetAuthUser } = await admin.auth.admin.getUserById(userId);
  const targetEmail = targetAuthUser?.user?.email ?? null;

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
      return { status: "error", error: dict.errors.users.lastAdministrator };
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
    return { status: "error", error: dict.errors.users.removeUserFailed };
  }

  await admin.rpc("log_audit_event", {
    p_organization_id: organizationId,
    p_actor_id: actingUserId as string,
    p_action: "user_removed",
    p_entity_type: "profile",
    p_entity_id: userId,
    p_before: { role: targetProfile.role },
  });

  // Best-effort, same reasoning as inviteUser's welcome email: the removal itself already
  // happened and must stand regardless of whether this notification goes out.
  if (targetEmail) {
    const { data: actingProfile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", actingUserId as string)
      .maybeSingle();
    const actorName = actingProfile?.full_name ?? "um administrador do Fleet";

    const { html, text } = renderEmail({
      heading: "Seu acesso ao Fleet foi removido",
      bodyLines: [
        `Olá, ${targetProfile.full_name ?? ""}.`,
        `Seu acesso ao Fleet foi removido por <strong>${actorName}</strong>.`,
        `Se isso não era esperado, entre em contato com o gestor de frota ou administrador da sua empresa.`,
      ],
    });
    const emailResult = await sendEmail({
      to: targetEmail,
      subject: "Seu acesso ao Fleet foi removido",
      html,
      text,
    });
    if (!emailResult.success) {
      console.error("removeUser: removal notice email failed to send:", emailResult.error);
    }
  }

  revalidatePath("/settings/users");
  return { status: "success" };
}
