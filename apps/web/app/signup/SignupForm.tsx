"use client";

import { useActionState, useState } from "react";
import { PasswordInput } from "../PasswordInput";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { signUp, type SignUpState } from "./actions";
import type { Dictionary } from "../../lib/i18n/dictionaries";

const initialState: SignUpState = { error: null };

export function SignupForm({ dict }: { dict: Dictionary }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Field label={dict.signup.fullNameLabel} htmlFor="fullName">
        <Input id="fullName" type="text" name="fullName" required placeholder={dict.signup.fullNamePlaceholder} />
      </Field>

      <Field label={dict.signup.emailLabel} htmlFor="email">
        <Input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder={dict.signup.emailPlaceholder}
          className="font-mono"
        />
      </Field>

      <PasswordInput
        name="password"
        label={dict.signup.passwordLabel}
        autoComplete="new-password"
        required
        minLength={8}
        placeholder={dict.signup.passwordPlaceholder}
        onValueChange={setPassword}
        dict={dict}
      />

      <PasswordInput
        name="confirmPassword"
        label={dict.signup.confirmPasswordLabel}
        autoComplete="new-password"
        required
        minLength={8}
        placeholder={dict.signup.confirmPasswordPlaceholder}
        onValueChange={setConfirmPassword}
        dict={dict}
      />
      {mismatch ? (
        <p className="-mt-2 text-xs text-signal-red">{dict.signup.passwordMismatch}</p>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || mismatch} className="mt-2">
        {pending ? dict.signup.submitPending : dict.signup.submit}
      </Button>
    </form>
  );
}
