import Link from "next/link";
import { redirect } from "next/navigation";
import { assessVehicleReadiness } from "@fleet/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toDomainVehicle } from "@/lib/domain/mappers";
import { ATTENTION_LABELS, STATUS_META } from "./statusMeta";
import { EnergyGauge } from "./EnergyGauge";
import {
  approveReservation,
  blockVehicle,
  completeWorkflowTask,
  signOut,
  swapVehicle,
  transferReservation,
  unblockVehicle,
} from "./actions";

const WORKFLOW_TASK_LABELS: Record<string, string> = {
  repair: "Reparo",
  safety: "Segurança",
  preventive_maintenance: "Revisão preventiva",
  cleaning: "Limpeza",
  fuel: "Abastecimento",
  charging: "Recarga",
};

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
      `*,
       category:vehicle_categories(name, passenger_capacity, supports_cargo),
       current_location:vehicle_locations!vehicles_current_location_id_fkey(name)`,
    )
    .order("plate");

  const vehicles = vehicleRows ?? [];
  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const canManageTasks = isFleetManager || profile?.role === "maintenance_operator";

  const vehiclesWithAttention = vehicles.map((row) => ({
    row,
    attention: assessVehicleReadiness(toDomainVehicle(row)),
  }));

  const attentionCounts = vehiclesWithAttention.reduce<Record<string, number>>((acc, { attention }) => {
    for (const reason of attention) {
      acc[reason] = (acc[reason] ?? 0) + 1;
    }
    return acc;
  }, {});

  const { data: pendingReservations } = isFleetManager
    ? await supabase
        .from("reservations")
        .select(
          `id, start_at, end_at,
           trip_request:trip_requests(origin, destination, passenger_count, requester:profiles(full_name)),
           vehicle:vehicles(plate)`,
        )
        .eq("status", "pending_approval")
        .order("start_at")
    : { data: [] };

  const { data: openTasks } = canManageTasks
    ? await supabase
        .from("workflow_tasks")
        .select("id, type, notes, created_at, vehicle:vehicles(plate)")
        .eq("status", "open")
        .order("created_at")
    : { data: [] };

  // Backing data for the swap-vehicle / transfer-reservation actions below (§5
  // "Substituir veículos" / "Transferir reservas"): every reservation still active
  // enough to be worth reassigning, plus the org's member list to transfer onto.
  const { data: activeReservations } = isFleetManager
    ? await supabase
        .from("reservations")
        .select(
          `id, start_at, end_at, status,
           vehicle:vehicles(id, plate),
           trip_request:trip_requests(origin, destination, requester_id, requester:profiles(full_name))`,
        )
        .in("status", ["pending_approval", "confirmed"])
        .order("start_at")
    : { data: [] };

  const { data: orgProfiles } = isFleetManager
    ? await supabase.from("profiles").select("id, full_name").order("full_name")
    : { data: [] };

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
          <Link
            href="/trips"
            className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
          >
            Minhas Viagens
          </Link>
          {isFleetManager ? (
            <Link
              href="/analytics"
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber"
            >
              Analytics
            </Link>
          ) : null}
          <Link
            href="/trips/new"
            className="rounded-sm bg-signal-amber px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90"
          >
            + Solicitar Viagem
          </Link>
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

      {isFleetManager ? (
        <section className="border-b border-line-800 px-6 py-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
            Reservas Aguardando Aprovação
          </h2>
          {!pendingReservations || pendingReservations.length === 0 ? (
            <p className="text-sm text-fog-400">Nenhuma reserva pendente.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pendingReservations.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-sm border border-line-800 bg-panel-900/60 px-4 py-2.5"
                >
                  <div className="text-sm">
                    <span className="font-mono text-paper-50">{r.vehicle?.plate}</span>
                    <span className="text-fog-400">
                      {" "}
                      · {r.trip_request?.requester?.full_name} · {r.trip_request?.origin} →{" "}
                      {r.trip_request?.destination} · {new Date(r.start_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <form action={approveReservation.bind(null, r.id)}>
                    <button
                      type="submit"
                      className="rounded-sm border border-signal-teal px-3 py-1 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10"
                    >
                      Aprovar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {isFleetManager ? (
        <section className="border-b border-line-800 px-6 py-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
            Reservas Ativas — Trocar Veículo / Transferir
          </h2>
          {!activeReservations || activeReservations.length === 0 ? (
            <p className="text-sm text-fog-400">Nenhuma reserva ativa no momento.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line-800">
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                    <th className="px-4 py-3 font-medium">Veículo</th>
                    <th className="px-4 py-3 font-medium">Rota</th>
                    <th className="px-4 py-3 font-medium">Solicitante</th>
                    <th className="px-4 py-3 font-medium">Saída</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Trocar Veículo</th>
                    <th className="px-4 py-3 font-medium">Transferir</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReservations.map((r) => {
                    const vehicleOptions = vehicles.filter(
                      (v) => v.status === "available" && v.id !== r.vehicle?.id,
                    );
                    const transferOptions = (orgProfiles ?? []).filter(
                      (p) => p.id !== r.trip_request?.requester_id,
                    );
                    return (
                      <tr key={r.id} className="border-b border-line-800 last:border-0 hover:bg-panel-900/60">
                        <td className="px-4 py-3 font-mono tabular-nums text-paper-50">
                          {r.vehicle?.plate ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-fog-400">
                          {r.trip_request?.origin} → {r.trip_request?.destination}
                        </td>
                        <td className="px-4 py-3 text-fog-400">
                          {r.trip_request?.requester?.full_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums text-fog-400">
                          {new Date(r.start_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-3">
                          <span className={r.status === "confirmed" ? "text-signal-blue" : "text-signal-amber"}>
                            {r.status === "confirmed" ? "Confirmada" : "Pendente"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {vehicleOptions.length === 0 ? (
                            <span className="text-xs text-fog-600">Sem veículo disponível</span>
                          ) : (
                            <form action={swapVehicle.bind(null, r.id)} className="flex items-center gap-2">
                              <select
                                name="vehicleId"
                                required
                                defaultValue=""
                                className="rounded-sm border border-line-800 bg-panel-900 px-2 py-1 text-xs text-paper-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue"
                              >
                                <option value="" disabled>
                                  Selecionar…
                                </option>
                                {vehicleOptions.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.plate}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="rounded-sm border border-signal-blue px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-blue hover:bg-signal-blue/10"
                              >
                                Trocar
                              </button>
                            </form>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {transferOptions.length === 0 ? (
                            <span className="text-xs text-fog-600">—</span>
                          ) : (
                            <form action={transferReservation.bind(null, r.id)} className="flex items-center gap-2">
                              <select
                                name="requesterId"
                                required
                                defaultValue=""
                                className="rounded-sm border border-line-800 bg-panel-900 px-2 py-1 text-xs text-paper-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-violet"
                              >
                                <option value="" disabled>
                                  Selecionar…
                                </option>
                                {transferOptions.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.full_name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="rounded-sm border border-signal-violet px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-violet hover:bg-signal-violet/10"
                              >
                                Transferir
                              </button>
                            </form>
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
      ) : null}

      {canManageTasks ? (
        <section className="border-b border-line-800 px-6 py-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
            Tarefas Operacionais
          </h2>
          {!openTasks || openTasks.length === 0 ? (
            <p className="text-sm text-fog-400">Nenhuma tarefa aberta.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {openTasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-sm border border-line-800 bg-panel-900/60 px-4 py-2.5"
                >
                  <div className="text-sm">
                    <span className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 px-1.5 py-0.5 text-xs text-signal-amber">
                      {WORKFLOW_TASK_LABELS[t.type] ?? t.type}
                    </span>
                    <span className="ml-2 font-mono text-paper-50">{t.vehicle?.plate}</span>
                    {t.notes ? <span className="ml-2 text-fog-400">{t.notes}</span> : null}
                  </div>
                  <form action={completeWorkflowTask.bind(null, t.id)}>
                    <button
                      type="submit"
                      className="rounded-sm border border-line-800 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-teal hover:text-signal-teal"
                    >
                      Concluir
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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
                  {isFleetManager ? <th className="px-4 py-3 font-medium">Ações</th> : null}
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
                      {isFleetManager ? (
                        <td className="px-4 py-3">
                          {row.status === "blocked" ? (
                            <form action={unblockVehicle.bind(null, row.id)}>
                              <button
                                type="submit"
                                className="rounded-sm border border-signal-teal px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10"
                              >
                                Desbloquear
                              </button>
                            </form>
                          ) : row.status === "in_use" || row.status === "returning" ? (
                            <span className="text-xs text-fog-600">—</span>
                          ) : (
                            <form action={blockVehicle.bind(null, row.id, "Bloqueado manualmente pelo gestor")}>
                              <button
                                type="submit"
                                className="rounded-sm border border-signal-red px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-signal-red hover:bg-signal-red/10"
                              >
                                Bloquear
                              </button>
                            </form>
                          )}
                        </td>
                      ) : null}
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
