import Link from "next/link";
import { redirect } from "next/navigation";
import { predictNextService } from "@fleet/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadOrgConfig } from "@/lib/domain/orgConfig";
import { StatBar } from "./StatBar";

/**
 * §19 Fleet Intelligence. Everything here is computed from data the operational cycle
 * already produces (reservations, trip_requests, trip_participants, inspections,
 * vehicles) — no telemetry, no invented tables, per the MVP principle in
 * fleet-car-saas.txt ("Princípio do MVP"). With a small seed dataset most of these
 * numbers will be small or zero; that is reported honestly rather than dressed up with
 * cohort windows or synthetic smoothing the data doesn't support yet.
 *
 * Kept exception-oriented per the gauntlet skill's Fleet Manager design intent
 * (§18/§19: "What needs attention? What is not ready? What is at risk?") — underused
 * vehicles lead, everything else is supporting evidence for that call, not a KPI wall.
 */
export default async function AnalyticsPage() {
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

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  if (!profile || !isFleetManager) {
    redirect("/dashboard");
  }

  // §12 Predictive Maintenance's "due soon" window is organization-configurable
  // (organization_settings.maintenance_due_soon_days, edited from /settings) — replaces the
  // domain package's hardcoded defaultMaintenancePredictionConfig below.
  const orgConfig = await loadOrgConfig(supabase, profile.organization_id);

  const [
    { data: vehicles, error: vehiclesError },
    { data: inspections },
    { data: reservations },
    { data: tripRequests },
    { data: participants },
  ] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate, status, odometer_km, next_service_odometer_km")
      .order("plate"),
    supabase
      .from("inspections")
      .select("vehicle_id, reservation_id, type, odometer_km, created_at")
      .order("created_at"),
    supabase
      .from("reservations")
      .select("id, vehicle_id, status, trip_request:trip_requests(destination)"),
    supabase.from("trip_requests").select("id, destination"),
    supabase.from("trip_participants").select("id"),
  ]);

  // --- Km per vehicle: max - min odometer reading across every inspection (pickup and
  // return) recorded for that vehicle. Chosen over "current odometer - first reading"
  // because it only trusts values this vehicle's own inspections actually recorded, and
  // over per-trip pairs summed because a vehicle can accumulate inspection history
  // without ever completing a full pickup+return pair inside the observed window.
  const readingsByVehicle = new Map<string, number[]>();
  const odometerHistoryByVehicle = new Map<string, { odometerKm: number; recordedAt: string }[]>();
  for (const insp of inspections ?? []) {
    const readings = readingsByVehicle.get(insp.vehicle_id) ?? [];
    readings.push(insp.odometer_km);
    readingsByVehicle.set(insp.vehicle_id, readings);

    const history = odometerHistoryByVehicle.get(insp.vehicle_id) ?? [];
    history.push({ odometerKm: insp.odometer_km, recordedAt: insp.created_at });
    odometerHistoryByVehicle.set(insp.vehicle_id, history);
  }

  // --- Predictive Maintenance (§12): "Com base no km registrado nos check-ins... a
  // plataforma poderá prever quando determinado veículo atingirá sua próxima revisão."
  // Forecast only — never presented as certain, per predictNextService's own contract.
  const now = new Date().toISOString();
  const maintenancePredictions = (vehicles ?? [])
    .map((v) => ({
      id: v.id,
      plate: v.plate,
      prediction: predictNextService(
        v.odometer_km,
        v.next_service_odometer_km,
        odometerHistoryByVehicle.get(v.id) ?? [],
        now,
        { dueSoonDays: orgConfig.maintenanceDueSoonDays },
      ),
    }))
    .filter((v) => v.prediction.dueSoon || v.prediction.estimatedServiceDate !== null)
    .sort((a, b) => (a.prediction.daysUntilService ?? Infinity) - (b.prediction.daysUntilService ?? Infinity));

  const completedByVehicle = new Map<string, number>();
  for (const r of reservations ?? []) {
    if (r.status === "completed") {
      completedByVehicle.set(r.vehicle_id, (completedByVehicle.get(r.vehicle_id) ?? 0) + 1);
    }
  }

  const vehicleStats = (vehicles ?? [])
    .map((v) => {
      const readings = readingsByVehicle.get(v.id) ?? [];
      const km = readings.length >= 2 ? Math.max(...readings) - Math.min(...readings) : null;
      return {
        id: v.id,
        plate: v.plate,
        km,
        readingCount: readings.length,
        completedTrips: completedByVehicle.get(v.id) ?? 0,
      };
    })
    .sort((a, b) => a.completedTrips - b.completedTrips || (a.km ?? 0) - (b.km ?? 0));

  const underutilized = vehicleStats.filter((v) => v.completedTrips === 0);
  const maxKm = Math.max(1, ...vehicleStats.map((v) => v.km ?? 0));

  // --- Km per trip: pair each reservation's pickup and return inspection.
  const readingPairsByReservation = new Map<string, { pickup?: number; return?: number }>();
  for (const insp of inspections ?? []) {
    const entry = readingPairsByReservation.get(insp.reservation_id) ?? {};
    if (insp.type === "pickup") entry.pickup = insp.odometer_km;
    if (insp.type === "return") entry.return = insp.odometer_km;
    readingPairsByReservation.set(insp.reservation_id, entry);
  }

  const destinationByReservation = new Map<string, string>();
  for (const r of reservations ?? []) {
    if (r.trip_request?.destination) {
      destinationByReservation.set(r.id, r.trip_request.destination);
    }
  }

  const tripKm = Array.from(readingPairsByReservation.entries())
    .filter(([, pair]) => pair.pickup !== undefined && pair.return !== undefined)
    .map(([reservationId, pair]) => ({
      reservationId,
      km: (pair.return as number) - (pair.pickup as number),
      destination: destinationByReservation.get(reservationId) ?? "—",
    }))
    .sort((a, b) => b.km - a.km);

  const avgKmPerTrip =
    tripKm.length > 0 ? Math.round(tripKm.reduce((sum, t) => sum + t.km, 0) / tripKm.length) : null;

  // --- Most frequent destinations, across every trip request (reservation-backed or
  // carpool-only — create_carpool_participation never creates a reservation row, so
  // this has to read trip_requests directly rather than derive it from reservations).
  const destinationCounts = new Map<string, number>();
  for (const tr of tripRequests ?? []) {
    destinationCounts.set(tr.destination, (destinationCounts.get(tr.destination) ?? 0) + 1);
  }
  const topDestinations = Array.from(destinationCounts.entries())
    .map(([destination, count]) => ({ destination, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const maxDestinationCount = Math.max(1, ...topDestinations.map((d) => d.count));

  // --- Carpooling: trip_participants rows are people who joined an existing trip
  // instead of generating a new reservation — a rough measure of how much demand the
  // fleet satisfied without putting another vehicle on the road.
  const totalTripRequests = tripRequests?.length ?? 0;
  const totalParticipants = participants?.length ?? 0;
  const carpoolRatePercent =
    totalTripRequests > 0 ? Math.round((totalParticipants / totalTripRequests) * 100) : 0;

  return (
    <main className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line-800 px-6 py-4">
        <div>
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight text-paper-50">
            Fleet<span className="text-signal-amber">.</span> Intelligence
          </p>
          <p className="text-xs uppercase tracking-widest text-fog-600">
            {profile?.organization?.name ?? "—"}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
        >
          ← Painel
        </Link>
      </header>

      {vehiclesError ? (
        <p className="px-6 py-4 text-sm text-signal-red">
          Não foi possível carregar os dados de analytics agora. Tente novamente em instantes.
        </p>
      ) : (
        <>
          <section className="border-b border-line-800 px-6 py-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Veículos Subutilizados
            </h2>
            {underutilized.length === 0 ? (
              <p className="text-sm text-fog-400">
                Todos os veículos têm ao menos uma viagem concluída no histórico observado.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-x-6 gap-y-2">
                {underutilized.map((v) => (
                  <li key={v.id} className="flex items-center gap-2 text-sm">
                    <span className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 px-1.5 py-0.5 font-mono text-xs text-signal-amber">
                      {v.plate}
                    </span>
                    <span className="text-fog-400">0 viagens concluídas no histórico</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-b border-line-800 px-6 py-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Manutenção Preditiva
            </h2>
            {maintenancePredictions.length === 0 ? (
              <p className="text-sm text-fog-400">
                Nenhum veículo com previsão de revisão no horizonte configurado, com base no
                histórico de odômetro disponível.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {maintenancePredictions.map(({ id, plate, prediction }) => (
                  <li
                    key={id}
                    className="flex items-center justify-between rounded-sm border border-line-800 bg-panel-900/60 px-4 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 font-mono text-xs ${
                          prediction.daysUntilService === 0
                            ? "border-signal-red/40 bg-signal-red/10 text-signal-red"
                            : "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                        }`}
                      >
                        {plate}
                      </span>
                      <span className="text-fog-400">
                        {prediction.daysUntilService === 0
                          ? "Revisão já vencida"
                          : `Revisão estimada em ~${Math.round(prediction.daysUntilService ?? 0)} dia${
                              Math.round(prediction.daysUntilService ?? 0) === 1 ? "" : "s"
                            }`}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-fog-600">
                      {prediction.averageKmPerDay !== null
                        ? `~${Math.round(prediction.averageKmPerDay)} km/dia (histórico)`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-fog-600">
              Estimativa baseada no uso histórico registrado nos checklists — é uma
              recomendação para agendamento, não uma data garantida.
            </p>
          </section>

          <section className="border-b border-line-800 px-6 py-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Utilização por Veículo — Viagens Concluídas &amp; Km Percorrido
            </h2>
            {vehicleStats.length === 0 ? (
              <p className="text-sm text-fog-400">Nenhum veículo cadastrado ainda.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-line-800">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                      <th className="px-4 py-3 font-medium">Placa</th>
                      <th className="px-4 py-3 font-medium">Viagens Concluídas</th>
                      <th className="px-4 py-3 font-medium">Km Percorrido (odômetro)</th>
                      <th className="px-4 py-3 font-medium">Leituras de Odômetro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicleStats.map((v) => (
                      <tr key={v.id} className="border-b border-line-800 last:border-0 hover:bg-panel-900/60">
                        <td className="px-4 py-3 font-mono tabular-nums text-paper-50">{v.plate}</td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              v.completedTrips === 0 ? "font-mono text-signal-amber" : "font-mono text-fog-400"
                            }
                          >
                            {v.completedTrips}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {v.km === null ? (
                            <span className="text-xs text-fog-600">dados insuficientes</span>
                          ) : (
                            <StatBar label="" value={v.km} max={maxKm} unit="km" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-fog-400">{v.readingCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="border-b border-line-800 px-6 py-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Km por Viagem
            </h2>
            {tripKm.length === 0 ? (
              <p className="text-sm text-fog-400">
                Nenhuma viagem com checklist de retirada e retorno completos ainda.
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-fog-400">
                  Média: <span className="font-mono text-paper-50">{avgKmPerTrip} km</span> por viagem, em{" "}
                  <span className="font-mono text-paper-50">{tripKm.length}</span> viagem
                  {tripKm.length === 1 ? "" : "s"} com dados completos.
                </p>
                <div className="overflow-x-auto rounded-md border border-line-800">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                        <th className="px-4 py-3 font-medium">Destino</th>
                        <th className="px-4 py-3 font-medium">Km</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tripKm.slice(0, 10).map((t) => (
                        <tr key={t.reservationId} className="border-b border-line-800 last:border-0 hover:bg-panel-900/60">
                          <td className="px-4 py-3 text-fog-400">{t.destination}</td>
                          <td className="px-4 py-3 font-mono tabular-nums text-paper-50">{t.km} km</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="border-b border-line-800 px-6 py-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Destinos Mais Frequentes
            </h2>
            {topDestinations.length === 0 ? (
              <p className="text-sm text-fog-400">Nenhuma solicitação de viagem registrada ainda.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {topDestinations.map((d) => (
                  <StatBar
                    key={d.destination}
                    label={d.destination}
                    value={d.count}
                    max={maxDestinationCount}
                    unit={d.count === 1 ? "solicitação" : "solicitações"}
                    colorClass="bg-signal-blue"
                  />
                ))}
              </div>
            )}
          </section>

          <section className="px-6 py-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Potencial de Carpooling
            </h2>
            {totalTripRequests === 0 ? (
              <p className="text-sm text-fog-400">Nenhuma solicitação de viagem registrada ainda.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <StatBar
                  label="Taxa"
                  value={carpoolRatePercent}
                  max={100}
                  unit="%"
                  colorClass="bg-signal-teal"
                />
                <p className="text-sm text-fog-400">
                  <span className="font-mono text-paper-50">{totalParticipants}</span> carona
                  {totalParticipants === 1 ? "" : "s"} registrada
                  {totalParticipants === 1 ? "" : "s"} em{" "}
                  <span className="font-mono text-paper-50">{totalTripRequests}</span> solicitaç
                  {totalTripRequests === 1 ? "ão" : "ões"} de viagem no total.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
