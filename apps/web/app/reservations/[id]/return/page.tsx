import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReturnForm } from "./ReturnForm";
import { getDictionary, getLocale } from "../../../../lib/i18n/getLocale";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dict = await getDictionary();
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: reservation }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).single(),
    supabase
      .from("reservations")
      .select(
        `id, status,
       trip_request:trip_requests(origin, destination, requester_id),
       vehicle:vehicles(id, plate, name, color, status, odometer_km, estimated_range_km,
         home_location_id, category:vehicle_categories(name, energy_type))`,
      )
      .eq("id", id)
      .single(),
  ]);

  if (!reservation || !reservation.vehicle || !reservation.trip_request) notFound();

  const vehicle = reservation.vehicle;

  // Same authorization rule as reservations/[id]/page.tsx (and as record_return itself,
  // 0004_operational_actions.sql): the trip's own requester, or a privileged fleet role.
  const isPrivileged =
    profile?.role === "fleet_manager" ||
    profile?.role === "administrator" ||
    profile?.role === "security";
  // Security never requests trips, so /trips is permanently empty for them (the same
  // reason /gate exists) — bounce them back there instead of into a dead end.
  const fallbackPath = profile?.role === "security" ? "/gate" : "/trips";
  if (!isPrivileged && reservation.trip_request.requester_id !== user.id) {
    redirect(`${fallbackPath}?tripActionError=checklist_not_authorized`);
  }

  // Mirrors record_return's own preconditions: there's nothing to return until the vehicle
  // has actually been picked up, and a cancelled/completed reservation is already closed.
  const canReturn =
    reservation.status === "confirmed" &&
    (vehicle.status === "in_use" || vehicle.status === "returning");
  if (!canReturn) redirect(`${fallbackPath}?tripActionError=return_wrong_status`);
  const energyType = vehicle.category?.energy_type ?? "ICE";
  const showElectricRange = energyType === "BEV" || energyType === "PHEV";

  // §14 Current Vehicle Location: the return checklist is where the traveler reports
  // where they parked, so the location picker is scoped to this org's vehicle_locations
  // the same way the Fleet Manager dashboard's "Localização Atual" column is.
  const { data: locations } = await supabase
    .from("vehicle_locations")
    .select("id, name")
    .order("name");

  return (
    <main className="min-h-dvh px-6 py-8">
      <div className="mx-auto max-w-xl">
        <Link
          href="/trips"
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent"
        >
          {dict.reservations.detail.backToTrips}
        </Link>
        <p className="mt-4 font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
          {dict.reservations.return.title}
        </p>
        <p className="mt-1 text-sm text-fog-400">
          <span className="font-mono">{vehicle.plate}</span>
          {vehicle.name ? ` · ${vehicle.name}` : ""}
          {vehicle.category?.name ? ` · ${vehicle.category.name}` : ""}
          {vehicle.color ? ` · ${vehicle.color}` : ""}
          {showElectricRange
            ? ` · ${dict.reservations.checklist.electricRange.replace("{km}", String(vehicle.estimated_range_km))}`
            : ""}
        </p>
        <p className="mt-1 font-mono text-xs text-fog-600">
          {reservation.trip_request?.origin} → {reservation.trip_request?.destination}
        </p>
        <div className="mt-6 rounded-md border border-line-800 bg-panel-900/60 p-6">
          <ReturnForm
            reservationId={reservation.id}
            energyType={energyType}
            currentOdometer={vehicle.odometer_km}
            locations={locations ?? []}
            homeLocationId={vehicle.home_location_id}
            dict={dict}
            locale={locale}
          />
        </div>
      </div>
    </main>
  );
}
