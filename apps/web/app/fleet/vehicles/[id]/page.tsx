import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../../AppShell";
import { STATUS_META } from "../../../dashboard/statusMeta";

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Aguardando aprovação",
  confirmed: "Aprovada",
  cancelled: "Cancelada",
  completed: "Concluída",
};

/**
 * Vehicle schedule — lets anyone checking whether a car is really free for a given date
 * see its actual calendar instead of trusting a single "Reservado"/"Disponível" badge,
 * which only ever reflects the vehicle's current-moment state, not future bookings (see
 * 0024_time_aware_approval_and_pickup.sql — a vehicle can be legitimately booked for next
 * week while showing "Disponível" today).
 */
export default async function VehicleSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select(
      "id, plate, name, color, status, energy_type, category:vehicle_categories(name), current_location:vehicle_locations!vehicles_current_location_id_fkey(name)",
    )
    .eq("id", id)
    .single();

  if (!vehicle) redirect("/fleet");

  const { data: reservations } = await supabase
    .from("reservations")
    .select(
      `id, status, start_at, end_at, impacted_at,
       trip_request:trip_requests(origin, destination, requester:profiles(full_name))`,
    )
    .eq("vehicle_id", id)
    .order("start_at", { ascending: false });

  const meta = STATUS_META[vehicle.status];
  const now = Date.now();

  return (
    <AppShell
      active="fleet"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title="Agenda do Veículo"
    >
      <div className="px-6 py-6">
        <Link href="/fleet" className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber">
          ← Frota
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-md border border-line-800 bg-panel-900/60 p-5">
          <div>
            <p className="text-xl text-paper-50">{vehicle.name ?? vehicle.plate}</p>
            <p className="font-mono text-sm text-fog-400">{vehicle.plate}</p>
            <p className="mt-1 text-xs text-fog-400">
              {vehicle.category?.name ?? "—"}
              {vehicle.color ? ` · ${vehicle.color}` : ""} · {vehicle.current_location?.name ?? "—"}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            <span className={`text-xs uppercase tracking-widest ${meta.text}`}>{meta.label}</span>
          </span>
        </div>

        <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Reservas deste veículo
        </h2>

        {!reservations || reservations.length === 0 ? (
          <p className="text-sm text-fog-400">Este veículo ainda não teve nenhuma reserva.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reservations.map((r) => {
              const active = r.status === "pending_approval" || r.status === "confirmed";
              const isPast = new Date(r.end_at).getTime() < now;
              return (
                <li
                  key={r.id}
                  className={`rounded-sm border px-4 py-2.5 text-sm ${
                    active && !isPast
                      ? "border-signal-blue/30 bg-signal-blue/5"
                      : "border-line-800 bg-panel-900/60"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-paper-50">
                      {r.trip_request?.requester?.full_name ?? "—"} · {r.trip_request?.origin} →{" "}
                      {r.trip_request?.destination}
                    </span>
                    <span
                      className={`text-xs uppercase tracking-widest ${
                        r.status === "confirmed"
                          ? "text-signal-teal"
                          : r.status === "pending_approval"
                            ? "text-signal-amber"
                            : "text-fog-600"
                      }`}
                    >
                      {RESERVATION_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs tabular-nums text-fog-400">
                    {new Date(r.start_at).toLocaleString("pt-BR")} → {new Date(r.end_at).toLocaleString("pt-BR")}
                  </p>
                  {r.impacted_at ? (
                    <p className="mt-1 text-xs text-signal-yellow">⚠ Impactada por atraso</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
