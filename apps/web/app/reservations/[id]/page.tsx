import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../AppShell";
import { STATUS_META } from "../../dashboard/statusMeta";
import { MessageThread, type ReservationMessage } from "./MessageThread";
import { respondToCarpoolRequest } from "./actions";
import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";

/**
 * Reservation Detail (SCREEN_CATALOG.md) + Communication Hub for this reservation
 * (COMMUNICATION_HUB.md / DV-004) — previously there was no single screen showing a
 * reservation's own trip context together with its message thread; messaging didn't
 * exist anywhere in the app before this.
 */
export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: reservation } = await supabase
    .from("reservations")
    .select(
      `id, status, start_at, end_at, impacted_at, impacted_reason,
       vehicle:vehicles(plate, status, category:vehicle_categories(name)),
       trip_request:trip_requests(id, origin, destination, requester_id, justification, requester:profiles(full_name))`,
    )
    .eq("id", id)
    .single();

  if (!reservation || !reservation.trip_request) redirect("/trips");

  const isPrivileged =
    profile?.role === "fleet_manager" || profile?.role === "administrator" || profile?.role === "security";
  const isOwnReservation = reservation.trip_request.requester_id === user.id;
  if (!isPrivileged && !isOwnReservation) redirect("/trips");

  // ISSUE-016 remediation: only the reservation's own host driver sees/responds to
  // pending carpool join requests on their trip — never fleet managers/security via this
  // screen, since accepting a passenger is the host's own call, not a fleet-ops one
  // (fleet managers can still be granted the RPC itself for support cases, see
  // 0020_carpool_host_acceptance.sql, but this UI doesn't surface it for them).
  const { data: pendingCarpoolRequests } = isOwnReservation
    ? await supabase
        .from("trip_participants")
        .select("id, passenger_count, joined_at, passenger:profiles(full_name)")
        .eq("trip_request_id", reservation.trip_request.id)
        .eq("status", "pending")
        .order("joined_at", { ascending: true })
    : { data: [] };

  const { data: messageRows } = await supabase
    .from("reservation_messages")
    .select("id, message_type, body, created_at, sender:profiles(full_name)")
    .eq("reservation_id", id)
    .order("created_at", { ascending: true });

  const messages: ReservationMessage[] = (messageRows ?? []).map((m) => ({
    id: m.id,
    message_type: m.message_type,
    body: m.body,
    created_at: m.created_at,
    sender_name: m.sender?.full_name ?? null,
  }));

  const statusMeta = reservation.vehicle ? STATUS_META[reservation.vehicle.status] : null;
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
    >
      <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/trips" className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-amber">
        ← Minhas Viagens
      </Link>

      <header className="mt-4 rounded-md border border-line-800 bg-panel-900/60 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-2xl text-paper-50">{reservation.vehicle?.plate ?? "—"}</p>
            <p className="mt-1 text-sm text-fog-400">
              {reservation.trip_request.origin} → {reservation.trip_request.destination}
            </p>
            <p className="mt-1 text-xs text-fog-600">
              {reservation.trip_request.requester?.full_name} ·{" "}
              {new Date(reservation.start_at).toLocaleString("pt-BR")} →{" "}
              {new Date(reservation.end_at).toLocaleString("pt-BR")}
            </p>
          </div>
          {statusMeta ? (
            <span className={`shrink-0 rounded-sm border px-2 py-1 text-xs uppercase tracking-widest ${statusMeta.text} border-current/40`}>
              {statusMeta.label}
            </span>
          ) : null}
        </div>

        {reservation.impacted_at ? (
          <div className="mt-4 rounded-sm border border-signal-yellow/40 bg-signal-yellow/10 p-3">
            <p className="text-xs uppercase tracking-widest text-signal-yellow">
              Reserva impactada por atraso
            </p>
            <p className="mt-1 text-sm text-fog-400">
              {reservation.impacted_reason ?? "Um atraso na viagem anterior deste veículo pode afetar este horário."}
            </p>
            {isPrivileged ? (
              <p className="mt-1 text-xs text-fog-600">
                Avalie reatribuir o veículo em{" "}
                <Link href="/dashboard" className="text-signal-yellow hover:underline">
                  Painel
                </Link>
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      {isOwnReservation && pendingCarpoolRequests && pendingCarpoolRequests.length > 0 ? (
        <section className="mt-4 rounded-md border border-signal-blue/40 bg-signal-blue/10 p-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-signal-blue">
            Pedidos de Carona
          </h2>
          <ul className="flex flex-col gap-3">
            {pendingCarpoolRequests.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between gap-4 rounded-sm border border-line-800 bg-panel-900/60 p-3"
              >
                <p className="text-sm text-paper-50">
                  {request.passenger?.full_name ?? "—"}
                  <span className="ml-2 text-xs text-fog-600">
                    {request.passenger_count} passageiro{request.passenger_count > 1 ? "s" : ""}
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <form action={respondToCarpoolRequest.bind(null, id, request.id, true)}>
                    <button
                      type="submit"
                      className="rounded-sm border border-signal-teal px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10"
                    >
                      Aceitar
                    </button>
                  </form>
                  <form action={respondToCarpoolRequest.bind(null, id, request.id, false)}>
                    <ConfirmSubmitButton
                      confirmMessage="Recusar este pedido de carona?"
                      className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                    >
                      Recusar
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4 rounded-md border border-line-800 bg-panel-900/60 p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-fog-400">
          Comunicação
        </h2>
        <MessageThread reservationId={id} messages={messages} />
      </section>
      </div>
    </AppShell>
  );
}
