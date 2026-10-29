import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FmShell } from "../../carpool/FmShell";
import { TripRequestForm } from "./TripRequestForm";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { deriveCarpoolGating } from "@/lib/carpool/carpoolFirst";
import { parseTripPrefill } from "@/lib/trips/tripPrefill";
import { loadWorkLocation } from "@/lib/geospatial/workLocation";

export default async function NewTripPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Assistant hand-off (no vehicle found in chat): validated trip data only; nothing is created here.
  const prefill = parseTripPrefill((await searchParams) ?? {});
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

  const workLocation = await loadWorkLocation(supabase, user.id);
  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";

  // Registered departure locations (vehicle_locations) with how many vehicles are there right now: the requester picks
  // where the vehicle leaves from, and only vehicles at that location are offered (see buildPlanInputs).
  const [{ data: locationRows }, { data: locatedVehicles }] = await Promise.all([
    supabase.from("vehicle_locations").select("id, name").order("name"),
    supabase.from("vehicles").select("current_location_id").is("archived_at", null).in("status", ["available", "charging", "cleaning"]),
  ]);
  const vehiclesAt = new Map<string, number>();
  for (const v of locatedVehicles ?? []) {
    if (v.current_location_id) vehiclesAt.set(v.current_location_id, (vehiclesAt.get(v.current_location_id) ?? 0) + 1);
  }
  const pickupLocations = (locationRows ?? []).map((l) => ({ id: l.id, name: l.name, vehicles: vehiclesAt.get(l.id) ?? 0 }));

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
      <TripRequestForm dict={dict} locale={locale} carpoolMode={carpoolMode} prefill={prefill} pickupLocations={pickupLocations} workLocation={workLocation} />
    </FmShell>
  );
}
