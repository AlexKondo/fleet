import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TripRequestForm } from "./TripRequestForm";

export default async function NewTripPage() {
  // Every other protected page checks auth itself rather than relying solely on
  // middleware (see e.g. trips/page.tsx) — this page was the one exception, reachable by
  // an unauthenticated visitor if middleware ever fails open (see middleware.ts's
  // MissingEnvVarError handling).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-dvh px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
              Solicitar Viagem
            </p>
            <p className="text-xs uppercase tracking-widest text-fog-600">
              Diga onde e quando — nós procuramos a melhor forma de te levar.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
          >
            ← Painel
          </Link>
        </div>
        <TripRequestForm />
      </div>
    </main>
  );
}
