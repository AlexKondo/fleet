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
       vehicle:vehicles(id, plate, energy_type, status, odometer_km)`,
    )
    .eq("id", id)
    .single();

  if (!reservation || !reservation.vehicle) notFound();

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
            energyType={reservation.vehicle.energy_type}
            currentOdometer={reservation.vehicle.odometer_km}
          />
        </div>
      </div>
    </main>
  );
}
