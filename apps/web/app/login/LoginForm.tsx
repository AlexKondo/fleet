"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

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
          placeholder="gestor@gwm-demo.local"
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2.5 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          Senha
        </span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••••••"
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2.5 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber disabled:opacity-50"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
