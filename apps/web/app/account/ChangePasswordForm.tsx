"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "../PasswordInput";
import { Button } from "../ui/Button";
import { changePassword, type ChangePasswordState } from "./actions";
import type { Dictionary } from "../../lib/i18n/dictionaries";

const initialState: ChangePasswordState = { status: "idle" };

/** `forced` = this is the mandatory first-login change (middleware.ts redirected here for
 * an admin-created account) rather than a voluntary visit to /account. Only then does a
 * successful save move the user on to the dashboard by itself — someone who came here on
 * their own to change their password stays put, same as before. */
export function ChangePasswordForm({ dict, forced }: { dict: Dictionary; forced: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  useEffect(() => {
    if (forced && state.status === "success") {
      router.push("/dashboard");
    }
  }, [forced, state.status, router]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <PasswordInput
        name="password"
        label={dict.account.newPasswordLabel}
        autoComplete="new-password"
        required
        minLength={8}
        placeholder={dict.auth.newPasswordPlaceholder}
        onValueChange={setPassword}
        dict={dict}
      />
      <PasswordInput
        name="confirmPassword"
        label={dict.account.confirmNewPasswordLabel}
        autoComplete="new-password"
        required
        minLength={8}
        placeholder={dict.auth.confirmNewPasswordPlaceholder}
        onValueChange={setConfirmPassword}
        dict={dict}
      />
      {mismatch ? <p className="-mt-2 text-xs text-signal-red">{dict.signup.passwordMismatch}</p> : null}

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm text-signal-teal">
          {dict.account.success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || mismatch} className="self-start">
        {pending ? dict.common.saving : dict.account.submit}
      </Button>
    </form>
  );
}
