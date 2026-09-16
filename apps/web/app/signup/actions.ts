"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingEnvVarError } from "@/lib/supabase/env";
import { signUpOrganization, type SignUpOrganizationError } from "@/lib/domain/signUpOrganization";
import { getDictionary } from "@/lib/i18n/getLocale";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface SignUpState {
  error: string | null;
}

/**
 * The keys stay internal error CODES (returned by signUpOrganization / decided here); only
 * the user-facing message values are localized, so this is now a function of the active
 * locale's dictionary rather than a module-level constant map.
 */
const errorMessages = (
  dict: Dictionary,
): Record<
  SignUpOrganizationError | "invalid_input" | "password_mismatch" | "signin_after_signup_failed",
  string
> => ({
  email_already_registered: dict.errors.auth.emailAlreadyRegistered,
  user_creation_failed: dict.errors.auth.userCreationFailed,
  profile_creation_failed: dict.errors.auth.profileCreationFailed,
  invalid_input: dict.errors.auth.invalidInput,
  password_mismatch: dict.errors.auth.passwordMismatch,
  signin_after_signup_failed: dict.errors.auth.signinAfterSignupFailed,
});

export async function signUp(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const dict = await getDictionary();
  const messages = errorMessages(dict);
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!fullName || !email || password.length < 8) {
    return { error: messages.invalid_input };
  }
  if (password !== confirmPassword) {
    return { error: messages.password_mismatch };
  }

  // signUpOrganization uses the service-role admin client, which throws (rather than
  // returning a typed error) when its own env vars are misconfigured — a config problem
  // no end user caused and can't fix by retrying, but it must never surface as Next.js's
  // generic "a server-side exception has occurred" crash page.
  try {
    const result = await signUpOrganization({ fullName, email, password });
    if (!result.success) {
      return { error: messages[result.error ?? "user_creation_failed"] };
    }
  } catch (err) {
    console.error("signUp: unexpected error creating account", err);
    if (isMissingEnvVarError(err)) {
      return { error: dict.errors.auth.missingEnvVarSignUp };
    }
    return { error: dict.errors.auth.signUpFailed };
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
    // Distinct from messages.signin_after_signup_failed below: that message tells
    // the user to "just log in normally," which is correct advice for a one-off sign-in
    // hiccup but actively wrong here — if the env var is genuinely missing, login will
    // fail identically every time, and sending the user to retry a broken action forever
    // hides the fact that only an administrator can fix this.
    if (isMissingEnvVarError(err)) {
      return { error: dict.errors.auth.missingEnvVarSigninAfterSignup };
    }
  }

  if (!signedIn) {
    return { error: messages.signin_after_signup_failed };
  }
  redirect("/dashboard");
}
