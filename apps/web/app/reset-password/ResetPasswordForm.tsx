"use client";

import { useActionState } from "react";
import { PasswordInput } from "../PasswordInput";
import { updatePassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <PasswordInput
        name="password"
        label="Nova senha"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Mín. 8 caracteres"
      />
      <PasswordInput
        name="confirmPassword"
        label="Confirmar nova senha"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Repita a senha"
      />

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar nova senha"}
      </button>
    </form>
  );
}
