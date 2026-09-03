import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-4xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span>
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-fog-400">
            Esqueci minha senha
          </p>
        </div>
        <div className="rounded-md border border-line-800 bg-panel-900/60 p-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-4 text-center text-sm text-fog-400">
          <Link href="/login" className="text-signal-amber hover:underline">
            ← Voltar para o login
          </Link>
        </p>
      </div>
    </main>
  );
}
