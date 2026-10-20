import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { pageAll, chunked } from "../carpool/kpi/loadKpis";
import { dashboardPeriod } from "./period";

/** Caller must verify manager role first. Every read uses the session client,
 * explicit organization scope and RLS. Failed sources remain null, never zero. */
export async function loadCommandCenter(
  db: TypedSupabaseClient,
  organizationId: string,
  period?: string,
  location?: string,
) {
  const range = dashboardPeriod(period);
  const safe = async <T>(query: Promise<T>): Promise<T | null> =>
    query.catch(() => null);
  const [vehicles, locations] = await Promise.all([
    safe(
      pageAll("command vehicles", (a, b) =>
        db
          .from("fm_managed_vehicles")
          .select(
            "id, plate, status, current_location_id, odometer_km, next_service_odometer_km, category:vehicle_categories(name, energy_type), current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
          ).is("archived_at",null)
          .eq("organization_id", organizationId)
          .order("id")
          .range(a, b),
      ),
    ),
    safe(
      pageAll("command locations", (a, b) =>
        db
          .from("vehicle_locations")
          .select("id, name")
          .eq("organization_id", organizationId)
          .order("id")
          .range(a, b),
      ),
    ),
  ]);
  const selectedLocation = locations?.some((l) => l.id === location)
    ? location!
    : "all";
  const scopedVehicles =
    vehicles === null
      ? null
      : vehicles.filter(
          (v) =>
            selectedLocation === "all" ||
            v.current_location_id === selectedLocation,
        );
  const ids = new Set(scopedVehicles?.map((v) => v.id));
  const [allReservations, allTasks] = await Promise.all([
    safe(
      pageAll("command reservations", (a, b) =>
        db
          .from("fm_managed_reservations")
          .select(
            "id, vehicle_id, trip_request_id, status, start_at, end_at, trip_request:trip_requests(origin, destination, requester:profiles(full_name))",
          )
          .eq("organization_id", organizationId)
          .gte("start_at", range.from)
          .lt("start_at", range.to)
          .order("id")
          .range(a, b),
      ),
    ),
    safe(
      pageAll("command tasks", (a, b) =>
        db
          .from("fm_managed_workflow_tasks")
          .select(
            "id, vehicle_id, type, priority, created_at, vehicle:vehicles(plate)",
          )
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .order("id")
          .range(a, b),
      ),
    ),
  ]);
  const reservations =
    allReservations === null ||
    (selectedLocation !== "all" && scopedVehicles === null)
      ? null
      : allReservations.filter(
          (r) => selectedLocation === "all" || ids.has(r.vehicle_id),
        );
  const tasks =
    allTasks === null || (selectedLocation !== "all" && scopedVehicles === null)
      ? null
      : allTasks.filter(
          (r) => selectedLocation === "all" || ids.has(r.vehicle_id),
        );
  const tripIds = [
    ...new Set(
      reservations
        ?.filter((r) => r.status === "confirmed" || r.status === "completed")
        .map((r) => r.trip_request_id),
    ),
  ];
  const offers =
    reservations === null
      ? null
      : await safe(
          chunked(tripIds, 100, (chunk) =>
            pageAll("command offers", (a, b) =>
              db
                .from("fm_managed_carpool_offers")
                .select("id")
                .eq("organization_id", organizationId)
                .in("trip_request_id", chunk)
                .order("id")
                .range(a, b),
            ),
          ),
        );
  const rides =
    offers === null
      ? null
      : await safe(
          chunked(
            offers.map((o) => o.id),
            100,
            (chunk) =>
              pageAll("command riders", (a, b) =>
                db
                  .from("fm_managed_ride_requests")
                  .select("id, requested_seats, carpool_offer_id")
                  .eq("organization_id", organizationId)
                  .eq("status", "ACCEPTED")
                  .in("carpool_offer_id", chunk)
                  .order("id")
                  .range(a, b),
              ),
          ),
        );
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
  const dailyCounts = new Map<string, number>();
  for (const reservation of reservations ?? []) {
    if (
      reservation.status !== "confirmed" &&
      reservation.status !== "completed"
    )
      continue;
    const day = dayFormat.format(new Date(reservation.start_at));
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }
  const daily: { day: string; count: number }[] = [];
  for (
    let stamp = new Date(range.from).getTime();
    stamp < new Date(range.to).getTime();
    stamp += 86400000
  ) {
    const day = dayFormat.format(new Date(stamp));
    daily.push({ day, count: dailyCounts.get(day) ?? 0 });
  }
  return {
    range,
    selectedLocation,
    vehicles: scopedVehicles,
    locations,
    reservations,
    tasks,
    rides,
    daily,
    degraded: [vehicles, locations, reservations, tasks, rides].some(
      (v) => v === null,
    ),
  };
}
