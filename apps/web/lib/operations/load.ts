import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
import { parseSnapshot, type OpsSnapshot } from "./models";
export async function loadOperationalWorkspace(roles: readonly string[]) {
  const db = await createSupabaseServerClient();
  const user = await getCurrentUser(db);
  if (!user) redirect("/login");
  const { data: profile, error } = await db
    .from("profiles")
    .select(
      "id,full_name,role,organization_id,organization:organizations(name)",
    )
    .eq("id", user.id)
    .single();
  if (error || !profile || !roles.includes(profile.role))
    redirect("/dashboard");
  const manager=["fleet_manager","administrator"].includes(profile.role);
  const read = async <T>(p: Promise<T>): Promise<T | null> =>
    p.catch(() => null);
  const [vehicles, locations, snapshot] = await Promise.all([
    read(
      pageAll("ops vehicles", (a, b) =>
        (manager ? db.from("fm_managed_vehicles") : db.from("vehicles"))
          .select(
            "id,plate,name,vin,next_service_date,status,odometer_km,next_service_odometer_km,current_location_id,category:vehicle_categories(name,energy_type),current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
          ).is("archived_at",null)
          .eq("organization_id", profile.organization_id)
          .order("id")
          .range(a, b),
      ),
    ),
    read(
      pageAll("ops locations", (a, b) =>
        db
          .from("vehicle_locations")
          .select("id,name").eq("enabled",true)
          .eq("organization_id", profile.organization_id)
          .order("id")
          .range(a, b),
      ),
    ),
    read(
      (async () => {
        const { data, error } = await db.rpc("fm_v3_snapshot");
        if (error) throw error;
        return parseSnapshot(data);
      })(),
    ),
  ]);
  const records: OpsSnapshot = snapshot ?? {
    orders: null,
    lines: null,
    energy: null,
    gate: null,
    acknowledgements: null,
  };
  return {
    db,
    profile,
    vehicles,
    locations,
    records,
    unavailable: vehicles === null || snapshot === null,
    manager: ["fleet_manager", "administrator"].includes(profile.role),
    migrationUnavailable: snapshot === null,
  };
}
export type OperationalData = Awaited<
  ReturnType<typeof loadOperationalWorkspace>
>;
