import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../AppShell";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  return (
    <AppShell
      active="trips"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title="Solicitar Viagem"
    >
      <div className="px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <p className="mb-6 text-xs uppercase tracking-widest text-fog-600">
            Diga onde e quando — nós procuramos a melhor forma de te levar.
          </p>
          <TripRequestForm />
        </div>
      </div>
    </AppShell>
  );
}
