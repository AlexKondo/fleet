import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { deriveBuscarGate } from "@/lib/carpool/buscarCarona";
import { FmShell } from "./FmShell";
import { CarpoolSearch } from "./CarpoolSearch";

/**
 * SCR-USR-003 "Buscar Carona": the rider-facing carpool search. The new FleetMind look is scoped to this route
 * (FmShell + fm-theme.css). The actor comes from the session; the org policy gates the screen.
 */
export default async function CarpoolPage() {
  const dict = await getDictionary();
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const gate = profile ? deriveBuscarGate(await loadLatestPolicy(supabase, profile.organization_id)) : "unknown";
  const role = profile?.role ?? "employee";

  return (
    <FmShell active="find"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={role}
      isFleetManager={role === "fleet_manager" || role === "administrator"}
      isAdministrator={role === "administrator"}
    >
      {!profile ? (
        <p role="alert" className="fm-banner fm-banner-danger" data-testid="buscar-forbidden">
          {dict.carpool.errors.notAuthorized}
        </p>
      ) : gate === "disabled" ? (
        <>
          <h1 className="fm-title">{dict.carpool.buscar.title}</h1>
          <p role="alert" className="fm-banner fm-banner-danger" data-testid="buscar-blocked">
            {dict.carpool.errors.disabledByPolicy}
          </p>
        </>
      ) : gate === "unknown" ? (
        <>
          <h1 className="fm-title">{dict.carpool.buscar.title}</h1>
          <p role="status" className="fm-banner" data-testid="carpool-unavailable">
            {dict.carpool.newTrip.unavailableBanner}
          </p>
        </>
      ) : (
        <CarpoolSearch dict={dict} locale={locale} />
      )}
    </FmShell>
  );
}
