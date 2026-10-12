import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { PickupForm } from "./PickupForm";
import { ChecklistFrame } from "../ChecklistFrame";
import { getDictionary } from "../../../../lib/i18n/getLocale";

export default async function PickupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dict = await getDictionary();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, { data: reservation }] = await Promise.all([
    supabase.from("profiles").select("full_name, role, organization_id, organization:organizations(name)").eq("id", user.id).single(),
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

  const { data: equipmentItems } = await supabase
    .from("safety_equipment_items")
    .select("id, name")
    .eq("organization_id", profile?.organization_id ?? "")
    .order("created_at");

  return (
    <ChecklistFrame
      dict={dict}
      title={dict.reservations.pickup.title}
      intro={dict.reservations.checklist.pickupIntro}
      shell={{
        orgName: profile?.organization?.name ?? "—",
        userName: profile?.full_name ?? user.email ?? "—",
        role: profile?.role ?? "employee",
      }}
      vehicle={{
        plate: vehicle.plate,
        name: vehicle.name,
        color: vehicle.color,
        categoryName: vehicle.category?.name ?? null,
        energyType,
        estimatedRangeKm: vehicle.estimated_range_km,
      }}
      showElectricRange={showElectricRange}
      route={{ origin: reservation.trip_request?.origin, destination: reservation.trip_request?.destination }}
    >
        <PickupForm
          reservationId={reservation.id}
          energyType={energyType}
          currentOdometer={vehicle.odometer_km}
          equipmentItems={equipmentItems ?? []}
          dict={dict}
        />
    </ChecklistFrame>
  );
}
