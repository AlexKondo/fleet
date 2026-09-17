"use client";

import { useActionState } from "react";
import { PasswordInput } from "../PasswordInput";
import { updatePassword, type ResetPasswordState } from "./actions";
import type { Dictionary } from "../../lib/i18n/dictionaries";

const initialState: ResetPasswordState = { status: "idle" };

export function ResetPasswordForm({ dict }: { dict: Dictionary }) {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <PasswordInput
        name="password"
        label={dict.auth.newPasswordLabel}
        autoComplete="new-password"
        required
        minLength={8}
        placeholder={dict.auth.newPasswordPlaceholder}
        dict={dict}
      />
      <PasswordInput
        name="confirmPassword"
        label={dict.auth.confirmNewPasswordLabel}
        autoComplete="new-password"
        required
        minLength={8}
        placeholder={dict.auth.confirmNewPasswordPlaceholder}
        dict={dict}
      />

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-sm bg-gwm-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? dict.common.saving : dict.auth.saveNewPassword}
      </button>
    </form>
  );
}
