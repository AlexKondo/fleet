"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ResetPasswordState {
  status: "idle" | "error";
  error?: string;
}

export async function updatePassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { status: "error", error: "A senha precisa ter pelo menos 8 caracteres." };
  }
  if (password !== confirmPassword) {
    return { status: "error", error: "As senhas não coincidem." };
  }

  // Relies on the session auth/callback/route.ts already established from the recovery
  // link's code exchange — updateUser acts on the currently authenticated user, there is
  // no separate "prove you own this account" step here beyond having a valid session.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      status: "error",
      error: "Não foi possível atualizar a senha. O link pode ter expirado — solicite um novo.",
    };
  }

  redirect("/dashboard");
}
