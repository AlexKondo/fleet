"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "@/lib/i18n/getLocale";

export interface ChangePasswordState {
  status: "idle" | "error" | "success";
  error?: string;
}

/**
 * Every user (any role) can reach this from AppShell's header, unlike /settings which is
 * manager-only — there was no self-service way for a regular employee to change the
 * temporary password an admin set on `/settings/users` (InviteUserForm.tsx). Same
 * mechanism as reset-password/actions.ts: `updateUser({ password })` acts on the current
 * session, no separate re-auth step.
 */
export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const dict = await getDictionary();
  const supabase = await createSupabaseServerClient();

  const user = await getCurrentUser(supabase);
  if (!user) {
    redirect("/login");
  }

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { status: "error", error: dict.errors.auth.passwordTooShort };
  }
  if (password !== confirmPassword) {
    return { status: "error", error: dict.errors.auth.passwordMismatch };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { status: "error", error: dict.errors.auth.passwordUpdateFailed };
  }

  return { status: "success" };
}
