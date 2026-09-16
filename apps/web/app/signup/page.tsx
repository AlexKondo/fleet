import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { Card } from "../ui/Card";

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-4xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span>
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-fog-400">
            Comece a operar sua frota
          </p>
        </div>
        <Card>
          <SignupForm />
        </Card>
        <p className="mt-4 text-center text-sm text-fog-400">
          Já tem uma conta?{" "}
          <Link href="/login" className="text-signal-amber hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
