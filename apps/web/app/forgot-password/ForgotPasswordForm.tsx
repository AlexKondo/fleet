"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.status === "success") {
    return (
      <p role="status" className="text-sm text-signal-teal">
        Se esse e-mail estiver cadastrado, enviamos um link para redefinir a senha. Confira
        também a caixa de spam.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          E-mail
        </span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="voce@empresa.com"
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2.5 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
      </label>

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
        {pending ? "Enviando…" : "Enviar link de redefinição"}
      </button>
    </form>
  );
}
