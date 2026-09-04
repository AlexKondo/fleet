import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../AppShell";
import { LocationForm } from "./LocationForm";
import { LocationRow } from "./LocationRow";
import { CategoryForm } from "./CategoryForm";
import { CategoryRow } from "./CategoryRow";
import { VehicleForm } from "./VehicleForm";
import { VehicleRow } from "./VehicleRow";

/**
 * Fleet setup: add vehicles, categories, and locations. Until this page existed, a
 * brand-new organization created via /signup had no way to populate its own fleet
 * except a direct SQL insert (which is how the seeded demo org's 10 vehicles got
 * there) — the entire rest of the app (trip requests, checklists, dashboard) is
 * unusable without at least one vehicle.
 */
export default async function FleetPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";
  if (!profile || !isFleetManager) redirect("/dashboard");

  const [
    { data: locations, error: locationsError },
    { data: categories, error: categoriesError },
    { data: vehicles, error: vehiclesError },
  ] = await Promise.all([
    supabase.from("vehicle_locations").select("id, name").order("name"),
    supabase.from("vehicle_categories").select("id, name, passenger_capacity, supports_cargo").order("name"),
    supabase
      .from("vehicles")
      .select(
        "id, plate, category_id, energy_type, status, odometer_km, next_service_odometer_km, estimated_range_km, fuel_level_percent, battery_level_percent, home_location_id, category:vehicle_categories(name), current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
      )
      .order("plate"),
  ]);
  const loadError = locationsError || categoriesError || vehiclesError;

  return (
    <AppShell
      active="fleet"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
    >
      <header className="border-b border-line-800 px-6 py-4">
        <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
          Frota
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="border-b border-signal-red/40 bg-signal-red/10 px-6 py-3 text-sm text-signal-red"
        >
          Não foi possível carregar os dados da frota agora. Tente novamente em instantes.
        </div>
      ) : null}

      <section className="border-b border-line-800 px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Localizações
        </h2>
        {locations && locations.length > 0 ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {locations.map((l) => (
              <LocationRow key={l.id} location={l} />
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-fog-400">Nenhuma localização cadastrada ainda.</p>
        )}
        <LocationForm />
      </section>

      <section className="border-b border-line-800 px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Categorias de Veículo
        </h2>
        {categories && categories.length > 0 ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {categories.map((c) => (
              <CategoryRow key={c.id} category={c} />
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-fog-400">Nenhuma categoria cadastrada ainda.</p>
        )}
        <CategoryForm />
      </section>

      <section className="px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Veículos
        </h2>

        {vehicles && vehicles.length > 0 ? (
          <ul className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {vehicles.map((v) => (
              <VehicleRow
                key={v.id}
                vehicle={{
                  id: v.id,
                  plate: v.plate,
                  category_id: v.category_id,
                  energy_type: v.energy_type,
                  odometer_km: v.odometer_km,
                  next_service_odometer_km: v.next_service_odometer_km,
                  estimated_range_km: v.estimated_range_km,
                  fuel_level_percent: v.fuel_level_percent,
                  battery_level_percent: v.battery_level_percent,
                  home_location_id: v.home_location_id,
                }}
                status={v.status}
                categoryName={v.category?.name ?? "—"}
                locationName={v.current_location?.name ?? "—"}
                categories={categories ?? []}
                locations={locations ?? []}
              />
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-sm text-fog-400">
            Nenhum veículo cadastrado ainda — a frota aparece no Painel assim que o
            primeiro veículo for adicionado abaixo.
          </p>
        )}

        <VehicleForm categories={categories ?? []} locations={locations ?? []} />
      </section>
    </AppShell>
  );
}
