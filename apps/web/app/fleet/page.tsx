import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { VEHICLE_STATUSES, getStatusMeta } from "../dashboard/statusMeta";
import { AppShell } from "../AppShell";
import { AddCategorySection } from "./AddCategorySection";
import { AddLocationSection } from "./AddLocationSection";
import { AddVehicleSection } from "./AddVehicleSection";
import { FleetTabs } from "./FleetTabs";
import { LocationRow } from "./LocationRow";
import { CategoryRow } from "./CategoryRow";
import { VehicleRow } from "./VehicleRow";
import { VehicleFilterGrid } from "./VehicleFilterGrid";
import { EmptyState } from "./EmptyState";

/**
 * Fleet setup: add vehicles, categories, and locations. Until this page existed, a
 * brand-new organization created via /signup had no way to populate its own fleet
 * except a direct SQL insert (which is how the seeded demo org's 10 vehicles got
 * there) — the entire rest of the app (trip requests, checklists, dashboard) is
 * unusable without at least one vehicle.
 */
export default async function FleetPage() {
  const supabase = await createSupabaseServerClient();
  const dict = await getDictionary();
  const locale = await getLocale();
  const statusMeta = getStatusMeta(dict);
  // Options for the client-side status filter, localized here so the client component
  // never needs the status → label map itself.
  const statusOptions = VEHICLE_STATUSES.map((s) => ({ value: s, label: statusMeta[s].label }));

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // The profile lookup is folded into the same round trip as the three fleet queries:
  // none of them are scoped by anything on `profile` (RLS already scopes them to the
  // caller's org), so gating on the role *before* issuing them only bought a wasted
  // sequential round trip on every load. An unauthorized role still never sees the data —
  // it's discarded by the redirect below.
  const [
    { data: profile },
    { data: locations, error: locationsError },
    { data: categories, error: categoriesError },
    { data: vehicles, error: vehiclesError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase.from("vehicle_locations").select("id, name").order("name"),
    supabase.from("vehicle_categories").select("id, name, passenger_capacity, supports_cargo, energy_type").order("name"),
    supabase
      .from("vehicles")
      .select(
        "id, plate, name, color, photo_storage_path, category_id, status, odometer_km, next_service_odometer_km, estimated_range_km, fuel_level_percent, battery_level_percent, home_location_id, category:vehicle_categories(name), current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
      )
      .order("plate"),
  ]);

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  if (!profile || !isFleetManager) redirect("/dashboard");

  const loadError = locationsError || categoriesError || vehiclesError;

  // VehicleForm/EditVehicleForm read `energyType` (camelCase) to decide which fuel/
  // battery field to show for the currently-selected category.
  const categoriesForVehicleForms = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    energyType: c.energy_type,
  }));

  // vehicle-photos is a private bucket (0002_operational_cycle.sql) — cards need a
  // short-lived signed URL per photo rather than a public one.
  const photoPaths = (vehicles ?? [])
    .map((v) => v.photo_storage_path)
    .filter((p): p is string => Boolean(p));
  const { data: signedPhotoUrls } =
    photoPaths.length > 0
      ? await supabase.storage.from("vehicle-photos").createSignedUrls(photoPaths, 60 * 60)
      : { data: [] as { path: string | null; signedUrl: string }[] };
  const photoUrlByPath = new Map(
    (signedPhotoUrls ?? [])
      .filter((s) => s.path && s.signedUrl)
      .map((s) => [s.path as string, s.signedUrl]),
  );

  return (
    <AppShell
      active="fleet"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.fleet.title}
    >

      {loadError ? (
        <div
          role="alert"
          className="border-b border-signal-red/40 bg-signal-red/10 px-6 py-3 text-sm text-signal-red"
        >
          {dict.fleet.loadError}
        </div>
      ) : null}

      <section className="px-6 py-6">
        <FleetTabs
          tabs={[
            {
              key: "vehicles",
              label: dict.fleet.tabs.vehicles,
              count: vehicles?.length ?? 0,
              content: (
                <div className="flex flex-col gap-4">
                  {vehicles && vehicles.length > 0 ? (
                    <VehicleFilterGrid
                      dict={dict}
                      statusOptions={statusOptions}
                      vehicles={vehicles.map((v) => ({
                        id: v.id,
                        plate: v.plate,
                        name: v.name,
                        status: v.status,
                        categoryName: v.category?.name ?? "—",
                        node: (
                          <VehicleRow
                            key={v.id}
                            locale={locale}
                            vehicle={{
                              id: v.id,
                              plate: v.plate,
                              name: v.name,
                              color: v.color,
                              photoUrl: v.photo_storage_path
                                ? (photoUrlByPath.get(v.photo_storage_path) ?? null)
                                : null,
                              category_id: v.category_id,
                              odometer_km: v.odometer_km,
                              next_service_odometer_km: v.next_service_odometer_km,
                              estimated_range_km: v.estimated_range_km,
                              fuel_level_percent: v.fuel_level_percent,
                              battery_level_percent: v.battery_level_percent,
                              home_location_id: v.home_location_id,
                            }}
                            statusMeta={statusMeta[v.status]}
                            categoryName={v.category?.name ?? "—"}
                            locationName={v.current_location?.name ?? "—"}
                            categories={categoriesForVehicleForms}
                            locations={locations ?? []}
                            dict={dict}
                          />
                        ),
                      }))}
                    />
                  ) : (
                    <EmptyState
                      lead={dict.fleet.emptyState.vehiclesLead}
                      hint={dict.fleet.emptyState.vehiclesHint}
                    />
                  )}
                  <AddVehicleSection
                    categories={categoriesForVehicleForms}
                    locations={locations ?? []}
                    dict={dict}
                  />
                </div>
              ),
            },
            {
              key: "categories",
              label: dict.fleet.tabs.categories,
              count: categories?.length ?? 0,
              content: (
                <div className="flex flex-col gap-4">
                  {categories && categories.length > 0 ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {categories.map((c) => (
                        <CategoryRow key={c.id} category={c} dict={dict} />
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      lead={dict.fleet.emptyState.categoriesLead}
                      hint={dict.fleet.emptyState.categoriesHint}
                    />
                  )}
                  <AddCategorySection dict={dict} />
                </div>
              ),
            },
            {
              key: "locations",
              label: dict.fleet.tabs.locations,
              count: locations?.length ?? 0,
              content: (
                <div className="flex flex-col gap-4">
                  {locations && locations.length > 0 ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {locations.map((l) => (
                        <LocationRow key={l.id} location={l} dict={dict} />
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      lead={dict.fleet.emptyState.locationsLead}
                      hint={dict.fleet.emptyState.locationsHint}
                    />
                  )}
                  <AddLocationSection dict={dict} />
                </div>
              ),
            },
          ]}
        />
      </section>
    </AppShell>
  );
}
