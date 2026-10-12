import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FmShell } from "../../carpool/FmShell";
import { TripRequestForm } from "./TripRequestForm";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { deriveCarpoolGating } from "@/lib/carpool/carpoolFirst";

export default async function NewTripPage() {
  const dict = await getDictionary();
  const locale = await getLocale();
  // Every other protected page checks auth itself rather than relying solely on
  // middleware (see e.g. trips/page.tsx) — this page was the one exception, reachable by
  // an unauthenticated visitor if middleware ever fails open (see middleware.ts's
  // MissingEnvVarError handling).
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  // Phase C5: the org policy decides whether the new carpool engine owns carpool (hides the old
  // consent checkbox, enables carpool-first and the host seat-offer step).
  const carpoolMode = deriveCarpoolGating(
    profile ? await loadLatestPolicy(supabase, profile.organization_id) : { ok: false },
  );

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";

  return (
    <FmShell
      active="book"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={profile?.role === "administrator"}
    >
      <h1 className="fm-title">{dict.trips.reservar.title}</h1>
      <p className="fm-subtitle">{dict.trips.reservar.subtitle}</p>
      <TripRequestForm dict={dict} locale={locale} carpoolMode={carpoolMode} />
    </FmShell>
  );
}
