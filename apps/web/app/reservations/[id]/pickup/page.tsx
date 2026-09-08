import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PickupForm } from "./PickupForm";

export default async function PickupPage({ params }: { params: Promise<{ id: string }> }) {
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
       vehicle:vehicles(id, plate, status, odometer_km, category:vehicle_categories(energy_type))`,
    )
    .eq("id", id)
    .single();

  if (!reservation || !reservation.vehicle) notFound();

  return (
    <main className="min-h-dvh px-6 py-8">
      <div className="mx-auto max-w-xl">
        <Link
          href="/trips"
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
        >
          ← Minhas Viagens
        </Link>
        <p className="mt-4 font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
          Checklist de Retirada
        </p>
        <p className="mt-1 font-mono text-sm text-fog-400">
          {reservation.vehicle.plate} · {reservation.trip_request?.origin} →{" "}
          {reservation.trip_request?.destination}
        </p>
        <div className="mt-6 rounded-md border border-line-800 bg-panel-900/60 p-6">
          <PickupForm
            reservationId={reservation.id}
            energyType={reservation.vehicle.category?.energy_type ?? "ICE"}
            currentOdometer={reservation.vehicle.odometer_km}
          />
        </div>
      </div>
    </main>
  );
}
