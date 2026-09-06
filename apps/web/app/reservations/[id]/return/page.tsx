import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReturnForm } from "./ReturnForm";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: reservation } = await supabase
    .from("reservations")
    .select(
      `id, status,
       trip_request:trip_requests(origin, destination),
       vehicle:vehicles(id, plate, status, odometer_km, home_location_id, category:vehicle_categories(energy_type))`,
    )
    .eq("id", id)
    .single();

  if (!reservation || !reservation.vehicle) notFound();

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
        <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
          Checklist de Retorno
        </p>
        <p className="mt-1 font-mono text-sm text-fog-400">
          {reservation.vehicle.plate} · {reservation.trip_request?.origin} →{" "}
          {reservation.trip_request?.destination}
        </p>
        <div className="mt-6 rounded-md border border-line-800 bg-panel-900/60 p-6">
          <ReturnForm
            reservationId={reservation.id}
            energyType={reservation.vehicle.category?.energy_type ?? "ICE"}
            currentOdometer={reservation.vehicle.odometer_km}
            locations={locations ?? []}
            homeLocationId={reservation.vehicle.home_location_id}
          />
        </div>
      </div>
    </main>
  );
}
