import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { LoginRecovery } from "./LoginRecovery";
import { Card } from "../ui/Card";

export default function LoginPage() {
  return (
    <LoginRecovery>
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <p className="font-display text-4xl font-extrabold uppercase tracking-tight text-paper-50">
              Fleet<span className="text-signal-amber">.</span>
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-fog-400">
              Right Vehicle. Right Trip. Ready to Go.
            </p>
          </div>
          <Card>
            <LoginForm />
          </Card>
          <p className="mt-4 text-center text-sm text-fog-400">
            Sua empresa ainda não usa o Fleet?{" "}
            <Link href="/signup" className="text-signal-amber hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </main>
    </LoginRecovery>
  );
}
