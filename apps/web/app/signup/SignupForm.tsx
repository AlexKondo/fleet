"use client";

import { useActionState, useState } from "react";
import { PasswordInput } from "../PasswordInput";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <Field label="Seu nome completo" htmlFor="fullName">
        <Input id="fullName" type="text" name="fullName" required placeholder="Maria Silva" />
      </Field>

      <Field label="E-mail" htmlFor="email">
        <Input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="voce@suaempresa.com"
          className="font-mono"
        />
      </Field>

      <PasswordInput
        name="password"
        label="Senha"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Mínimo 8 caracteres"
        onValueChange={setPassword}
      />

      <PasswordInput
        name="confirmPassword"
        label="Confirmar senha"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="Digite a senha novamente"
        onValueChange={setConfirmPassword}
      />
      {mismatch ? (
        <p className="-mt-2 text-xs text-signal-red">As senhas não coincidem.</p>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || mismatch} className="mt-2">
        {pending ? "Criando…" : "Criar conta"}
      </Button>
    </form>
  );
}
