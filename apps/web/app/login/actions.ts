"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingEnvVarError } from "@/lib/supabase/env";

export interface SignInState {
  error: string | null;
}

const MISSING_ENV_VAR_MESSAGE =
  "O servidor está com uma configuração incompleta e não pode autenticar ninguém agora " +
  "(variável de ambiente ausente). Avise o administrador do sistema — tentar de novo não " +
  "vai resolver.";

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // createSupabaseServerClient() throws MissingEnvVarError (not a typed {error} result)
  // when its own env vars are absent — a config problem no end user caused and can't fix
  // by retrying, but it must never surface as Next.js's generic crash page. Same failure
  // mode as signUpOrganization's admin client; see signup/actions.ts.
  let error: { message: string } | null;
  try {
    const supabase = await createSupabaseServerClient();
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  } catch (err) {
    console.error("signIn: unexpected error", err);
    return { error: isMissingEnvVarError(err) ? MISSING_ENV_VAR_MESSAGE : "Não foi possível entrar agora. Tente novamente em instantes." };
  }

  if (error) {
    return { error: "E-mail ou senha incorretos." };
  }

  redirect("/dashboard");
}
