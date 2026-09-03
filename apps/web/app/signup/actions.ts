"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MissingEnvVarError } from "@/lib/supabase/env";
import { signUpOrganization, type SignUpOrganizationError } from "@/lib/domain/signUpOrganization";

export interface SignUpState {
  error: string | null;
}

const ERROR_MESSAGES: Record<
  SignUpOrganizationError | "invalid_input" | "password_mismatch" | "signin_after_signup_failed",
  string
> = {
  email_already_registered: "Este e-mail já está cadastrado. Tente entrar em vez de criar uma nova conta.",
  org_creation_failed: "Não foi possível criar a organização agora. Tente novamente em instantes.",
  settings_creation_failed: "Não foi possível concluir a configuração da organização. Tente novamente.",
  location_creation_failed: "Não foi possível concluir a configuração da organização. Tente novamente.",
  user_creation_failed: "Não foi possível criar sua conta agora. Tente novamente em instantes.",
  profile_creation_failed: "Não foi possível concluir seu cadastro. Tente novamente.",
  invalid_input: "Preencha todos os campos — a senha precisa ter pelo menos 8 caracteres.",
  password_mismatch: "As senhas não coincidem.",
  signin_after_signup_failed: "Conta criada, mas não foi possível entrar automaticamente. Faça login normalmente.",
};

export async function signUp(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!organizationName || !fullName || !email || password.length < 8) {
    return { error: ERROR_MESSAGES.invalid_input };
  }
  if (password !== confirmPassword) {
    return { error: ERROR_MESSAGES.password_mismatch };
  }

  // signUpOrganization uses the service-role admin client, which throws (rather than
  // returning a typed error) when its own env vars are misconfigured — a config problem
  // no end user caused and can't fix by retrying, but it must never surface as Next.js's
  // generic "a server-side exception has occurred" crash page.
  try {
    const result = await signUpOrganization({ organizationName, fullName, email, password });
    if (!result.success) {
      return { error: ERROR_MESSAGES[result.error ?? "user_creation_failed"] };
    }
  } catch (err) {
    console.error("signUp: unexpected error creating account", err);
    if (err instanceof MissingEnvVarError) {
      return {
        error:
          "O servidor está com uma configuração incompleta e não pode criar contas agora " +
          "(variável de ambiente ausente). Avise o administrador do sistema — tentar de " +
          "novo não vai resolver.",
      };
    }
    return { error: "Não foi possível criar sua conta agora. Tente novamente em instantes." };
  }

  // The org/user/profile are already committed at this point, so any failure below —
  // typed error or thrown exception alike — must never be reported as "couldn't create
  // your account" (the account exists; retrying signup would just hit
  // email_already_registered). redirect() (below, outside this try block on purpose —
  // it works by throwing internally) must never be caught here, which is why it isn't
  // called until after the try/catch resolves.
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    signedIn = !signInError;
  } catch (err) {
    console.error("signUp: unexpected error signing in after account creation", err);
  }

  if (!signedIn) {
    return { error: ERROR_MESSAGES.signin_after_signup_failed };
  }
  redirect("/dashboard");
}
