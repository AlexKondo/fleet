import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../AppShell";
import { cancelMyReservation, leaveCarpool } from "./actions";
import { ConfirmSubmitButton } from "../ConfirmSubmitButton";

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Aguardando aprovação",
  confirmed: "Aprovada",
  cancelled: "Cancelada",
  completed: "Concluída",
};

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ tripActionError?: string }>;
}) {
  const { tripActionError } = await searchParams;
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

  const { data: reservations } = await supabase
    .from("reservations")
    .select(
      `id, status, start_at, end_at, impacted_at,
       trip_request:trip_requests!inner(origin, destination, requester_id, justification),
       vehicle:vehicles(plate, status)`,
    )
    .eq("trip_request.requester_id", user.id)
    .order("start_at", { ascending: false });

  // Carpools joined via create_carpool_participation (0003_trip_request_flow.sql): a
  // trip_participants row, never a second reservation on the same vehicle/time (that
  // would collide with the double-booking constraint). trip_participants.trip_request_id
  // points at the *driver's* trip request, not the joiner's own — there's no direct FK
  // from trip_participants to reservations, so the matching reservation is fetched as a
  // second query and joined here in application code.
  const { data: participations } = await supabase
    .from("trip_participants")
    .select("id, trip_request_id, joined_at, status")
    .eq("passenger_id", user.id)
    .order("joined_at", { ascending: false });

  const carpoolTripRequestIds = (participations ?? []).map((p) => p.trip_request_id);
  const { data: carpoolReservations } =
    carpoolTripRequestIds.length > 0
      ? await supabase
          .from("reservations")
          .select(
            `id, status, start_at, end_at, trip_request_id,
             trip_request:trip_requests(origin, destination),
             vehicle:vehicles(plate, status)`,
          )
          .in("trip_request_id", carpoolTripRequestIds)
      : { data: [] };

  const carpools = (participations ?? [])
    .map((p) => ({
      participantId: p.id,
      status: p.status,
      reservation: (carpoolReservations ?? []).find((r) => r.trip_request_id === p.trip_request_id),
    }))
    .filter(
      (c): c is { participantId: string; status: string; reservation: NonNullable<typeof c.reservation> } =>
        Boolean(c.reservation),
    );

  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  return (
    <AppShell
      active="trips"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title="Minhas Viagens"
      headerActions={
        <Link
          href="/trips/new"
          className="rounded-sm bg-signal-amber px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90"
        >
          + Nova viagem
        </Link>
      }
    >
      <div className="px-6 py-8">
      <div className="mx-auto max-w-4xl">
        {tripActionError ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-sm text-signal-red"
          >
            Não foi possível concluir a ação. A viagem pode já ter mudado de status —
            atualize a página e tente novamente.
          </div>
        ) : null}

        {!reservations || reservations.length === 0 ? (
          <p className="text-sm text-fog-400">
            Você ainda não tem viagens. Solicite a primeira em &ldquo;+ Nova viagem&rdquo;.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reservations.map((r) => {
              const vehicleStatus = r.vehicle?.status;
              const canPickup = r.status === "confirmed" && (vehicleStatus === "reserved" || vehicleStatus === "awaiting_pickup");
              const canReturn = r.status === "confirmed" && vehicleStatus === "in_use";
              // Mirrors cancel_reservation's own guard (0010_cancel_reservation.sql): once
              // the vehicle is in_use/returning the trip is already underway and can only
              // be finished via Return, not cancelled. This is a convenience gate — the
              // RPC re-checks authoritatively regardless.
              const canCancel =
                r.status === "pending_approval" ||
                (r.status === "confirmed" && vehicleStatus !== "in_use" && vehicleStatus !== "returning");
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-md border border-line-800 bg-panel-900/60 p-4"
                >
                  <div>
                    <p className="text-sm text-paper-50">
                      {r.trip_request?.origin} → {r.trip_request?.destination}
                    </p>
                    <p className="mt-1 font-mono text-xs text-fog-400">
                      {r.vehicle?.plate ?? "—"} · {new Date(r.start_at).toLocaleString("pt-BR")}
                    </p>
                    <p className="mt-1 text-xs text-fog-600">
                      {RESERVATION_STATUS_LABEL[r.status] ?? r.status}
                      {r.impacted_at ? (
                        <span className="ml-2 text-signal-yellow">· Impactada por atraso</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/reservations/${r.id}`}
                      className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-amber hover:text-signal-amber"
                    >
                      Mensagens
                    </Link>
                    {canPickup ? (
                      <Link
                        href={`/reservations/${r.id}/pickup`}
                        className="rounded-sm border border-signal-blue px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-blue hover:bg-signal-blue/10"
                      >
                        Iniciar Retirada
                      </Link>
                    ) : canReturn ? (
                      <Link
                        href={`/reservations/${r.id}/return`}
                        className="rounded-sm border border-signal-amber px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10"
                      >
                        Registrar Retorno
                      </Link>
                    ) : null}
                    {canCancel ? (
                      <form action={cancelMyReservation.bind(null, r.id)}>
                        <ConfirmSubmitButton
                          confirmMessage="Cancelar esta viagem?"
                          className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                        >
                          Cancelar
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {carpools.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">
              Caronas
            </h2>
            <ul className="flex flex-col gap-3">
              {carpools.map(({ participantId, status, reservation: r }) => {
                const vehicleStatus = r.vehicle?.status;
                const canLeave =
                  r.status === "pending_approval" ||
                  (r.status === "confirmed" && vehicleStatus !== "in_use" && vehicleStatus !== "returning");
                return (
                  <li
                    key={participantId}
                    className="flex items-center justify-between rounded-md border border-line-800 bg-panel-900/60 p-4"
                  >
                    <div>
                      <p className="text-sm text-paper-50">
                        {r.trip_request?.origin} → {r.trip_request?.destination}
                      </p>
                      <p className="mt-1 font-mono text-xs text-fog-400">
                        {r.vehicle?.plate ?? "—"} · {new Date(r.start_at).toLocaleString("pt-BR")}
                      </p>
                      <p className="mt-1 text-xs text-fog-600">
                        {RESERVATION_STATUS_LABEL[r.status] ?? r.status}
                        {status === "pending" ? (
                          <span className="ml-2 text-signal-blue">· Aguardando aceite do motorista</span>
                        ) : null}
                      </p>
                    </div>
                    {canLeave ? (
                      <form action={leaveCarpool.bind(null, participantId)}>
                        <ConfirmSubmitButton
                          confirmMessage="Sair desta carona?"
                          className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                        >
                          Sair
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}
