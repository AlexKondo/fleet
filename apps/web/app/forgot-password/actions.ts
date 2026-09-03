"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/getAppUrl";

export interface ForgotPasswordState {
  status: "idle" | "success" | "error";
  error?: string;
}

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { status: "error", error: "Informe seu e-mail." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password`,
  });

  // Always report success, even when the RPC itself errors (e.g. no account with this
  // email) — never let this endpoint confirm or deny whether an email is registered
  // (user enumeration). The email itself only actually goes out on a real match; Supabase
  // Auth's own resetPasswordForEmail already behaves this way internally, this just makes
  // sure a network/config error doesn't leak the difference either.
  if (error) {
    console.error("requestPasswordReset: resetPasswordForEmail failed:", error.message);
  }
  return { status: "success" };
}
