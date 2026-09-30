"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingEnvVarError } from "@/lib/supabase/env";
import { getDictionary } from "@/lib/i18n/getLocale";

export interface SignInState {
  error: string | null;
}

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const dict = await getDictionary();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // createSupabaseServerClient() throws MissingEnvVarError (not a typed {error} result)
  // when its own env vars are absent — a config problem no end user caused and can't fix
  // by retrying, but it must never surface as Next.js's generic crash page. Same shape as
  // signup/actions.ts's second try block (its post-signup sign-in), which wraps this same
  // client-construction-plus-signInWithPassword pair for the same reason. Both calls stay
  // inside one try (not narrowed to just client construction) since an unexpected throw
  // from signInWithPassword itself must be caught the same way.
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: dict.errors.auth.invalidCredentials };
    }
  } catch (err) {
    console.error("signIn: unexpected error", err);
    return {
      error: isMissingEnvVarError(err)
        ? dict.errors.auth.missingEnvVarSignIn
        : dict.errors.auth.signInFailed,
    };
  }

  // "/" does the role-based routing (fleet ops -> dashboard, plain employee -> trips) —
  // see page.tsx.
  redirect("/");
}
