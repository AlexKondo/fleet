"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SignInState {
  error: string | null;
}

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "E-mail ou senha incorretos." };
  }

  redirect("/dashboard");
}
