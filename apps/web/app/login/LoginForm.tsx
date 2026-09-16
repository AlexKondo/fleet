"use client";

import { useActionState } from "react";
import Link from "next/link";
import { PasswordInput } from "../PasswordInput";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { signIn, type SignInState } from "./actions";
import type { Dictionary } from "../../lib/i18n/dictionaries";

const initialState: SignInState = { error: null };

export function LoginForm({ dict }: { dict: Dictionary }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Field label={dict.login.emailLabel} htmlFor="email">
        <Input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder={dict.login.emailPlaceholder}
          className="font-mono"
        />
      </Field>
      <PasswordInput
        name="password"
        label={dict.login.passwordLabel}
        autoComplete="current-password"
        required
        placeholder={dict.login.passwordPlaceholder}
        dict={dict}
      />
      <Link
        href="/forgot-password"
        className="self-end text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
      >
        {dict.login.forgotPassword}
      </Link>

      {state.error ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? dict.login.submitPending : dict.login.submit}
      </Button>
    </form>
  );
}
