"use client";

import { useActionState } from "react";
import Link from "next/link";
import { PasswordInput } from "../PasswordInput";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Field label="E-mail" htmlFor="email">
        <Input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="gestor@gwm-demo.local"
          className="font-mono"
        />
      </Field>
      <PasswordInput
        name="password"
        label="Senha"
        autoComplete="current-password"
        required
        placeholder="••••••••••••"
      />
      <Link
        href="/forgot-password"
        className="self-end text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
      >
        Esqueci minha senha
      </Link>

      {state.error ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
