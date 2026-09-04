"use client";

import { useActionState, useEffect, useRef } from "react";
import { inviteUser, type UserActionState } from "./actions";
import { ROLE_OPTIONS } from "./ROLE_LABELS";

const initialState: UserActionState = { status: "idle" };

export function InviteUserForm({ onSaved }: { onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(inviteUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Nome</span>
          <input
            type="text"
            name="fullName"
            required
            placeholder="Nome completo"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">E-mail</span>
          <input
            type="email"
            name="email"
            required
            placeholder="nome@empresa.com"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            Senha temporária
          </span>
          <input
            type="text"
            name="password"
            required
            minLength={8}
            placeholder="Mín. 8 caracteres"
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">Função</span>
          <select
            name="role"
            required
            defaultValue="employee"
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-fog-600">
        Compartilhe a senha temporária com a pessoa por um canal seguro — ela poderá
        alterá-la após o primeiro login.
      </p>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm text-signal-teal">
          Usuário criado.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Criando…" : "Criar Usuário"}
      </button>
    </form>
  );
}
