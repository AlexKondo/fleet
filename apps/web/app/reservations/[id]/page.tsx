import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateTime } from "@/lib/formatDateTime";
import { AppShell } from "../../AppShell";
import { getStatusMeta } from "../../dashboard/statusMeta";
import { getDictionary, getLocale } from "../../../lib/i18n/getLocale";
import { MessageThread, type ReservationMessage } from "./MessageThread";
import { respondToCarpoolRequest } from "./actions";
import { cancelMyReservation } from "../../trips/actions";
import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";

/**
 * Reservation Detail (SCREEN_CATALOG.md) + Communication Hub for this reservation
 * (COMMUNICATION_HUB.md / DV-004) — previously there was no single screen showing a
 * reservation's own trip context together with its message thread; messaging didn't
 * exist anywhere in the app before this.
 */
export default async function ReservationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // Set by respondToCarpoolRequest when the accept/reject RPC fails — see actions.ts.
  const carpoolError = (await searchParams)?.carpoolError === "1";
  const dict = await getDictionary();
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  // Profile, the reservation itself and its message thread are all keyed off the user id
  // and the route param, so they go out together — the thread in particular was the third
  // sequential round trip on a page whose whole job is to show it.
  const [{ data: profile }, { data: reservation }, { data: messageRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, role, organization:organizations(name)")
      .eq("id", user.id)
      .single(),
    supabase
      .from("reservations")
      .select(
        `id, status, start_at, end_at, impacted_at, impacted_reason,
       vehicle:vehicles(plate, status, category:vehicle_categories(name)),
       trip_request:trip_requests(id, origin, destination, requester_id, justification, requester:profiles(full_name))`,
      )
      .eq("id", id)
      .single(),
    supabase
      .from("reservation_messages")
      .select("id, message_type, body, created_at, sender:profiles(full_name)")
      .eq("reservation_id", id)
      .order("created_at", { ascending: true }),
  ]);

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

  const messages: ReservationMessage[] = (messageRows ?? []).map((m) => ({
    id: m.id,
    message_type: m.message_type,
    body: m.body,
    created_at: m.created_at,
    sender_name: m.sender?.full_name ?? null,
  }));

  const statusMeta = reservation.vehicle ? getStatusMeta(dict)[reservation.vehicle.status] : null;
  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  const isAdministrator = profile?.role === "administrator";

  // Moved here from the /trips list (which used to show these inline per reservation) so
  // the driver acts on a trip from the same screen where they see its conversation, instead
  // of a separate row of buttons with no context.
  const vehicleStatus = reservation.vehicle?.status;
  const canPickup =
    isOwnReservation &&
    reservation.status === "confirmed" &&
    (vehicleStatus === "reserved" || vehicleStatus === "awaiting_pickup");
  const canReturn = isOwnReservation && reservation.status === "confirmed" && vehicleStatus === "in_use";
  // Mirrors cancel_reservation's own guard (0010_cancel_reservation.sql): once the vehicle
  // is in_use/returning the trip is already underway and can only be finished via Return,
  // not cancelled. This is a convenience gate — the RPC re-checks authoritatively regardless.
  const canCancel =
    isOwnReservation &&
    (reservation.status === "pending_approval" ||
      (reservation.status === "confirmed" && vehicleStatus !== "in_use" && vehicleStatus !== "returning"));

  return (
    <AppShell
      active="trips"
      orgName={profile?.organization?.name ?? "—"}
      userName={profile?.full_name ?? user.email ?? "—"}
      role={profile?.role ?? "employee"}
      isFleetManager={isFleetManager}
      isAdministrator={isAdministrator}
      title={dict.reservations.detail.title}
    >
      <div className="mx-auto max-w-3xl px-4 py-6">
      {carpoolError ? (
        <div
          role="alert"
          className="mb-4 rounded-sm border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-sm text-signal-red"
        >
          {dict.reservations.detail.carpoolActionError}
        </div>
      ) : null}
      <Link href="/trips" className="text-xs uppercase tracking-widest text-fog-400 hover:text-gwm-accent">
        {dict.reservations.detail.backToTrips}
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
              {formatDateTime(reservation.start_at, locale)} →{" "}
              {formatDateTime(reservation.end_at, locale)}
            </p>
          </div>
          {statusMeta ? (
            <span className={`shrink-0 rounded-sm border px-2 py-1 text-xs uppercase tracking-widest ${statusMeta.text} border-current/40`}>
              {statusMeta.label}
            </span>
          ) : null}
        </div>

        {canPickup || canReturn || canCancel ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-800 pt-4">
            {canPickup ? (
              <Link
                href={`/reservations/${id}/pickup`}
                className="rounded-sm border border-signal-blue px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-blue hover:bg-signal-blue/10"
              >
                {dict.trips.list.startPickup}
              </Link>
            ) : null}
            {canReturn ? (
              <Link
                href={`/reservations/${id}/return`}
                className="rounded-sm border border-gwm-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10"
              >
                {dict.trips.list.registerReturn}
              </Link>
            ) : null}
            {canCancel ? (
              <form action={cancelMyReservation.bind(null, id)}>
                <ConfirmSubmitButton
                  confirmMessage={dict.trips.list.confirmCancel}
                  className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                >
                  {dict.common.cancel}
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}

        {reservation.impacted_at ? (
          <div className="mt-4 rounded-sm border border-signal-yellow/40 bg-signal-yellow/10 p-3">
            <p className="text-xs uppercase tracking-widest text-signal-yellow">
              {dict.reservations.detail.impactedTitle}
            </p>
            <p className="mt-1 text-sm text-fog-400">
              {reservation.impacted_reason ?? dict.reservations.detail.impactedDefaultReason}
            </p>
            {isPrivileged ? (
              <p className="mt-1 text-xs text-fog-600">
                {dict.reservations.detail.impactedReassignPrefix}{" "}
                <Link href="/dashboard" className="text-signal-yellow hover:underline">
                  {dict.reservations.detail.impactedReassignLink}
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
            {dict.reservations.detail.carpoolRequestsTitle}
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
                    {(request.passenger_count === 1
                      ? dict.reservations.detail.passengerCountOne
                      : dict.reservations.detail.passengerCountOther
                    ).replace("{count}", String(request.passenger_count))}
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <form action={respondToCarpoolRequest.bind(null, id, request.id, true)}>
                    <button
                      type="submit"
                      className="rounded-sm border border-signal-teal px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10"
                    >
                      {dict.reservations.detail.accept}
                    </button>
                  </form>
                  <form action={respondToCarpoolRequest.bind(null, id, request.id, false)}>
                    <ConfirmSubmitButton
                      confirmMessage={dict.reservations.detail.declineConfirm}
                      className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red"
                    >
                      {dict.reservations.detail.decline}
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
          {dict.reservations.detail.communicationTitle}
        </h2>
        <MessageThread reservationId={id} messages={messages} dict={dict} locale={locale} />
      </section>
      </div>
    </AppShell>
  );
}
