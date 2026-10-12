import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { ReturnForm } from "./ReturnForm";
import { ChecklistFrame } from "../ChecklistFrame";
import { getDictionary, getLocale } from "../../../../lib/i18n/getLocale";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dict = await getDictionary();
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // §14 Current Vehicle Location: the return checklist is where the traveler reports
  // where they parked, so the location picker is scoped to this org's vehicle_locations
  // the same way the Fleet Manager dashboard's "Localização Atual" column is. It depends
  // on nothing above it, so it rides along here instead of costing its own round trip
  // after every authorization check has already passed.
  const [{ data: profile }, { data: reservation }, { data: locations }] = await Promise.all([
    supabase.from("profiles").select("full_name, role, organization_id, organization:organizations(name)").eq("id", user.id).single(),
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
    supabase.from("vehicle_locations").select("id, name").order("name"),
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

  const { data: equipmentItems } = await supabase
    .from("safety_equipment_items")
    .select("id, name")
    .eq("organization_id", profile?.organization_id ?? "")
    .order("created_at");

  return (
    <ChecklistFrame
      dict={dict}
      title={dict.reservations.return.title}
      intro={dict.reservations.checklist.returnIntro}
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
        <ReturnForm
          reservationId={reservation.id}
          energyType={energyType}
          currentOdometer={vehicle.odometer_km}
          locations={locations ?? []}
          homeLocationId={vehicle.home_location_id}
          equipmentItems={equipmentItems ?? []}
          dict={dict}
          locale={locale}
        />
    </ChecklistFrame>
  );
}
