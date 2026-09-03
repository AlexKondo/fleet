"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signUpOrganization, type SignUpOrganizationError } from "@/lib/domain/signUpOrganization";

export interface SignUpState {
  error: string | null;
}

const ERROR_MESSAGES: Record<SignUpOrganizationError | "invalid_input" | "signin_after_signup_failed", string> = {
  email_already_registered: "Este e-mail já está cadastrado. Tente entrar em vez de criar uma nova conta.",
  org_creation_failed: "Não foi possível criar a organização agora. Tente novamente em instantes.",
  settings_creation_failed: "Não foi possível concluir a configuração da organização. Tente novamente.",
  location_creation_failed: "Não foi possível concluir a configuração da organização. Tente novamente.",
  user_creation_failed: "Não foi possível criar sua conta agora. Tente novamente em instantes.",
  profile_creation_failed: "Não foi possível concluir seu cadastro. Tente novamente.",
  invalid_input: "Preencha todos os campos — a senha precisa ter pelo menos 8 caracteres.",
  signin_after_signup_failed: "Conta criada, mas não foi possível entrar automaticamente. Faça login normalmente.",
};

export async function signUp(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!organizationName || !fullName || !email || password.length < 8) {
    return { error: ERROR_MESSAGES.invalid_input };
  }

  const result = await signUpOrganization({ organizationName, fullName, email, password });
  if (!result.success) {
    return { error: ERROR_MESSAGES[result.error ?? "user_creation_failed"] };
  }

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return { error: ERROR_MESSAGES.signin_after_signup_failed };
  }

  redirect("/dashboard");
}
