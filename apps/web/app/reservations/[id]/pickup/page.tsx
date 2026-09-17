import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { PickupForm } from "./PickupForm";
import { getDictionary } from "../../../../lib/i18n/getLocale";

export default async function PickupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dict = await getDictionary();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, { data: reservation }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).single(),
    supabase
      .from("reservations")
      .select(
        `id, status,
       trip_request:trip_requests(origin, destination, requester_id),
       vehicle:vehicles(id, plate, name, color, status, odometer_km, estimated_range_km,
         category:vehicle_categories(name, energy_type))`,
      )
      .eq("id", id)
      .single(),
  ]);

  if (!reservation || !reservation.vehicle || !reservation.trip_request) notFound();

  const vehicle = reservation.vehicle;

  // Same authorization rule as reservations/[id]/page.tsx (and as record_pickup itself,
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

  // Mirrors record_pickup's own preconditions so the user learns the pickup doesn't apply
  // here *before* filling in the whole checklist, not after the submit fails server-side.
  const canPickUp =
    reservation.status === "confirmed" &&
    (vehicle.status === "reserved" || vehicle.status === "awaiting_pickup");
  if (!canPickUp) redirect(`${fallbackPath}?tripActionError=pickup_wrong_status`);
  const energyType = vehicle.category?.energy_type ?? "ICE";
  const showElectricRange = energyType === "BEV" || energyType === "PHEV";

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
          {dict.reservations.pickup.title}
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
          <PickupForm
            reservationId={reservation.id}
            energyType={energyType}
            currentOdometer={vehicle.odometer_km}
            dict={dict}
          />
        </div>
      </div>
    </main>
  );
}
