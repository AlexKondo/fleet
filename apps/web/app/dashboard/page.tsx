import { redirect } from "next/navigation";
import { assessVehicleReadiness, type Vehicle } from "@fleet/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATTENTION_LABELS, STATUS_META } from "./statusMeta";
import { EnergyGauge } from "./EnergyGauge";
import { signOut } from "./actions";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();

  const { data: vehicleRows, error: vehiclesError } = await supabase
    .from("vehicles")
    .select(
      `id, plate, energy_type, status, odometer_km, fuel_level_percent, battery_level_percent,
       estimated_range_km, next_service_odometer_km, has_blocking_damage, missing_safety_equipment,
       documentation_valid, is_clean_exterior, is_clean_interior,
       category:vehicle_categories(name, passenger_capacity, supports_cargo),
       current_location:vehicle_locations!vehicles_current_location_id_fkey(name)`,
    )
    .order("plate");

  const vehicles = vehicleRows ?? [];

  const vehiclesWithAttention = vehicles.map((row) => {
    const domainVehicle: Vehicle = {
      id: row.id,
      organizationId: profile?.organization_id ?? "",
      plate: row.plate,
      categoryId: "",
      energyType: row.energy_type,
      status: row.status,
      odometerKm: row.odometer_km,
      fuelLevelPercent: row.fuel_level_percent,
      batteryLevelPercent: row.battery_level_percent,
      estimatedRangeKm: row.estimated_range_km,
      nextServiceOdometerKm: row.next_service_odometer_km,
      homeLocationId: "",
      currentLocationId: "",
      hasBlockingDamage: row.has_blocking_damage,
      missingSafetyEquipment: row.missing_safety_equipment,
      documentationValid: row.documentation_valid,
      isCleanExterior: row.is_clean_exterior,
      isCleanInterior: row.is_clean_interior,
    };
    return { row, attention: assessVehicleReadiness(domainVehicle) };
  });

  const attentionCounts = vehiclesWithAttention.reduce<Record<string, number>>((acc, { attention }) => {
    for (const reason of attention) {
      acc[reason] = (acc[reason] ?? 0) + 1;
    }
    return acc;
  }, {});

  return (
    <main className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line-800 px-6 py-4">
        <div>
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span>
          </p>
          <p className="text-xs uppercase tracking-widest text-fog-600">
            {profile?.organization?.name ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-paper-50">{profile?.full_name ?? user.email}</p>
            <p className="text-xs uppercase tracking-widest text-fog-600">{profile?.role}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-sm border border-line-800 px-3 py-1.5 text-xs uppercase tracking-widest text-fog-400 hover:border-signal-amber hover:text-signal-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber"
            >
              Sair
            </button>
          </form>
        </div>
      </header>

      <section className="border-b border-line-800 px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Precisa de Atenção
        </h2>
        {Object.keys(attentionCounts).length === 0 ? (
          <p className="text-sm text-fog-400">Nenhuma pendência — frota operacionalmente pronta.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {Object.entries(attentionCounts).map(([reason, count]) => (
              <li key={reason} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-signal-amber">{count}</span>
                <span className="text-fog-400">{ATTENTION_LABELS[reason] ?? reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-6 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Painel de Veículos
        </h2>

        {vehiclesError ? (
          <p className="text-sm text-signal-red">
            Não foi possível carregar a frota agora. Tente novamente em instantes.
          </p>
        ) : vehicles.length === 0 ? (
          <p className="text-sm text-fog-400">
            Nenhum veículo cadastrado ainda. Adicione o primeiro veículo para começar a operar a frota.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line-800">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                  <th className="px-4 py-3 font-medium">Placa</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Energia</th>
                  <th className="px-4 py-3 font-medium">Odômetro</th>
                  <th className="px-4 py-3 font-medium">Localização Atual</th>
                  <th className="px-4 py-3 font-medium">Atenção</th>
                </tr>
              </thead>
              <tbody>
                {vehiclesWithAttention.map(({ row, attention }) => {
                  const meta = STATUS_META[row.status];
                  return (
                    <tr key={row.id} className="border-b border-line-800 last:border-0 hover:bg-panel-900/60">
                      <td className="px-4 py-3 font-mono tabular-nums text-paper-50">{row.plate}</td>
                      <td className="px-4 py-3 text-fog-400">{row.category?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          <span className={meta.text}>{meta.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <EnergyGauge
                          percent={row.energy_type === "BEV" ? row.battery_level_percent : row.fuel_level_percent}
                          kind={row.energy_type === "BEV" ? "battery" : "fuel"}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-fog-400">
                        {row.odometer_km.toLocaleString("pt-BR")} km
                      </td>
                      <td className="px-4 py-3 text-fog-400">{row.current_location?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        {attention.length === 0 ? (
                          <span className="text-fog-600">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {attention.map((reason) => (
                              <span
                                key={reason}
                                className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 px-1.5 py-0.5 text-xs text-signal-amber"
                              >
                                {ATTENTION_LABELS[reason] ?? reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
